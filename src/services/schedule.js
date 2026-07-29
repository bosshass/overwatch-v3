// ============================================
// schedule — the ONE way scheduling state changes.
// ============================================
// "Scheduled" lives in three representations that grew independently:
//   1. jobs.status = 'scheduled'
//   2. jobs.scheduled_date / scheduled_event_id / scheduled_calendar_id
//   3. job_assignments rows (dispatch: tech + calendar_event_id + time)
// ...plus tentative_date/tentative_event_id for holds, plus three fields for
// WHO (tech_assigned, tech_name, assigned_to).
//
// Every scheduling UI wrote its own subset in its own order. That is how nine
// jobs said "scheduled" while two had no date, three had no calendar event and
// one had no tech: each writer told part of the story.
//
// RULE: nothing outside this file writes status='scheduled', scheduled_date,
// scheduled_event_id, tentative_date or tentative_event_id. Screens call
// book / hold / linkToEvent / clearHold and get every representation updated
// together — or an error, never a partial write to the visible fields.
//
// The schema itself still has the redundancy. Collapsing it is a migration for
// a maintenance window, not a Sunday 3am; until then this module IS the schema
// as far as the app is concerned.

import { supabase } from './supabase.js';

// Lightweight audit trail for "who scheduled/rescheduled/held how much this
// week" — a real question with no existing answer anywhere in the data.
// book()/hold() only ever touched the job row; nothing recorded WHO acted or
// WHEN in a form a weekly recap could count. This writes one job_history row
// per action, using the same table notes already use, so it costs nothing
// structurally and a week's worth of these can just be counted.
async function logScheduleAction(jobId, action, byEmail) {
  try {
    await supabase.from('job_history').insert([{
      job_id: jobId, from_status: null, to_status: null,
      changed_by: byEmail || 'unknown', notes: `📅 RECAP: ${action}`,
    }]);
  } catch (e) { console.warn('schedule audit log failed (non-fatal)', e.message); }
}
import { createEventOnCalendar, buildEventTitle, buildEventDescription, getLatestNote } from './calendarSync.js';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function deleteEvent(accessToken, calendarId, eventId) {
  if (!accessToken || !calendarId || !eventId) return;
  try {
    await fetch(`${GCAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) { console.warn('event delete failed (non-fatal)', e.message); }
}

// ── READ: one answer to "what is this job's scheduling state?" ─────────
// Returns { kind: 'booked'|'held'|'none', date, eventId, calendarId }
export function scheduleOf(job) {
  if (!job) return { kind: 'none' };
  if (job.status === 'scheduled') {
    return { kind: 'booked', date: job.scheduled_date,
             eventId: job.scheduled_event_id, calendarId: job.scheduled_calendar_id };
  }
  if (job.tentative_date) {
    return { kind: 'held', date: job.tentative_date,
             eventId: job.tentative_event_id, calendarId: CALENDARS.TENTATIVELY_SCHEDULED };
  }
  return { kind: 'none' };
}

// ── BOOK: tech + slot → every representation, in a safe order ──────────
// DB first (source of truth), then calendar, then the event id remembered.
// If the calendar write fails the job is still visibly scheduled and the
// error surfaces — the reverse order is how ghosts got made.
// helpers: additional techs riding the same job — "Austin + JR". The primary
// tech owns the booking (tech_assigned, scheduled_event_id); each helper gets
// the SAME event mirrored onto their calendar so their availability grid tells
// the truth. tech_name carries all names so the board reads "JR + Austin".
export async function book({ job, tech, start, end, accessToken, helpers = [], byEmail = null }) {
  if (!job?.id) throw new Error('No job');
  if (!tech?.id || !tech?.calendar_id) throw new Error('Pick a tech');
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) throw new Error('Bad time range');
  const isReschedule = job.status === 'scheduled' && !!job.scheduled_event_id;

  // A booking supersedes any hold — remove the Tent event so the calendar
  // doesn't show a hold for work that is now real.
  if (job.tentative_event_id) {
    await deleteEvent(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, job.tentative_event_id);
  }
  // Rebooking removes the previous tech-calendar event.
  if (job.scheduled_event_id && job.scheduled_calendar_id) {
    await deleteEvent(accessToken, job.scheduled_calendar_id, job.scheduled_event_id);
  }

  const { error } = await supabase.from('jobs').update({
    status: 'scheduled',
    scheduled_date: localDateStr(start),
    tech_assigned: tech.id,
    tech_name: [tech.name, ...helpers.map(h => h.name)].filter(Boolean).join(' + '),
    tentative_date: null,
    tentative_event_id: null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (error) throw error;

  const latestNote = await getLatestNote(job.id);
  const created = await createEventOnCalendar(accessToken, tech.calendar_id, {
    title: buildEventTitle(job),
    description: buildEventDescription(job, latestNote),
    location: job.customer_address,
    startTime: start,
    endTime: end,
  });

  if (created?.id) {
    const { error: memErr } = await supabase.from('jobs').update({
      scheduled_event_id: created.id,
      scheduled_calendar_id: tech.calendar_id,
    }).eq('id', job.id);
    if (memErr) console.warn('could not store scheduled event id:', memErr.message);
  }

  // Mirror onto each helper's calendar. Non-fatal per-helper: a failed mirror
  // must not unwind a booking that already exists.
  for (const h of helpers) {
    if (!h?.calendar_id) continue;
    try {
      await createEventOnCalendar(accessToken, h.calendar_id, {
        title: buildEventTitle(job),
        description: buildEventDescription(job, latestNote) + `\n👥 Riding with ${tech.name}`,
        location: job.customer_address,
        startTime: start, endTime: end,
      });
    } catch (e) { console.warn(`helper mirror failed for ${h.name} (non-fatal)`, e.message); }
  }

  logScheduleAction(job.id, isReschedule ? 'Rescheduled' : 'Scheduled', byEmail);
  return { eventId: created?.id || null };
}

// ── HOLD: a day (+hours) → Tent calendar + tentative stamp ─────────────
export async function hold({ job, start, end, accessToken, byName, byEmail = null }) {
  if (!job?.id) throw new Error('No job');
  if (!(start instanceof Date)) throw new Error('Pick a day');

  // Replacing an existing hold removes the old Tent event first.
  if (job.tentative_event_id) {
    await deleteEvent(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, job.tentative_event_id);
  }

  let eventId = null;
  try {
    const created = await createEventOnCalendar(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, {
      title: `Holding ${job.customer_name || 'job'}`,   // the team's convention
      description: `Tentative hold${byName ? ` placed by ${byName}` : ''} in Overwatch. No tech booked.`,
      location: job.customer_address || '',
      startTime: start,
      endTime: end || new Date(start.getTime() + 2 * 3600000),
    });
    if (created?.id) eventId = created.id;
  } catch (e) { console.warn('tent event create failed (non-fatal)', e); }

  const { error } = await supabase.from('jobs').update({
    tentative_date: start.toISOString(),
    tentative_event_id: eventId,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (error) throw error;

  return { eventId };
}

// ── EXTRA DAY: itinerary-only event for a multi-day job ─────────────────
// jobs.scheduled_event_id/scheduled_date is ONE column, not a list — the job
// can only ever track a single "the booking" event. A job that runs several
// days straight (a multi-day install) needs more than one calendar entry, so
// this creates them WITHOUT touching the job row at all. They are real
// events on the tech's calendar; they are just not something Overwatch will
// resolve back to this job later the way the primary booking is. If one needs
// to move, that's a normal calendar edit — same as any other appointment.
export async function bookExtraDay({ job, tech, start, end, accessToken, dayLabel }) {
  if (!tech?.calendar_id) throw new Error('Pick a tech');
  const latestNote = await getLatestNote(job.id);
  const created = await createEventOnCalendar(accessToken, tech.calendar_id, {
    title: buildEventTitle(job),
    description: buildEventDescription(job, latestNote) +
      (dayLabel ? `\n📆 ${dayLabel} of a multi-day job` : ''),
    location: job.customer_address,
    startTime: start,
    endTime: end,
  });
  return { eventId: created?.id || null };
}

// ── LINK: adopt an event somebody already made ─────────────────────────
// The other legitimate way to become scheduled. No new event is created —
// creating one is how a job ends up with two.
export async function linkToEvent({ job, event, calendarId, techName, accessToken }) {
  if (!job?.id) throw new Error('No job');
  if (!event?.id) throw new Error('No event');

  if (job.tentative_event_id) {
    await deleteEvent(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, job.tentative_event_id);
  }

  const start = new Date(event.start?.dateTime || event.start?.date);
  const { error } = await supabase.from('jobs').update({
    status: 'scheduled',
    scheduled_date: localDateStr(start),
    scheduled_event_id: event.id,
    scheduled_calendar_id: calendarId || null,
    tech_name: techName || job.tech_name || null,
    tentative_date: null,
    tentative_event_id: null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (error) throw error;
}

// ── CLEAR a hold without booking ───────────────────────────────────────
export async function clearHold({ job, accessToken }) {
  if (!job?.id) return;
  if (job.tentative_event_id) {
    await deleteEvent(accessToken, CALENDARS.TENTATIVELY_SCHEDULED, job.tentative_event_id);
  }
  const { error } = await supabase.from('jobs').update({
    tentative_date: null,
    tentative_event_id: null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  if (error) throw error;
}
