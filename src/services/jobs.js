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
import { createEvent, updateEvent, moveEvent } from './calendar';
import { calendarForBooking } from '../config/calendars';

const JOB_SELECT = `
  *,
  customer:customers ( id, unique_id, name, address, phone, cs_number ),
  assignments:job_assignments (
    id, tech_id, day_number, scheduled_for, estimated_hours,
    is_complete, calendar_event_id,
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

  return jobs.map(j => ({ ...j, hasTimeEntry: withTime.has(j.id) }));
}

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

  const patch = { status: target, updated_at: new Date().toISOString(), updated_by: actor || null };

  // Leaving a hold behind clears it — a hold is a badge, not a destination,
  // and a stale one is how v9 produced ghost bookings.
  if (laneKey !== 'open' && laneKey !== 'returns') {
    patch.tentative_date = null;
    patch.tentative_event_id = null;
  }

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

  // Rebooking moves the EXISTING event. It does not destroy and replace it.
  //
  // v9 deleted the old event and created a new one, which threw away everything
  // the event had accumulated — access codes, gate instructions, whatever Shana
  // or a tech had typed into the description, and the event's own history.
  // A reschedule is a change of date, not a different piece of work.
  //
  // Two cases, because headcount decides which calendar a booking lives on:
  //   same calendar      → PATCH the times below, event untouched otherwise
  //   different calendar → move() first; Google keeps the id and all content
  //
  // Note this is the RESCHEDULE path only. A return trip is a separate visit
  // and gets its own event — it must never move or overwrite the original.
  let calWarning = null;
  let existingEventId = null;
  const isReturnTrip = job.status === 'return_pending';

  if (!isReturnTrip && job.scheduled_event_id && job.scheduled_calendar_id) {
    existingEventId = job.scheduled_event_id;
  }

  const { error: delErr } = await supabase
    .from('job_assignments').delete().eq('job_id', job.id);
  if (delErr) return { ok: false, reason: delErr.message };

  // scheduled_for carries the real start instant, not a bare date. Day 2 of a
  // multi-day job starts the next calendar day at the same time.
  const rows = techs.map(t => {
    const dayOffset = (Number(t.day) || 1) - 1;
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + dayOffset);
    const p = n => String(n).padStart(2, '0');
    const dayStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return {
      job_id: job.id,
      tech_id: t.id,
      day_number: t.day || 1,
      scheduled_for: startTimestamp(dayStr, t.startTime || startTime),
      estimated_hours: t.hours ?? job.estimated_hours ?? null,
      created_by: actor || null,
    };
  });

  const { data: inserted, error: insErr } = await supabase
    .from('job_assignments').insert(rows).select('id, day_number, scheduled_for');
  if (insErr) return { ok: false, reason: insErr.message };

  // ── Calendar write (3.1.0) ─────────────────────────────────────────────
  // One event for the booking, on the tech or multi-tech calendar depending on
  // headcount. The DB write already succeeded at this point, so a calendar
  // failure is reported as a warning — never a silent swallow, and never a
  // rollback that would lose the booking the operator just made.
  const calendarId = calendarForBooking(techs.length);
  const firstStart = rows[0]?.scheduled_for;
  const longestHours = Math.max(...techs.map(t => Number(t.hours) || 0), 0) || 2;
  const endISO = firstStart
    ? new Date(new Date(firstStart).getTime() + longestHours * 3600 * 1000).toISOString()
    : null;

  const customer = job.customer?.name || job.customer_name || 'No customer';
  const what = job.issue || job.job_type || 'Service';
  const techNames = techs.map(t => t.name).filter(Boolean);

  let eventId = null;
  if (firstStart && endISO) {
    // Rescheduling: relocate if headcount changed the target calendar, then
    // PATCH only the times. Title, location and description are deliberately
    // NOT sent — eventBody() omits undefined fields, so everything already on
    // the event survives. Overwriting the description here would wipe exactly
    // the notes this change exists to protect.
    let made;
    if (existingEventId) {
      const moved = await moveEvent(job.scheduled_calendar_id, existingEventId, calendarId);
      if (moved.ok) {
        made = await updateEvent(calendarId, moved.eventId, { startISO: firstStart, endISO });
      } else if (moved.gone) {
        // Somebody deleted it in Google. Fall through and make a fresh one.
        existingEventId = null;
        calWarning = 'Previous calendar event was missing — created a new one';
      } else {
        made = moved;
      }
    }

    if (!existingEventId) {
      made = await createEvent(calendarId, {
        title: `${customer} — ${what}`,
        description: [
          techNames.length ? `Tech: ${techNames.join(', ')}` : null,
          `Booked by ${actor || 'Overwatch'}`,
          `Overwatch job ${String(job.id).slice(0, 8)}`,
        ].filter(Boolean).join('\n'),
        startISO: firstStart,
        endISO,
        location: job.customer?.address || job.address || '',
      });
    }

    if (made.ok) {
      eventId = made.eventId;
      const ids = (inserted || []).map(r => r.id);
      if (ids.length) {
        await supabase.from('job_assignments')
          .update({ calendar_event_id: eventId, calendar_synced_at: new Date().toISOString() })
          .in('id', ids);
      }
    } else {
      calWarning = made.reason;
    }
  }

  const { error: jobErr } = await supabase.from('jobs').update({
    status: 'scheduled',
    scheduled_date: date,
    tentative_date: null,
    tentative_event_id: null,
    is_multi_day: new Set(techs.map(t => t.day || 1)).size > 1,
    scheduled_event_id: eventId,
    scheduled_calendar_id: eventId ? calendarId : null,
    updated_at: new Date().toISOString(),
    updated_by: actor || null,
  }).eq('id', job.id);
  if (jobErr) return { ok: false, reason: jobErr.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'scheduled',
    notes: `Booked ${techs.length} tech${techs.length > 1 ? 's' : ''} for ${date} at ${startTime}`,
    changed_by: actor || null,
  });

  return { ok: true, techCount: techs.length, eventId, calWarning };
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
        id, status, issue, job_type, priority, estimated_hours, due_date,
        scheduled_date, scheduled_event_id, scheduled_calendar_id, customer_id,
        customer:customers ( id, unique_id, cs_number, name, address, city, state, zip, phone )
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
        id, status, issue, job_type, priority, estimated_hours, scheduled_date,
        customer:customers ( id, unique_id, cs_number, name, address, city, phone )
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
    calendar_event_id: job.scheduled_event_id || null,
    calendar_id: job.scheduled_calendar_id || null,
    event_start: job.scheduled_date ? new Date(`${job.scheduled_date}T00:00:00`).toISOString() : null,
  });
  if (teErr) return { ok: false, reason: teErr.message };

  // 2. Close out this tech's assignment.
  if (assignmentId) {
    await supabase.from('job_assignments').update({
      is_complete: disposition === 'finished',
      actual_hours: h,
      completion_notes: notes || null,
      time_out: new Date().toISOString(),
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
      updated_by: actor || null,
    }).eq('id', job.id);
  } else {
    // 'finished' — the work is done. Move it, and flag any tech who still
    // owes hours rather than holding the whole card hostage to them.
    movedTo = 'good_to_go';
    await supabase.from('jobs').update({
      status: 'good_to_go',
      needs_notes: openAssignments.length > 0,
      needs_notes_flagged_at: openAssignments.length > 0
        ? new Date().toISOString()
        : null,
      updated_at: new Date().toISOString(),
      updated_by: actor || null,
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

  // ── Write disposition back to the Google event ─────────────────────────
  // The calendar event is where everyone else sees the job: Shana in Google
  // Calendar, JR on his phone. Without this, "Needs another trip" exists only
  // in Overwatch and whoever opens the event has no idea the visit happened.
  const calId = job.scheduled_calendar_id;
  const evId  = job.scheduled_event_id;
  if (calId && evId) {
    const lines = [
      techName ? `Tech: ${techName}` : null,
      `Logged: ${h}h`,
      disposition === 'finished'
        ? `Disposition: Finished — Good to go`
          + (openAssignments.length
              ? ` (${openAssignments.length} tech${openAssignments.length > 1 ? 's' : ''} still owe hours)`
              : '')
        : `Disposition: Needs another trip — ${returnReason}`,
      notes ? `Notes: ${notes}` : null,
      materials ? `Materials: ${materials}` : null,
      '',
      `Overwatch job ${String(job.id).slice(0, 8)}`,
    ].filter(l => l !== null).join('\n');

    // updateEvent is a PATCH — it preserves the event's title, date, and
    // location and only overwrites the description. The booking title
    // ("<Customer> — <issue>") stays unchanged on the calendar.
    await updateEvent(calId, evId, { description: lines });
    // calendar failure is not a reason to fail the disposition — the DB write
    // already committed and the tech has moved on.
  }

  return { ok: true, movedTo, openCount: openAssignments.length, hours: h };
}

// A hold is a badge. It does not move the card out of its lane.
export async function hold(job, { date, actor } = {}) {
  const { error } = await supabase.from('jobs')
    .update({ tentative_date: date, updated_at: new Date().toISOString(), updated_by: actor || null })
    .eq('id', job.id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function clearHold(job, { actor } = {}) {
  const { error } = await supabase.from('jobs')
    .update({ tentative_date: null, tentative_event_id: null, updated_by: actor || null })
    .eq('id', job.id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

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
    status: 'closed', completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), updated_by: actor || null,
  }).eq('id', job.id);
  if (error) return { ok: false, reason: error.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'closed',
    notes: 'Closed by Accounting', changed_by: actor || null,
  });
  return { ok: true };
}
