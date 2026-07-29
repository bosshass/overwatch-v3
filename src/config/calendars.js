// ============================================================================
// calendars.js — V3 TEST CALENDARS
//
// CALENDAR RULE (see lanes.js): the ONLY write Overwatch makes to Google
// Calendar is MOVING an event to COMPLETED when a job reaches billed or is
// cleared. No title tags are ever written. Legacy tag parsers are read-only.
//
// ⚠️  MULTI_TECH below is a LIVE DRH CALENDAR. In v9's config it is SUBS.
//     Anything v3 books against it lands on a calendar the real business uses.
//     Repoint it at a throwaway before doing volume testing.
// ============================================================================

export const CALENDARS = {
  // Technician scheduled work — the default booking destination.
  TECH_SCHEDULED:
    'c_be458f239dca170e036324458e234ab06e32b1858816d851e6a6b3c1919fa98a@group.calendar.google.com',

  // Internal / admin. Not customer work, never billed.
  INTERNAL:
    'c_d781da82d1545a165a5a582df7a7ad55392db60efe6fb5fbfef3f7792b6b1ee3@group.calendar.google.com',

  // Multi-tech events — more than one person on one job.
  // ⚠️ LIVE: this is SUBS in v9 production config.
  MULTI_TECH:
    'c_ef1cf02ebba19919b78be38a9c5d2603ef52a838ac4bb37253fd69d718cdcb5c@group.calendar.google.com',
};

// Calendars v3 reads when building the board.
export const SCANNED_CALENDARS = [
  CALENDARS.TECH_SCHEDULED,
  CALENDARS.MULTI_TECH,
];

// Where a booking goes. One tech → tech calendar. More than one → multi-tech.
export function calendarForBooking(techCount) {
  return techCount > 1 ? CALENDARS.MULTI_TECH : CALENDARS.TECH_SCHEDULED;
}

// COMPLETED is the only write destination and is intentionally NOT set yet —
// v3 has no completed calendar. Until it does, the move-on-billed step is a
// no-op rather than a write to a live DRH calendar.
export const COMPLETED_CALENDAR = null;

export const isCompletedConfigured = () => Boolean(COMPLETED_CALENDAR);

// Tentative holds keep Shana's convention verbatim: "Holding <customer>".
export const holdTitle = customerName => `Holding ${customerName}`;
