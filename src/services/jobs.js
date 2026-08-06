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
import { createEvent, updateEvent, moveEvent, deleteEvent, getEvent } from './calendar';
import { calendarForTech, COMPLETED_CALENDAR, isCompletedConfigured, eventMarker } from '../config/calendars';

// Everything the app writes lives BELOW this marker. Everything above it was
// typed by a person into the Google event — gate codes, "call before arriving",
// whatever Shana put there when she booked it straight into the calendar — and
// is never touched. Splitting on the marker is what lets notes be pushed to the
// event without eating hand-written text.
const OW_MARK = '--- Overwatch ---';

export const humanPart = description => {
  const i = String(description || '').indexOf(OW_MARK);
  return (i === -1 ? String(description || '') : String(description).slice(0, i)).trimEnd();
};

const composeDescription = (human, owBlock) =>
  [humanPart(human), human && humanPart(human) ? '' : null, OW_MARK, owBlock]
    .filter(v => v !== null).join('\n');

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

  // WHY a return-lane card is waiting.
  //
  // Selecting "Estimate Needed" lands the card on return_pending — correct,
  // because nothing has been sent — but on the board it then reads as an
  // ordinary return. Waiting on a price and waiting on a part are different
  // problems owned by different people, and the card said neither.
  //
  // Derived, not stored. The attached records already know: an open estimate
  // means we owe a price, a part not yet arrived means we owe an order.
  let waiting = {};
  const returning = jobs.filter(j => j.status === 'return_pending').map(j => j.id);
  if (returning.length) {
    const [{ data: ests }, { data: prts }] = await Promise.all([
      supabase.from('estimates').select('job_id, status, amount')
        .in('job_id', returning).in('status', ['draft', 'sent']),
      supabase.from('parts_orders').select('job_id, ordered_at, arrived_at')
        .in('job_id', returning),
    ]);

    for (const id of returning) {
      const est = (ests || []).find(e => e.job_id === id);
      const parts = (prts || []).filter(p => p.job_id === id);
      const outstanding = parts.filter(p => !p.arrived_at);

      if (est && est.status === 'draft') {
        waiting[id] = { kind: 'estimate', label: 'Needs a price', on: 'us' };
      } else if (est && est.status === 'sent') {
        waiting[id] = { kind: 'estimate', label: 'Estimate with the customer', on: 'them' };
      } else if (outstanding.length) {
        const unordered = outstanding.filter(p => !p.ordered_at).length;
        waiting[id] = unordered
          ? { kind: 'parts', label: `${unordered} part${unordered === 1 ? '' : 's'} not ordered`, on: 'us' }
          : { kind: 'parts', label: `${outstanding.length} part${outstanding.length === 1 ? '' : 's'} on order`, on: 'them' };
      } else {
        waiting[id] = { kind: 'ready', label: 'Ready to book', on: 'us' };
      }
    }
  }

  // What the tech last reported, per job. One query for the whole board rather
  // than a column on jobs holding a second copy of it — the copy is what
  // drifts. Sorted newest first and taken once per job.
  let lastDispo = {};
  if (ids.length) {
    const { data: dh } = await supabase
      .from('job_history')
      .select('job_id, notes, snapshot, changed_by, changed_at')
      .eq('kind', 'disposition')
      .in('job_id', ids)
      .order('changed_at', { ascending: false });
    for (const r of dh || []) {
      if (!lastDispo[r.job_id]) {
        lastDispo[r.job_id] = {
          disposition: r.snapshot?.disposition || null,
          hours: r.snapshot?.hours ?? null,
          by: r.changed_by || null,
          at: r.changed_at,
        };
      }
    }
  }

  // Which visits the office still owes a look at. Derived per visit — a job
  // with two trips can have one cleared and one outstanding.
  const awaiting = ids.length ? await visitsAwaitingReview(ids) : {};

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
    lastEntry: lastDispo[j.id] || null,
    waiting: waiting[j.id] || null,
    awaitingReview: awaiting[j.id] || null,
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
    job_id: job.id, kind: 'move', from_status: from, to_status: target,
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
  // Read the status FRESH. The scheduler opens with whatever the board last
  // loaded, and a stale 'scheduled' here makes a return look like a reschedule —
  // which deletes the tech's event instead of adding a second one.
  const { data: live } = await supabase
    .from('jobs').select('status').eq('id', job.id).single();
  const isReturnTrip = (live?.status || job.status) === 'return_pending';
  const warnings = [];

  const { data: existing } = await supabase
    .from('job_assignments')
    .select('id, tech_id, day_number, scheduled_for, calendar_event_id, calendar_id, event_state')
    .eq('job_id', job.id);

  const prior = existing || [];
  const maxDay = prior.length ? Math.max(...prior.map(a => a.day_number || 1)) : 0;

  // Which VISIT asked for this return.
  //
  // This used to look for a time entry with disposition 'return', and missed
  // twice over: hours are entered in batch, so at the moment the return is
  // booked there is usually no time entry at all — and an ESTIMATE disposition
  // also lands on return_pending, so half the returns were never going to
  // match 'return' anyway. Result: the link back was silently null and the
  // finished-to-rescheduled duration was never actually being captured.
  //
  // The disposition entry is the thing that asked. Read that.
  let returnsFromAssignment = null;
  if (isReturnTrip) {
    const { data: dh } = await supabase
      .from('job_history')
      .select('snapshot, changed_at')
      .eq('job_id', job.id)
      .eq('kind', 'disposition')
      .order('changed_at', { ascending: false });
    const asked = (dh || []).find(
      r => r.snapshot?.disposition === 'return' || r.snapshot?.disposition === 'estimate'
    );
    returnsFromAssignment = asked?.snapshot?.assignment_id || null;
  }

  // The column is named for a time entry, so keep honouring it when one
  // happens to exist — but the assignment is the answer that is always there.
  let returnsFrom = null;
  if (returnsFromAssignment) {
    const { data: te } = await supabase
      .from('time_entries').select('id')
      .eq('assignment_id', returnsFromAssignment).limit(1);
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
  const custId = job.customer?.id || job.customer_id || '';
  const location = job.customer?.address || job.address || '';

  // TITLE: customer + DRH ID. The ID makes every event for an account findable
  // by Google Calendar search, which a name cannot do reliably — names vary and
  // the work changes. The issue does NOT go in the title; it goes in the
  // description, which is what a tech actually reads when glancing at the week.
  const title = custId ? `${customer} — ${custId}` : customer;

  // DESCRIPTION carries the work itself:
  //   - the issue: what this trip is for
  //   - notes tied to this job: they belong to this visit
  //   - a link into the customer in Overwatch, for standing notes that belong to
  //     the account rather than to any one trip (gate codes, dog in the yard)
  const { data: jobNotes } = await supabase
    .from('notes')
    .select('body, author_email, created_at')
    .eq('job_id', job.id)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(10);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const customerLink = custId && appOrigin
    ? `${appOrigin}/customers?id=${encodeURIComponent(custId)}`
    : null;

  const describe = techName => [
    job.issue || 'Service',
    '',
    techName ? `Tech: ${techName}` : null,
    ...(jobNotes?.length
      ? ['', 'Notes:', ...jobNotes.map(n =>
          `· ${n.body}${n.author_email ? ` — ${n.author_email.split('@')[0]}` : ''}`)]
      : []),
    ...(customerLink ? ['', `Customer record: ${customerLink}`] : []),
  ].filter(v => v !== null).join('\n');

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
          title,
          description: composeDescription(null, describe(t.name) + (isReturnTrip ? '\nReturn trip' : '')),
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
    job_id: job.id, kind: 'move', from_status: job.status, to_status: 'scheduled',
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
  if (error) return { ok: false, reason: error.message };

  // A job note belongs to the visit, so it belongs on the visit's calendar
  // event — the tech reads the event, not the app, when glancing at their week.
  // A note flagged onto the CUSTOMER record is not tied to this trip and is
  // reachable through the link in the description instead.
  if (!onCustomerRecord) await refreshEventDescriptions(job, actor);
  return { ok: true };
}

