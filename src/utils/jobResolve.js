// ============================================
// jobResolve — one calendar event → one job. ONE answer.
// ============================================
// A Google Calendar event ID can live in THREE columns:
//   1. jobs.calendar_event_id            — the ORIGINAL intake event
//   2. jobs.scheduled_event_id           — the event VisualSchedulerModal
//                                          creates on the TECH's calendar
//   3. job_assignments.calendar_event_id — what other scheduling paths write
//   4. jobs.tentative_event_id           — the "Holding <customer>" event.
//      Missing this made the app HAND YOU BACK YOUR OWN HOLD: you'd pencil a
//      job in, and seconds later its hold event appeared in Doing as "not on
//      the board yet" with a Make-it-a-job button — a one-tap duplicate.
//
// Every screen that needed this picked its own subset, and the subsets
// disagreed. Two live bugs came directly from that:
//   • JobFinishSheet checked only (1). A tech dispositioning from their own
//     calendar is always holding (2) or (3), so the lookup missed and every
//     disposition spawned a DUPLICATE job while the real card froze in
//     Scheduled. That is the duplicate-card bug.
//   • Unbilled had to resolve two ways to find anything, and the To Bill tile
//     resolved a third way — which is how 18 jobs and 2 hours became the same
//     screen disagreeing with itself.
//
// Import from here. Do not add a fourth subset.

import { supabase } from '../services/supabase.js';

// Find the job an event belongs to, checking all three homes in priority
// order. Returns { id, status, ... } or null.
export async function resolveJobForEvent(eventId, { select = 'id, status' } = {}) {
  if (!eventId) return null;

  // (1) and (2) — both live on jobs, so one round trip.
  try {
    const { data } = await supabase
      .from('jobs').select(select)
      .or(`calendar_event_id.eq.${eventId},scheduled_event_id.eq.${eventId},tentative_event_id.eq.${eventId}`)
      .limit(1);
    if (data && data[0]) return data[0];
  } catch (e) { console.warn('resolveJobForEvent: jobs lookup failed', e); }

  // (2b) — RECURRING INSTANCES. Google gives a single occurrence an id of
  // "<baseId>_20260708T183000Z". Whatever created the job stored the BASE id,
  // so an exact match on the instance id finds nothing and the caller happily
  // creates a SECOND job for a visit that was already on the board. Retry on
  // the base before giving up.
  if (eventId.includes('_')) {
    const base = eventId.split('_')[0];
    try {
      const { data } = await supabase
        .from('jobs').select(select)
        .or(`calendar_event_id.eq.${base},scheduled_event_id.eq.${base},tentative_event_id.eq.${base}`)
        .limit(1);
      if (data && data[0]) return data[0];
    } catch (e) { console.warn('resolveJobForEvent: recurring-base lookup failed', e); }
  }

  // (3) — the assignment row points back at the job.
  try {
    const { data } = await supabase
      .from('job_assignments').select('job_id')
      .eq('calendar_event_id', eventId)
      .maybeSingle();
    if (data?.job_id) {
      const { data: job } = await supabase
        .from('jobs').select(select).eq('id', data.job_id).maybeSingle();
      return job || { id: data.job_id };
    }
  } catch (e) { console.warn('resolveJobForEvent: assignment lookup failed', e); }

  return null;
}

// In-memory version for screens that have already loaded a page of jobs and
// shouldn't fire a query per row.
export function buildEventIndex(jobs) {
  const byEvent = {};
  (jobs || []).forEach(j => {
    if (j.calendar_event_id)   byEvent[j.calendar_event_id]   = j;
    if (j.scheduled_event_id)  byEvent[j.scheduled_event_id]  = j;
    if (j.tentative_event_id)  byEvent[j.tentative_event_id]  = j;
  });
  return {
    byId: Object.fromEntries((jobs || []).map(j => [j.id, j])),
    byEvent,
  };
}

export function jobForEntry(entry, index) {
  if (!entry || !index) return null;
  return index.byId[entry.job_id] || index.byEvent[entry.calendar_event_id] || null;
}

// ── Hours ────────────────────────────────────────────────────────────
// time_entries is the ONLY authoritative record of hours worked. The old
// Billing screen counted job_assignments, which are dispatch records — a tech
// can be assigned and never show, or show and log different hours. Counting
// assignments is counting intentions.
export const hoursOf   = (entry) => (entry?.total_minutes || 0) / 60;
export const sumHours  = (entries) => (entries || []).reduce((s, e) => s + hoursOf(e), 0);
export const isUnbilled = (entry) => entry?.billed !== true && !entry?.archived;

// Why an hour isn't billable yet. Shared by the Unbilled screen and the home
// tile so the two can never report different numbers again.
export function unbilledBucket(job) {
  if (!job) return 'nojob';
  const s = job.status;
  if (s === 'complete' || s === 'to_bill') return 'ready';
  if (s === 'return_pending') return 'return';
  if (s === 'billed') return 'mismatch';
  if (['dead', 'lost', 'archived'].includes(s)) return 'dead';
  return 'progress';
}
