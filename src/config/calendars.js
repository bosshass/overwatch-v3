// ============================================================================
// calendars.js — PER-TECH CALENDAR MODEL (2026-08-05)
//
// WHAT CHANGED AND WHY
//
// The old config hardcoded three calendars and chose between them by headcount:
// one tech -> TECH_SCHEDULED, more than one -> MULTI_TECH. Both were wrong.
//
//   * TECH_SCHEDULED was a single test calendar. Every booking in the database
//     landed on it regardless of who was assigned. techs.calendar_id was never
//     read, so correcting a tech's calendar changed nothing.
//
//   * MULTI_TECH pointed at the LIVE DRH Subs calendar. Test bookings wrote
//     real events onto a calendar the business uses.
//
// THE MODEL NOW: the tech's calendar IS the assignment.
//
//   A booking writes ONE EVENT PER TECH, on that tech's own calendar. Two techs
//   means two events, not one shared event on a "multi" calendar. The calendar
//   an event lives on is what says whose work it is; a shared event says nothing.
//
//   Every pointer is a PAIR: (calendar_id, event_id). Google cannot fetch,
//   patch, move or delete an event from the id alone. Both live on
//   job_assignments, one row per tech per day. jobs holds no calendar columns.
//
// RESCHEDULE vs RETURN — opposite operations, never inferred:
//   reschedule -> PATCH the existing event in place. Same row, same event id.
//   return     -> CREATE a new event and a new assignment row. Original untouched.
//
// EVENT MARKER: every event Overwatch creates carries
// extendedProperties.private.owJobId. It separates "we made this" from "a tech
// booked it by hand". Without it, drift detection is guesswork on titles.
// ============================================================================

// Where finished work rests. Events are MOVED here so tech calendars only show
// live work. Deliberately not read when building the board.
export const COMPLETED_CALENDAR =
  'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com';

export const isCompletedConfigured = () => Boolean(COMPLETED_CALENDAR);

// Availability only. Read to see who is out; NEVER written to, and an event
// here must never create a job.
export const PTO_CALENDAR =
  'c_cd460585d696524afa5b058d369c563584690aa2f7b654f64993a973e9cb5127@group.calendar.google.com';

export const OW_JOB_PROP = 'owJobId';

export const eventMarker = jobId => ({ private: { [OW_JOB_PROP]: String(jobId) } });

export const markerOf = ev => ev?.extendedProperties?.private?.[OW_JOB_PROP] || null;

// A tech's calendar. Null means none configured — surface it, never fall back
// to a shared calendar. That fallback is how everything ended up on one.
export function calendarForTech(tech) {
  return tech?.calendar_id || null;
}

// Calendars the board reads: each active tech's own. Resolved from the techs
// table at call time, not hardcoded.
export function scannedCalendars(techs = []) {
  return [...new Set(techs.filter(t => t.is_active && t.calendar_id).map(t => t.calendar_id))];
}

export const holdTitle = customerName => `Holding ${customerName}`;