// Rewrite the description on every active event for this job. The app owns the
// description from here: notes are pushed into it, so anything typed directly
// into the Google event will be overwritten on the next note. Times, title,
// location and attendees are never touched.
export async function refreshEventDescriptions(job) {
  const { data: assigns } = await supabase
    .from('job_assignments')
    .select('calendar_id, calendar_event_id, tech:techs ( name )')
    .eq('job_id', job.id)
    .eq('event_state', 'active');
  if (!assigns?.length) return;

  const fresh = await fetchJob(job.id);
  const custId = fresh?.customer?.id || fresh?.customer_id || '';
  const { data: jobNotes } = await supabase
    .from('notes')
    .select('body, author_email')
    .eq('job_id', job.id)
    .is('archived_at', null)
    .eq('on_customer_record', false)
    .order('created_at', { ascending: true })
    .limit(10);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = custId && origin ? `${origin}/customers?id=${encodeURIComponent(custId)}` : null;

  for (const a of assigns) {
    if (!a.calendar_id || !a.calendar_event_id) continue;
    const description = [
      fresh?.issue || 'Service',
      '',
      a.tech?.name ? `Tech: ${a.tech.name}` : null,
      ...(jobNotes?.length
        ? ['', 'Notes:', ...jobNotes.map(n =>
            `· ${n.body}${n.author_email ? ` — ${n.author_email.split('@')[0]}` : ''}`)]
        : []),
      ...(link ? ['', `Customer record: ${link}`] : []),
    ].filter(v => v !== null).join('\n');
    // Read what is on the event now so anything a person typed survives.
    const current = await getEvent(a.calendar_id, a.calendar_event_id);
    await updateEvent(a.calendar_id, a.calendar_event_id, {
      description: composeDescription(current?.description, description),
    });
  }
}

