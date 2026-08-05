// ============================================================================
// jobs.js — the ONLY place job state is written.
//
// v9 had five schedulers and several independent status writers. Two of them
// wrote columns that did not exist (9.17.2 fixed changeStatus doing exactly
// that). Every mutation in v3 goes through this file so there is one place to
// audit and one place to fix.
//
// Rules enforced here, not in the UI:
//   - Scheduled cannot be set by hand. Only book() reaches it.
//   - Open has an entry gate (priority + estimated_hours).
//   - Every move writes job_history. No silent state changes.
//   - Ownership writes go to job_assignments. jobs has no tech column.
// ============================================================================

import { supabase } from './supabaseClient';
import { canMoveTo, laneByKey, softWarnings, canClose } from '../utils/lanes';
import { createEvent, updateEvent, moveEvent, deleteEvent } from './calendar';
import { calendarForTech, COMPLETED_CALENDAR, isCompletedConfigured, eventMarker } from '../config/calendars';

const JOB_SELECT = `
  *,
  customer:customers ( id, name, address, city, state, zip, phone, is_monitored ),
  assignments:job_assignments (
    id, tech_id, day_number, scheduled_for, estimated_hours,
    is_complete, calendar_event_id, calendar_id, event_state,
    returns_from_time_entry_id,
    tech:techs ( id, name, email, calendar_id, color )
  )
`;

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchBoard() {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .not('status', 'in', '(closed,archived,dead)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Stranded detection needs to know which jobs have any time logged.
  const ids = jobs.map(j => j.id);
  let withTime = new Set();
  if (ids.length) {
    const { data: te } = await supabase
      .from('time_entries')
      .select('job_id')
      .in('job_id', ids);
    withTime = new Set((te || []).map(t => t.job_id));
  }

  // Dates come from v_job_schedule, which derives them from job_assignments.
  // jobs holds no dates: a job with JR on Monday and Trevor's return on Friday
  // has two, and one column cannot represent that honestly.
  let sched = {};
  if (ids.length) {
    const { data: vs } = await supabase
      .from('v_job_schedule')
      .select('job_id, first_scheduled, next_scheduled, last_scheduled, active_trips, techs_assigned')
      .in('job_id', ids);
    for (const r of vs || []) sched[r.job_id] = r;
  }

  return jobs.map(j => ({
    ...j,
    hasTimeEntry: withTime.has(j.id),
    ...(sched[j.id] || {
      first_scheduled: null, next_scheduled: null, last_scheduled: null,
      active_trips: 0, techs_assigned: 0,
    }),
  }));
}

// ctx for laneOf(): stranded = scheduled, date passed, nothing logged.
export const laneCtx = job => ({
  hasTimeEntry: Boolean(job?.hasTimeEntry),
  nextScheduled: job?.next_scheduled || job?.first_scheduled || null,
});

export async function fetchJob(id) {
  const { data, error } = await supabase
    .from('jobs').select(JOB_SELECT).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchTimeEntries(jobId) {
  const { data, error } = await supabase
    .from('time_entries').select('*')
    .eq('job_id', jobId)
    .order('event_start', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── The single status write path ─────────────────────────────────────────────

export async function moveTo(job, laneKey, { actor, note } = {}) {
  const verdict = canMoveTo(job, laneKey);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, missing: verdict.missing };

  const target = laneByKey(laneKey).target;
  const from = job.status;

  const patch = { status: target, updated_at: new Date().toISOString() };


  const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
  if (error) return { ok: false, reason: error.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: from, to_status: target,
    notes: note || null, changed_by: actor || null,
  });

  return { ok: true, status: target, warnings: softWarnings(job) };
}

// ── Booking — the only route into Scheduled ──────────────────────────────────
// techs: [{ id, hours, day }]. More than one is normal, not an edge case.

// Compose a real timestamp from a local date + a local HH:MM.
//
// `${date}T${time}:00` is parsed by Date as LOCAL time, and toISOString() then
// converts to UTC for the timestamptz column. Concatenating a 'Z' instead would
// store 8am Mountain as 8am UTC — every window off by the offset.
function startTimestamp(date, time) {
  if (!date) return null;
  const t = /^\d{2}:\d{2}$/.test(time || '') ? time : '08:00';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function book(job, { techs = [], date, startTime = '08:00', actor } = {}) {
  if (!techs.length) return { ok: false, reason: 'Pick at least one tech' };
  if (!date) return { ok: false, reason: 'Pick a date' };

  // ── RESCHEDULE vs RETURN ────────────────────────────────────────────────
  // These are opposite operations and are never inferred from state:
  //
  //   RESCHEDULE — the trip has not happened. PATCH the existing event on each
  //     tech's calendar. Same assignment row, same event id, same day_number.
  //     An assignment that already has time logged against it CANNOT be
  //     rescheduled — the work happened on that date and moving it rewrites
  //     which period it bills in.
  //
  //   RETURN — a trip happened and more work is needed. Every existing event
  //     stays exactly where it is. New assignment rows are added at
  //     day_number + 1 with fresh events, linked back to the time entry whose
  //     disposition asked for the return.
  //
  // A tech may differ between trips: JR diagnoses, Trevor returns with the
  // part. Tech is per assignment row, so this needs no special handling —
  // but each event goes to THAT tech's calendar, never a shared one.
  const isReturnTrip = job.status === 'return_pending';
  const warnings = [];

  const { data: existing } = await supabase
    .from('job_assignments')
    .select('id, tech_id, day_number, scheduled_for, calendar_event_id, calendar_id, event_state')
    .eq('job_id', job.id);

  const prior = existing || [];
  const maxDay = prior.length ? Math.max(...prior.map(a => a.day_number || 1)) : 0;

  // Which time entry asked for this return, if any.
  let returnsFrom = null;
  if (isReturnTrip) {
    const { data: te } = await supabase
      .from('time_entries')
      .select('id, created_at')
      .eq('job_id', job.id)
      .eq('disposition', 'return')
      .order('created_at', { ascending: false })
      .limit(1);
    returnsFrom = te?.[0]?.id || null;
  }

  // Reschedule guard: refuse to move a trip that already happened.
  if (!isReturnTrip && prior.length) {
    const { data: logged } = await supabase
      .from('time_entries').select('id').eq('job_id', job.id).limit(1);
    if (logged?.length) {
      return {
        ok: false,
        reason: 'This job has time logged. Book a return trip instead — rescheduling would move work that already happened.',
      };
    }
  }

  const customer = job.customer?.name || job.customer_name || 'No customer';
  const what = job.issue || 'Service';
  const location = job.customer?.address || job.address || '';

  const rows = [];
  for (const t of techs) {
    const dayOffset = (Number(t.day) || 1) - 1;
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + dayOffset);
    const p2 = n => String(n).padStart(2, '0');
    const dayStr = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const startISO = startTimestamp(dayStr, t.startTime || startTime);
    const hours = Number(t.hours) || Number(job.estimated_hours) || 2;
    const endISO = startISO
      ? new Date(new Date(startISO).getTime() + hours * 3600 * 1000).toISOString()
      : null;

    // THE calendar for this event is THIS tech's calendar. No fallback.
    const calendarId = calendarForTech(t);
    if (!calendarId) {
      warnings.push(`${t.name || t.id} has no calendar configured — booked without an event`);
    }

    const dayNumber = isReturnTrip ? maxDay + (Number(t.day) || 1) : (Number(t.day) || 1);

    // Reschedule reuses this tech's existing row+event for the same day.
    const reuse = !isReturnTrip
      ? prior.find(a => a.tech_id === t.id && (a.day_number || 1) === dayNumber
                        && a.event_state !== 'removed')
      : null;

    let eventId = reuse?.calendar_event_id || null;
    if (calendarId && startISO && endISO) {
      let made;
      if (reuse?.calendar_event_id && reuse.calendar_id) {
        // Same tech, same slot -> PATCH in place. Title and description are not
        // sent: eventBody() omits undefined, so gate codes and notes survive.
        if (reuse.calendar_id !== calendarId) {
          const moved = await moveEvent(reuse.calendar_id, reuse.calendar_event_id, calendarId);
          made = moved.ok
            ? await updateEvent(calendarId, moved.eventId, { startISO, endISO })
            : moved;
        } else {
          made = await updateEvent(calendarId, reuse.calendar_event_id, { startISO, endISO });
        }
        if (made?.gone) made = null;   // deleted in Google — fall through
      }
      if (!made) {
        made = await createEvent(calendarId, {
          title: `${customer} — ${what}`,
          description: [
            t.name ? `Tech: ${t.name}` : null,
            isReturnTrip ? 'Return trip' : null,
            `Booked by ${actor || 'Overwatch'}`,
          ].filter(Boolean).join('\n'),
          startISO, endISO, location,
          extendedProperties: eventMarker(job.id),
        });
      }
      if (made?.ok) eventId = made.eventId;
      else warnings.push(made?.reason || 'calendar write failed');
    }

    rows.push({
      _reuseId: reuse?.id || null,
      job_id: job.id,
      tech_id: t.id,
      day_number: dayNumber,
      scheduled_for: startISO,
      estimated_hours: t.hours ?? job.estimated_hours ?? null,
      calendar_event_id: eventId,
      calendar_id: eventId ? calendarForTech(t) : null,
      calendar_synced_at: eventId ? new Date().toISOString() : null,
      event_state: 'active',
      returns_from_time_entry_id: isReturnTrip ? returnsFrom : null,
    });
  }

  // Techs dropped from a reschedule: their event comes off the calendar, but
  // the row and its hours stay. event_state records why it has no event.
  if (!isReturnTrip) {
    const keeping = new Set(rows.filter(r => r._reuseId).map(r => r._reuseId));
    for (const a of prior) {
      if (keeping.has(a.id) || a.event_state === 'removed') continue;
      if (a.calendar_id && a.calendar_event_id) {
        await deleteEvent(a.calendar_id, a.calendar_event_id);
      }
      await supabase.from('job_assignments').update({
        event_state: 'removed',
        removed_at: new Date().toISOString(),
        removed_by: actor || null,
      }).eq('id', a.id);
    }
  }

  for (const r of rows) {
    const { _reuseId, ...row } = r;
    const res = _reuseId
      ? await supabase.from('job_assignments').update(row).eq('id', _reuseId)
      : await supabase.from('job_assignments').insert(row);
    if (res.error) return { ok: false, reason: res.error.message };
  }

  // jobs holds NO dates and NO calendar pointers. Schedule is derived from
  // job_assignments via v_job_schedule.
  const { error: jobErr } = await supabase.from('jobs')
    .update({ status: 'scheduled', updated_at: new Date().toISOString() })
    .eq('id', job.id);
  if (jobErr) return { ok: false, reason: jobErr.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'scheduled',
    notes: `${isReturnTrip ? 'Return booked' : 'Booked'} ${techs.length} tech${techs.length > 1 ? 's' : ''} for ${date} at ${startTime}`,
    changed_by: actor || null,
  });

  return { ok: true, techCount: techs.length, isReturnTrip, calWarning: warnings.join('; ') || null };
}

// ── The tech's own day ───────────────────────────────────────────────────────
// Driven by job_assignments, NOT by calendar events. techs.calendar_id is a
// shared team calendar in this data (two techs point at the same one), so an
// event cannot tell you whose work it is. The assignment can.
export async function fetchMyDay(techId, dayISO) {
  if (!techId || !dayISO) return [];

  const start = new Date(`${dayISO}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from('job_assignments')
    .select(`
      id, job_id, tech_id, day_number, scheduled_for, estimated_hours,
      is_complete, actual_hours, calendar_event_id,
      job:jobs (
        id, status, issue, priority, estimated_hours, due_date, customer_id,
        customer:customers ( id, name, address, city, state, zip, phone )
      )
    `)
    .eq('tech_id', techId)
    .gte('scheduled_for', start.toISOString())
    .lt('scheduled_for', end.toISOString())
    .order('scheduled_for');

  if (error) throw error;
  return data || [];
}

// Everything booked in a date range, all techs. Drives the calendar view.
// Assignments, not calendar events — one row per tech per day, so a two-tech
// job shows both people rather than one opaque event.
export async function fetchScheduleRange(fromISO, toISO) {
  const { data, error } = await supabase
    .from('job_assignments')
    .select(`
      id, job_id, tech_id, day_number, scheduled_for, estimated_hours,
      is_complete, calendar_event_id,
      tech:techs ( id, name, color, email ),
      job:jobs (
        id, status, issue, priority, estimated_hours,
        customer:customers ( id, name, address, city, phone )
      )
    `)
    .gte('scheduled_for', fromISO)
    .lt('scheduled_for', toISO)
    .order('scheduled_for');
  if (error) throw error;
  return data || [];
}

// ── Notes ────────────────────────────────────────────────────────────────────
// job_history is the one notes store. A note is a history row that does not
// change status — from and to are the same, so the feed reads as one thread
// instead of splitting "notes" and "activity" into two lists that disagree.
// ── Notes ────────────────────────────────────────────────────────────────────
// Notes live in `notes`, not in job_history.
//
// They were in job_history because 3.4.1 collapsed several competing note paths
// into one, and job_history was the one that already worked. But job_history is
// an AUDIT table — from_status, to_status, snapshot — and storing notes there
// forced a `from_status === to_status` trick to tell a note from a status
// change, which is a filter, not a data model.
//
// The rule that makes customer search work: ALWAYS stamp customer_id, even when
// the note belongs to a job. It is redundant — you could join through jobs — and
// it is deliberate. It makes a customer's whole note history one indexed lookup,
// and it survives the job being archived, merged or repointed.
//
// job_id NULL + on_customer_record true = a standing fact about the customer
// rather than about one piece of work: gate code, dog in the yard, panel is in
// the back closet. Those float above the jobs in a customer timeline.

export async function addNote(job, text, actor, { onCustomerRecord = false } = {}) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, reason: 'Nothing to save' };

  const customerId = job.customer_id || job.customer?.id || null;

  const { error } = await supabase.from('notes').insert({
    job_id: job.id,
    customer_id: customerId,
    body,
    author_email: actor || null,
    on_customer_record: onCustomerRecord,
  });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function fetchNotes(jobId) {
  const { data, error } = await supabase
    .from('notes').select('*')
    .eq('job_id', jobId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

// Every note for a customer — job-attached and standing. This is the query the
// old shape could not answer without walking every job the customer ever had.
export async function fetchCustomerNotes(customerId) {
  const { data, error } = await supabase
    .from('notes').select('*')
    .eq('customer_id', customerId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

// ── Finishing field work ─────────────────────────────────────────────────────
// The ONLY writer of time_entries. Until 3.1.0 nothing in v3 could create one,
// which meant the billing source of truth was permanently empty and every
// scheduled job whose date passed fell into Needs action with no way out
// (lanes.js laneOf, the hasTimeEntry branch).
//
// What the tech decides:  hours, what happened, finished or needs another trip.
// What the tech NEVER decides: whether it bills. Per lanes.js decision 8 that
// is an Accounting call made later against the hours. `billable` is left at its
// column default (true) and `non_billable_reason` is not touched here.
export async function finishWork(job, {
  assignmentId,
  techName,
  techEmail,
  hours,
  notes,
  materials,
  disposition = 'finished',   // 'finished' | 'return'
  returnReason,
  actor,
} = {}) {
  const h = Number(hours);
  if (!h || h <= 0) return { ok: false, reason: 'Enter the hours worked' };

  // The trip being closed out. Its (calendar_id, calendar_event_id) pair is what
  // the time entry records and what retires to Completed — there is no
  // job-level event any more.
  let assignment = null;
  if (assignmentId) {
    const { data } = await supabase
      .from('job_assignments')
      .select('id, tech_id, day_number, scheduled_for, calendar_id, calendar_event_id, event_state')
      .eq('id', assignmentId)
      .single();
    assignment = data || null;
  }
  if (disposition === 'return' && !String(returnReason || '').trim()) {
    return { ok: false, reason: 'Say why it needs another trip' };
  }

  const totalMinutes = Math.round(h * 60);

  // 1. The hours. This row is what Accounting bills from.
  const { error: teErr } = await supabase.from('time_entries').insert({
    job_id: job.id,
    customer_id: job.customer_id || job.customer?.id || null,
    customer_name_raw: job.customer?.name || job.customer_name || null,
    tech_name: techName || null,
    tech_email: techEmail || null,
    total_minutes: totalMinutes,
    entry_method: 'manual',
    disposition,
    notes: notes || null,
    materials: materials || null,
    calendar_event_id: assignment?.calendar_event_id || null,
    calendar_id: assignment?.calendar_id || null,
    event_start: assignment?.scheduled_for || null,
  });
  if (teErr) return { ok: false, reason: teErr.message };

  // 2. Close out this tech's assignment.
  if (assignmentId) {
    await supabase.from('job_assignments').update({
      is_complete: disposition === 'finished',
      actual_hours: h,
      completion_notes: notes || null,
    }).eq('id', assignmentId);
  }

  // 3. Disposition is a JOB-level fact. Hours are a TECH-level fact.
  //
  //    This used to require every assigned tech to have reported before the
  //    card could leave the board. In practice that meant the office had to
  //    impersonate whichever tech had not filed yet — for each of them — and on
  //    a multi-day job a tech may reasonably not log anything until the last
  //    day. A card stuck behind other people's paperwork is a worse failure
  //    than a card that moved slightly early.
  //
  //    So: whoever declares 'finished' is asserting the WORK is done, and the
  //    card moves. Assignments still open stay open. They do not block; they
  //    become a flag, and the missing hours surface in Billing where they are
  //    an accounting problem rather than a board problem.
  //
  //    lanes.js canMoveTo() has always used this rule for a manual drag —
  //    ctx.hasTimeEntry, singular. The two paths now agree.
  const { data: remaining } = await supabase
    .from('job_assignments').select('id, is_complete').eq('job_id', job.id);

  const openAssignments = (remaining || []).filter(a => !a.is_complete);
  let movedTo = null;

  if (disposition === 'return') {
    movedTo = 'return_pending';
    await supabase.from('jobs').update({
      status: 'return_pending',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
  } else {
    // 'finished' — the work is done. Move it, and flag any tech who still
    // owes hours rather than holding the whole card hostage to them.
    movedTo = 'good_to_go';
    await supabase.from('jobs').update({
      status: 'good_to_go',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
  }

  await supabase.from('job_history').insert({
    job_id: job.id,
    from_status: job.status,
    to_status: movedTo || job.status,
    notes: disposition === 'return'
      ? `${techName || actor || 'Tech'} logged ${h}h — needs another trip: ${returnReason}`
      : `${techName || actor || 'Tech'} logged ${h}h — finished`
        + (openAssignments.length
            ? ` (${openAssignments.length} tech${openAssignments.length > 1 ? 's' : ''} still owe hours)`
            : ''),
    changed_by: actor || null,
  });

  // ── Calendar ─────────────────────────────────────────────────────────────
  // The calendar is a SIGNAL, not a copy of the record.
  //
  // This used to dump tech, hours, disposition, notes and materials into the
  // event description on every disposition. All of that already lives in
  // time_entries, which is the billing source of truth — writing it to Google
  // as well produced a second, staler copy of data nobody reads there, and
  // buried the one thing that actually needs to be visible.
  //
  // The only thing the calendar needs to say is: this needs another trip.
  // Everything else stays in the database.
  const calId = assignment?.calendar_id;
  const evId  = assignment?.calendar_event_id;

  if (calId && evId && disposition === 'return') {
    // Title flag, not a description dump — visible in month view without
    // opening the event. Guarded so repeat dispositions do not stack it.
    const base = (job.calendar_title || `${job.customer?.name || job.customer_name || 'Job'}`)
      .replace(/^RETURN NEEDED — /, '');
    await updateEvent(calId, evId, { title: `RETURN NEEDED — ${base}` });
  }

  return { ok: true, movedTo, openCount: openAssignments.length, hours: h };
}

// A hold is a badge. It does not move the card out of its lane.


// ── Accounting ───────────────────────────────────────────────────────────────
// Not reachable from any field screen.

export async function markNonBillable(entryId, reason, actor) {
  if (!reason) return { ok: false, reason: 'A reason is required' };
  const { error } = await supabase.from('time_entries').update({
    billable: false, non_billable_reason: reason,
    resolved_by: actor || null, resolved_at: new Date().toISOString(),
  }).eq('id', entryId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// The invoice number the work was billed on. Accounting-only; nothing on the
// board writes it.
export async function setInvoiceNumber(jobId, number, actor) {
  const v = String(number || '').trim() || null;
  const { error } = await supabase.from('jobs').update({
    invoice_number: v,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function markBilled(entryId, actor) {
  const { error } = await supabase.from('time_entries').update({
    billed: true, billed_at: new Date().toISOString(),
    resolved_by: actor || null, resolved_at: new Date().toISOString(),
  }).eq('id', entryId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// Closing requires every entry resolved. This is the gate that stops work
// piling up unbilled the way 61 entries / 209.5 hours did in v9.
export async function closeJob(job, actor) {
  const entries = await fetchTimeEntries(job.id);
  const verdict = canClose(entries);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const { error } = await supabase.from('jobs').update({
    status: 'closed',
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (error) return { ok: false, reason: error.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'closed',
    notes: 'Closed by Accounting', changed_by: actor || null,
  });

  // Billed and closed — the event comes off the live tech calendars and files
  // to Completed. Same move() as everywhere else: same event id, description
  // and history intact, just no longer cluttering anyone's working week.
  // Billing closes the job -> every active event files to Completed. Rows with
  // event_state 'removed' have no event to move; their hours still billed.
  if (isCompletedConfigured()) {
    const { data: assigns } = await supabase
      .from('job_assignments')
      .select('id, calendar_id, calendar_event_id')
      .eq('job_id', job.id)
      .eq('event_state', 'active');
    for (const a of assigns || []) {
      if (!a.calendar_id || !a.calendar_event_id) continue;
      const moved = await moveEvent(a.calendar_id, a.calendar_event_id, COMPLETED_CALENDAR);
      if (moved.ok) {
        await supabase.from('job_assignments').update({
          completed_event_id: moved.eventId,
          billed_at: new Date().toISOString(),
        }).eq('id', a.id);
      }
    }
  }

  return { ok: true };
}