// ── Adopting a manual booking ────────────────────────────────────────────────
// Someone books straight into Google — no owJobId marker — and it later becomes
// a job. Whatever they typed into that event IS the job's notes; it is often the
// only record of why the visit exists. Import it BEFORE the app takes ownership
// of the description, or the first note written wipes it.
export async function adoptEvent({ calendarId, eventId, customerId, techId, actor }) {
  const ev = await getEvent(calendarId, eventId);
  if (!ev) return { ok: false, reason: 'Event not found' };

  const typed = humanPart(ev.description);
  const start = ev.start?.dateTime || ev.start?.date || null;

  const { data: job, error } = await supabase.from('jobs').insert({
    customer_id: customerId,
    customer_name: ev.summary || null,
    issue: ev.summary || 'From calendar',
    status: 'scheduled',
    priority: 'normal',
  }).select('id').single();
  if (error) return { ok: false, reason: error.message };

  // The typed text becomes a note, attributed and timestamped — not silently
  // folded into a field where nobody can tell who wrote it.
  if (typed.trim()) {
    await supabase.from('notes').insert({
      job_id: job.id,
      customer_id: customerId,
      body: typed.trim(),
      author_email: ev.creator?.email || null,
      on_customer_record: false,
    });
  }

  await supabase.from('job_assignments').insert({
    job_id: job.id,
    tech_id: techId,
    day_number: 1,
    scheduled_for: start,
    calendar_id: calendarId,
    calendar_event_id: eventId,
    calendar_synced_at: new Date().toISOString(),
    event_state: 'active',
  });

  // Mark it as ours from here, so the next sync knows it is not an orphan.
  await updateEvent(calendarId, eventId, { extendedProperties: eventMarker(job.id) });

  await supabase.from('job_history').insert({
    job_id: job.id, kind: 'move', from_status: null, to_status: 'scheduled',
    notes: 'Adopted from a calendar booking', changed_by: actor || null,
  });

  return { ok: true, jobId: job.id, importedNote: Boolean(typed.trim()) };
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

// The job's timeline: typed notes AND what the app itself recorded.
//
// These were two tables rendered as one — except only `notes` was ever
// rendered. Every disposition, status move, hours figure and field note that
// finishWork wrote to job_history was invisible: the office opened a card that
// had just come back from a tech and saw an empty thread. "No date, no hours,
// no details" was literal — the rows existed, nothing read them.
//
// Merged here rather than in the view so both the ticket and any future
// customer timeline get the same story in the same order.
export async function fetchTimeline(jobId) {
  const [{ data: notes }, { data: hist }] = await Promise.all([
    supabase.from('notes').select('*')
      .eq('job_id', jobId).is('archived_at', null)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('job_history').select('*')
      .eq('job_id', jobId)
      .order('changed_at', { ascending: false }).limit(100),
  ]);

  const rows = [
    ...(notes || []).map(n => ({
      id: `n-${n.id}`,
      kind: n.kind === 'field' ? 'field' : 'note',
      at: n.created_at,
      who: n.author_email || null,
      body: n.body || '',
      from: null, to: null,
    })),
    ...(hist || []).map(h => ({
      id: `h-${h.id}`,
      kind: h.kind || 'note',
      at: h.changed_at,
      who: h.changed_by || null,
      body: h.notes || '',
      from: h.from_status || null,
      to: h.to_status || null,
      // The figures, unparsed. A disposition entry knows its own hours and
      // parts count without anyone reading them back out of the sentence.
      data: h.snapshot || null,
    })),
  ];

  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  return rows;
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
// What the tech decides:  one disposition and a note. Nothing else.
//   Hours are optional and usually entered later, in batch.
//   Materials used are logged after the fact, not at the exit.
// What the tech NEVER decides: whether it bills. Per lanes.js decision 8 that
// is an Accounting call made later against the hours. `billable` is left at its
// column default (true) and `non_billable_reason` is not touched here.
// Five dispositions, and the status each one lands on.
//
//   finished   → good_to_go       the work is done
//   return     → return_pending   another trip is needed
//   estimate   → return_pending   another trip, gated on a price going out
//   unable     → (no move)        tech could not do it; card stays live
//   cancelled  → (no move)        no access / called off; card stays live
//
// 'estimate' deliberately does NOT write estimate_sent. Nothing has been sent —
// the estimate has not even been priced yet. Estimates stall in the office
// before they go out, so a card reading estimate_sent while it sits unpriced on
// a desk makes "waiting on us" indistinguishable from "waiting on the customer".
// estimate_sent gets written later, when it actually goes out.
const DISPOSITION_TARGET = {
  finished:  'good_to_go',
  return:    'return_pending',
  estimate:  'return_pending',
  unable:    null,
  cancelled: null,
};

export async function finishWork(job, {
  assignmentId,
  techName,
  techEmail,
  hours,
  notes,
  materials,
  partsRequested,             // [{ description, qty }] — optional
  disposition = 'finished',
  actor,
} = {}) {
  if (!(disposition in DISPOSITION_TARGET)) {
    return { ok: false, reason: `Unknown disposition: ${disposition}` };
  }

  // The note is the one thing always required. It is what the office reads and
  // the only field typed at the job.
  const body = String(notes || '').trim();
  if (!body) return { ok: false, reason: 'Say what happened' };

  // Hours are NOT required.
  //
  // They used to be, and it was wrong: hours are entered in batch, often on a
  // Friday for the whole week, and a tech standing in a parking lot should not
  // be inventing a number to get the card off his screen. A missing hour count
  // surfaces to the office as a warning on review, where it is an accounting
  // problem — the same place a wrong guessed number would have surfaced, only
  // now it is visibly absent instead of quietly fabricated.
  const h = Number(hours) || 0;

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
  // Parts the tech asked for. A REQUEST — what is needed for the next trip —
  // not a record of what was used today. That is job_materials, entered later.
  // requested_at defaults; ordered_at stays null until the office acts, which
  // is what makes "nobody ordered these" a queryable fact instead of a note
  // somebody has to remember to re-read.
  const wanted = (partsRequested || [])
    .filter(x => String(x?.description || '').trim())
    .map(x => ({ description: String(x.description).trim(), qty: Number(x.qty) || 1 }));

  const fullNote = wanted.length
    ? `${body}\n\nParts requested from the field:\n`
      + wanted.map(x => `  · ${x.description} ×${x.qty}`).join('\n')
    : body;

  const totalMinutes = Math.round(h * 60);

  // 1. The hours. This row is what Accounting bills from.
  //    Only written when there are hours. No zero-hour placeholder rows —
  //    an empty row and a genuine zero would be indistinguishable, and Billing
  //    reads this table to decide what is unbilled.
  const { error: teErr } = h > 0 ? await supabase.from('time_entries').insert({
    job_id: job.id,
    customer_id: job.customer_id || job.customer?.id || null,
    customer_name_raw: job.customer?.name || job.customer_name || null,
    tech_name: techName || null,
    tech_email: techEmail || null,
    total_minutes: totalMinutes,
    entry_method: 'manual',
    disposition,
    notes: fullNote,
    materials: materials || null,
    calendar_event_id: assignment?.calendar_event_id || null,
    calendar_id: assignment?.calendar_id || null,
    // event_start is the date the WORK happened. created_at defaults to now,
    // the date it was TYPED. Two columns, deliberately — see saveHours.
    event_start: assignment?.scheduled_for || null,
    // Which trip. job_id alone cannot say: a job with JR Monday and Trevor's
    // return Friday has two, and hours belong to one of them.
    assignment_id: assignmentId || null,
    // Whose hours (tech_name) vs who typed them (entered_by). At the finish
    // sheet these are the same person; from Office Review they are not.
    entered_by: actor || null,
  }) : { error: null };
  if (teErr) return { ok: false, reason: teErr.message };

  // 2. Close out this tech's assignment.
  if (assignmentId) {
    await supabase.from('job_assignments').update({
      is_complete: disposition === 'finished',
      actual_hours: h > 0 ? h : null,
      completion_notes: fullNote,
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

  // 'unable' and 'cancelled' move nothing. The trip failed; the work is still
  // owed. Parking them on a status of their own would put two dead words in a
  // vocabulary that was deliberately cut to seven — the fact that the visit
  // did not happen belongs in the note and the history row, not the lane.
  const movedTo = DISPOSITION_TARGET[disposition];

  if (movedTo) {
    await supabase.from('jobs').update({
      status: movedTo,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
  }

  // Parts request rows. Attached to the ESTIMATE when there is one, so the
  // office sees them where they will act on them.
  let estimateId = null;

  // An 'estimate' disposition creates the estimate in DRAFT with no amount.
  // The tech scoped it; nobody has priced it. That gap is the thing worth
  // measuring, and it only exists as a measurable if the row is created now.
  if (disposition === 'estimate') {
    const { data: est } = await supabase.from('estimates').insert({
      customer_id: job.customer_id || job.customer?.id || null,
      job_id: job.id,
      status: 'draft',
      description: body,
      created_by: actor || null,
    }).select('id').single();
    estimateId = est?.id || null;
  }

  if (wanted.length) {
    await supabase.from('parts_orders').insert(
      wanted.map(x => ({
        job_id: estimateId ? null : job.id,
        estimate_id: estimateId,
        description: x.description,
        qty: x.qty,
        requested_by: actor || null,
      }))
    );
  }

  // Every disposition goes to the office. Nothing is blocked from REACHING
  // review — gaps are visible there, which is the whole point.
  //
  // No flag is written. "Awaiting review" is DERIVED: a visit that has a
  // disposition and no review entry after it. Writing a flag meant a second
  // visit reset what the office had already cleared on the first.

  const who   = techName || actor || 'Tech';
  const clock = h > 0 ? `logged ${h}h` : 'no hours entered';

  const HEADLINE = {
    finished:  `${who} — finished, ${clock}`
               + (openAssignments.length
                   ? ` (${openAssignments.length} tech${openAssignments.length > 1 ? 's' : ''} still owe hours)`
                   : ''),
    return:    `${who} — needs another trip, ${clock}`,
    estimate:  `${who} — estimate needed, ${clock}`,
    unable:    `${who} — unable to complete, ${clock}`,
    cancelled: `${who} — cancelled / no access, ${clock}`,
  };

  // The entry. Not a status row that happens to have prose in it — a
  // disposition, typed by a named person at a known time, with the numbers it
  // came with. `snapshot` was already on this table and unused; the figures go
  // there so nothing has to be parsed back out of the sentence.
  await supabase.from('job_history').insert({
    job_id: job.id,
    kind: 'disposition',
    from_status: job.status,
    to_status: movedTo || job.status,
    notes: `${HEADLINE[disposition]}\n${fullNote}`,
    changed_by: techName || actor || null,
    snapshot: {
      disposition,
      hours: h > 0 ? h : null,
      parts_requested: wanted.length || null,
      assignment_id: assignmentId || null,
      open_assignments: openAssignments.length || null,
    },
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

  if (calId && evId && (disposition === 'return' || disposition === 'estimate')) {
    // Title flag, not a description dump — visible in month view without
    // opening the event. Guarded so repeat dispositions do not stack it.
    // Prefix the EXISTING title. Rebuilding it from the customer name threw
    // away the DRH ID, which is what makes the account findable in Google search.
    const ev = await getEvent(calId, evId);
    const base = String(ev?.summary || '').replace(/^RETURN NEEDED — /, '');
    if (base) await updateEvent(calId, evId, { title: `RETURN NEEDED — ${base}` });
  }

  return { ok: true, movedTo, disposition, estimateId, openCount: openAssignments.length, hours: h };
}

// ── Hours ────────────────────────────────────────────────────────────────────
// Hours are entered in BATCH — Friday evening, for the whole week. That is not
// a workaround for a missing feature, it is how the work actually goes: a tech
// closing a job in a parking lot has no reason to stop and do arithmetic, and
// forcing him to invent a number there is how you get fiction in the billing
// table.
//
// TWO DATES, NEVER ONE.
//   event_start  the day the work happened   (from the assignment)
//   created_at   the day it was typed        (now)
// Collapsing these into one column is the v9 bug that pushed Monday's job into
// Friday's week — a single date that quietly meant two different things. Every
// query below groups on event_start; nothing groups on created_at.

// One row per completed TRIP in the window, with whatever hours already exist.
// Assignments, not jobs: two trips to the same customer are two lines, because
// they were two different days and possibly two different techs.
export async function fetchMyHours(techId, fromISO, toISO) {
  if (!techId) return [];

  const { data: assigns, error } = await supabase
    .from('job_assignments')
    .select(`
      id, job_id, scheduled_for, estimated_hours, is_complete, event_state,
      job:jobs ( id, status, customer_id, customer:customers ( id, name ) )
    `)
    .eq('tech_id', techId)
    .neq('event_state', 'removed')
    .gte('scheduled_for', fromISO)
    .lte('scheduled_for', toISO)
    .order('scheduled_for', { ascending: true });
  if (error) throw error;

  const rows = (assigns || []).filter(a => a.scheduled_for);
  if (!rows.length) return [];

  const [{ data: entries }, reviews] = await Promise.all([
    supabase.from('time_entries')
      .select('id, assignment_id, total_minutes, billed, entered_by, created_at')
      .in('assignment_id', rows.map(a => a.id)),
    reviewStates(rows.map(a => a.id)),
  ]);
  const byAssignment = new Map((entries || []).map(e => [e.assignment_id, e]));

  return rows.map(a => {
    const entry = byAssignment.get(a.id) || null;
    return {
      assignmentId: a.id,
      jobId: a.job_id,
      job: a.job || null,
      customer: a.job?.customer?.name || 'No customer',
      customerId: a.job?.customer_id || a.job?.customer?.id || null,
      workDate: a.scheduled_for,
      booked: Number(a.estimated_hours) || 0,
      isComplete: !!a.is_complete,
      entryId: entry?.id || null,
      // Locked once somebody downstream has acted on the number.
      //
      // Billed is obvious — an invoice was built on it. Approved is the same
      // problem one step earlier: the office looked at these hours and signed
      // them off, and a later edit changes what was approved without anyone
      // being told. Before either, the tech owns their own typo.
      locked: !!entry?.billed || reviews[a.id]?.state === 'approved',
      lockReason: entry?.billed ? 'billed'
                : reviews[a.id]?.state === 'approved' ? 'approved by the office'
                : null,
      enteredBy: entry?.entered_by || null,
      hours: entry ? Number(entry.total_minutes || 0) / 60 : null,
    };
  });
}

// The same rows scoped to ONE JOB, for Office Review. No date window: the
// office is looking at a specific card and wants every trip on it, whenever
// they happened.
//
// Each trip carries its OWN tech. Shana entering Austin's Tuesday must produce
// tech_name = Austin, entered_by = Shana — taking the tech from whoever has the
// screen open would quietly reassign the labor to the person doing the typing.
export async function fetchJobHours(jobId) {
  if (!jobId) return [];

  const { data: assigns, error } = await supabase
    .from('job_assignments')
    .select(`
      id, job_id, scheduled_for, estimated_hours, is_complete, event_state,
      tech:techs ( id, name, email ),
      job:jobs ( id, customer_id, customer:customers ( id, name ) )
    `)
    .eq('job_id', jobId)
    .neq('event_state', 'removed')
    .order('scheduled_for', { ascending: true });
  if (error) throw error;

  const rows = assigns || [];
  if (!rows.length) return [];

  const [{ data: entries }, reviews] = await Promise.all([
    supabase.from('time_entries')
      .select('id, assignment_id, total_minutes, billed, entered_by')
      .in('assignment_id', rows.map(a => a.id)),
    reviewStates(rows.map(a => a.id)),
  ]);
  const byAssignment = new Map((entries || []).map(e => [e.assignment_id, e]));

  return rows.map(a => {
    const entry = byAssignment.get(a.id) || null;
    return {
      assignmentId: a.id,
      jobId: a.job_id,
      job: a.job || null,
      customer: a.job?.customer?.name || 'No customer',
      customerId: a.job?.customer_id || a.job?.customer?.id || null,
      techName: a.tech?.name || null,
      techEmail: a.tech?.email || null,
      workDate: a.scheduled_for,
      booked: Number(a.estimated_hours) || 0,
      isComplete: !!a.is_complete,
      entryId: entry?.id || null,
      locked: !!entry?.billed || reviews[a.id]?.state === 'approved',
      lockReason: entry?.billed ? 'billed'
                : reviews[a.id]?.state === 'approved' ? 'approved by the office'
                : null,
      enteredBy: entry?.entered_by || null,
      hours: entry ? Number(entry.total_minutes || 0) / 60 : null,
    };
  });
}

// Which of these trips has already been dispositioned, and what was said.
//
// A tech could declare "work completed", reopen the same stop and declare
// "return visit" — two disposition entries for one visit, two status moves,
// and no way to tell which the office is looking at. The card only ever showed
// the LAST one, so the first silently stopped existing.
//
// Read from job_history rather than a flag on the assignment: the entry is
// already written there carrying its assignment_id, and a flag would be a
// second copy of a fact that already exists.
export async function dispositionsFor(assignmentIds = []) {
  if (!assignmentIds.length) return {};
  const { data } = await supabase
    .from('job_history')
    .select('snapshot, changed_by, changed_at')
    .eq('kind', 'disposition')
    .order('changed_at', { ascending: false });

  const want = new Set(assignmentIds);
  const out = {};
  for (const r of data || []) {
    const id = r.snapshot?.assignment_id;
    if (!id || !want.has(id) || out[id]) continue;
    out[id] = {
      disposition: r.snapshot?.disposition || null,
      by: r.changed_by || null,
      at: r.changed_at,
    };
  }
  return out;
}

// Save the week. Blanks are SKIPPED, not zeroed — an empty box means "not filed
// yet", and a zero-hour row would be indistinguishable from a genuine zero
// while quietly telling Billing this trip was reviewed and found unbillable.
//
// Editing an existing entry updates it in place. There is a unique index on
// assignment_id, so a trip cannot end up with two rows however many times this
// runs or however the finish sheet was used earlier.
export async function saveHours(rows, { actor, techName, techEmail } = {}) {
  const saved = [];
  const failed = [];

  for (const r of rows || []) {
    // Belt and braces: the screen hides these, but a stale page holding rows
    // from before an approval must not be able to write them.
    if (r.locked) continue;

    const raw = String(r.hours ?? '').trim();
    if (raw === '') continue;                       // untouched, not zero

    const h = Number(raw);
    if (!Number.isFinite(h) || h < 0) {
      failed.push({ assignmentId: r.assignmentId, reason: 'Not a number' });
      continue;
    }
    if (h > 24) {
      failed.push({ assignmentId: r.assignmentId, reason: 'More than 24 hours in a day' });
      continue;
    }

    const minutes = Math.round(h * 60);

    if (r.entryId) {
      const { error } = await supabase.from('time_entries')
        .update({ total_minutes: minutes, entered_by: actor || null })
        .eq('id', r.entryId);
      error ? failed.push({ assignmentId: r.assignmentId, reason: error.message })
            : saved.push(r.assignmentId);
      continue;
    }

    if (h === 0) continue;   // nothing to create; see the note above

    const { data: a } = await supabase
      .from('job_assignments')
      .select('id, job_id, scheduled_for, calendar_id, calendar_event_id')
      .eq('id', r.assignmentId)
      .single();

    const { error } = await supabase.from('time_entries').insert({
      job_id: a?.job_id || r.jobId || null,
      assignment_id: r.assignmentId,
      customer_id: r.customerId || null,
      customer_name_raw: r.customer || null,
      tech_name: r.techName || techName || null,     // whose hours
      tech_email: r.techEmail || techEmail || null,
      entered_by: actor || null,            // who typed them
      total_minutes: minutes,
      entry_method: 'batch',
      event_start: a?.scheduled_for || r.workDate || null,
      calendar_id: a?.calendar_id || null,
      calendar_event_id: a?.calendar_event_id || null,
    });
    error ? failed.push({ assignmentId: r.assignmentId, reason: error.message })
          : saved.push(r.assignmentId);
  }

  return { ok: failed.length === 0, saved: saved.length, failed };
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
    job_id: job.id, kind: 'move', from_status: job.status, to_status: 'closed',
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

// ── Materials, parts, review ─────────────────────────────────────────────────
// The paperwork tail. None of this happens at the job — a tech at a customer's
// door is not typing a parts list, and one who does is guessing. It happens in
// the truck, or at the office, after.

// What came off the truck. Backward-looking. No prices: cost vs sell is a
// decision made somewhere else, and putting a number here would force it.
export async function logMaterials(jobId, lines, actor, techId) {
  const rows = (lines || [])
    .filter(x => String(x?.description || '').trim())
    .map(x => ({
      job_id: jobId,
      tech_id: techId || null,
      description: String(x.description).trim(),
      qty: Number(x.qty) || 1,
      source: x.source || 'truck_stock',
      entered_by: actor || null,
    }));
  if (!rows.length) return { ok: false, reason: 'Add at least one item, or say nothing was used' };

  const { error } = await supabase.from('job_materials').insert(rows);
  if (error) return { ok: false, reason: error.message };

  // Adding materials answers the question, so any earlier "nothing used" is
  // no longer true.
  await supabase.from('jobs')
    .update({ materials_none_at: null, materials_none_by: null })
    .eq('id', jobId);
  return { ok: true, count: rows.length };
}

// "Nothing used" is an ANSWER, not a blank. Without it, a job where nothing was
// used and a job nobody has got to look identical.
export async function markNoMaterials(jobId, actor) {
  const { error } = await supabase.from('jobs').update({
    materials_none_at: new Date().toISOString(),
    materials_none_by: actor || null,
  }).eq('id', jobId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function listMaterials(jobId) {
  const { data } = await supabase.from('job_materials')
    .select('*').eq('job_id', jobId).order('created_at');
  return data || [];
}

export async function listParts({ jobId, estimateId } = {}) {
  let q = supabase.from('parts_orders').select('*').order('requested_at');
  if (jobId) q = q.eq('job_id', jobId);
  if (estimateId) q = q.eq('estimate_id', estimateId);
  const { data } = await q;
  return data || [];
}

// A part goes from requested → ordered. Tracking is optional because it is not
// always known at the moment the order is placed.
export async function markPartOrdered(partId, tracking, actor) {
  const { error } = await supabase.from('parts_orders').update({
    ordered_at: new Date().toISOString(),
    ordered_by: actor || null,
    tracking_number: String(tracking || '').trim() || null,
  }).eq('id', partId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// Arrival is what releases a return trip to be scheduled.
export async function markPartArrived(partId) {
  const { error } = await supabase.from('parts_orders')
    .update({ arrived_at: new Date().toISOString() }).eq('id', partId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// Not "I invoiced it" — Overwatch does not touch QBO and cannot claim that.
// It means seen and handled, stamped with who and when.
export async function acknowledgePartBilling(partId, actor) {
  const { error } = await supabase.from('parts_orders').update({
    billing_acknowledged_at: new Date().toISOString(),
    billing_acknowledged_by: actor || null,
  }).eq('id', partId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// The escape hatch on the parts block, and deliberately a short list rather
// than free text — a write-off you can count is a write-off you can act on.
export const NON_BILLABLE_REASONS = [
  { key: 'warranty',             label: 'Warranty' },
  { key: 'callback',             label: 'Callback — our return trip' },
  { key: 'our_error',            label: 'Our error' },
  { key: 'goodwill',             label: 'Goodwill / customer relationship' },
  { key: 'monitoring_agreement', label: 'Covered under monitoring agreement' },
  { key: 'other',                label: 'Other' },
];

export async function markPartNotBillable(partId, reason, note, actor) {
  if (!reason) return { ok: false, reason: 'Pick a reason' };
  if (reason === 'other' && !String(note || '').trim()) {
    return { ok: false, reason: 'Say what "other" means' };
  }
  const { error } = await supabase.from('parts_orders').update({
    billable: false,
    non_billable_reason: reason,
    non_billable_note: String(note || '').trim() || null,
    billing_acknowledged_at: new Date().toISOString(),
    billing_acknowledged_by: actor || null,
  }).eq('id', partId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// ── Office review ────────────────────────────────────────────────────────────
// Review is a FLAG on the job, not an eighth status. The card is good_to_go
// throughout — review says whether a human has looked at it.
//
// Time and materials WARN. Parts BLOCK. The difference: missing hours are a
// gap somebody can fill from memory or a timesheet, but a billable part that
// arrived and nobody confirmed is money already spent that is about to vanish
// off the invoice. One is incomplete paperwork; the other is a leak.
// Review follows the VISIT, not the job.
//
// It was three columns on jobs, which meant a job with two trips had one flag
// and two things to look at: dispositioning the second visit reset the flag
// the office had already cleared on the first, and approving cleared both.
//
// A review is a time-associated entry like any other — who looked, when, what
// they decided, what they said. So it lives in the stream with the disposition
// it is reviewing, keyed to the same assignment. That also means the approval
// HISTORY survives: who signed off on what, not just the current answer.
export async function reviewStates(assignmentIds = []) {
  if (!assignmentIds.length) return {};
  const { data } = await supabase
    .from('job_history')
    .select('snapshot, notes, changed_by, changed_at')
    .eq('kind', 'review')
    .order('changed_at', { ascending: false });

  const want = new Set(assignmentIds);
  const out = {};
  for (const r of data || []) {
    const id = r.snapshot?.assignment_id;
    if (!id || !want.has(id) || out[id]) continue;
    out[id] = {
      state: r.snapshot?.state || null,          // approved | changes
      by: r.changed_by || null,
      at: r.changed_at,
      note: r.notes || null,
    };
  }
  return out;
}

// A visit needing office attention: dispositioned, and either never reviewed
// or the last review asked for changes and the tech has re-dispositioned since.
export async function visitsAwaitingReview(jobIds = []) {
  if (!jobIds.length) return {};

  const { data: assigns } = await supabase
    .from('job_assignments')
    .select('id, job_id')
    .in('job_id', jobIds)
    .neq('event_state', 'removed');
  const ids = (assigns || []).map(a => a.id);
  if (!ids.length) return {};

  const [dispos, reviews] = await Promise.all([
    dispositionsFor(ids),
    reviewStates(ids),
  ]);

  const out = {};
  for (const a of assigns) {
    const d = dispos[a.id];
    if (!d) continue;                             // never closed out
    const r = reviews[a.id];
    // Reviewed AFTER the latest disposition means it has been dealt with.
    if (r && new Date(r.at) >= new Date(d.at)) {
      if (r.state === 'changes') {
        (out[a.job_id] ||= []).push({ assignmentId: a.id, state: 'changes', ...d });
      }
      continue;
    }
    (out[a.job_id] ||= []).push({ assignmentId: a.id, state: 'pending', ...d });
  }
  return out;
}

export async function reviewGaps(job) {
  const [{ count: timeCount }, { count: matCount }, parts] = await Promise.all([
    supabase.from('time_entries').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
    supabase.from('job_materials').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
    listParts({ jobId: job.id }),
  ]);

  const unconfirmed = parts.filter(
    p => p.arrived_at && p.billable && !p.billing_acknowledged_at
  );

  return {
    time:      { ok: (timeCount || 0) > 0, blocks: false },
    materials: { ok: (matCount || 0) > 0 || !!job.materials_none_at, blocks: false },
    parts:     { ok: unconfirmed.length === 0, blocks: true, unconfirmed },
  };
}

export async function approveForBilling(job, actor, assignmentId = null) {
  const gaps = await reviewGaps(job);
  if (!gaps.parts.ok) {
    const n = gaps.parts.unconfirmed.length;
    return {
      ok: false,
      reason: `${n} billable part${n === 1 ? '' : 's'} arrived and nobody has confirmed `
            + `${n === 1 ? 'it is' : 'they are'} on the bill. Confirm or mark not billable first.`,
    };
  }
  const { error } = await supabase.from('job_history').insert({
    job_id: job.id,
    kind: 'review',
    from_status: job.status,
    to_status: job.status,          // review never moves the card
    notes: 'Approved for billing',
    changed_by: actor || null,
    snapshot: { state: 'approved', assignment_id: assignmentId || null },
  });
  return error ? { ok: false, reason: error.message } : { ok: true, warnings: gaps };
}

// Kicks the job back to the tech. The note is required — "changes requested"
// with nothing attached is a dead end for whoever picks it up.
export async function requestChanges(job, note, actor, assignmentId = null) {
  const body = String(note || '').trim();
  if (!body) return { ok: false, reason: 'Say what needs to change' };

  const { error } = await supabase.from('job_history').insert({
    job_id: job.id,
    kind: 'review',
    from_status: job.status,
    to_status: job.status,
    notes: body,
    changed_by: actor || null,
    snapshot: { state: 'changes', assignment_id: assignmentId || null },
  });
  if (error) return { ok: false, reason: error.message };

  // Also a note, so the tech reads it where they read everything else.
  await supabase.from('notes').insert({
    job_id: job.id,
    customer_id: job.customer_id || job.customer?.id || null,
    body,
    kind: 'office',
    author_email: actor || null,
  });
  return { ok: true };
}

// ── Capacity ─────────────────────────────────────────────────────────────────
// Thresholds are HOURS on the tech row, not percentages of capacity.
//
// Percentages read tidy until JR. He is available 10 hours a week and should
// go amber at 4 and red at 6 — 40% and 60%, not the 80/90 the field techs use.
// He is the owner, and hours in the field are hours not spent running the
// business, so his trigger points are deliberately not proportional to
// anyone else's. Reading the two numbers off the row means the rule never has
// to know why they differ.
//
// Austin, Trevor, Subs:  40 available, amber 32, red 36
// JR:                    10 available, amber 4,  red 6
// Shana, Sara:           no capacity — no bar
export function utilization(bookedHours, tech) {
  const cap = Number(tech?.weekly_hours) || 0;
  if (!cap) return null;

  const booked = Number(bookedHours) || 0;
  const amber  = Number(tech?.amber_hours) || cap * 0.8;
  const red    = Number(tech?.red_hours)   || cap * 0.9;

  const state = booked > red ? 'red' : booked > amber ? 'amber' : 'green';
  return {
    booked,
    capacity: cap,
    pct: booked / cap,
    state,
    color: state === 'red' ? '#dc2626' : state === 'amber' ? '#d97706' : '#14b8a6',
    over: state === 'red' ? booked - red : 0,
  };
}
