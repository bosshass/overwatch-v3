// ============================================================================
// lanes.js — THE vocabulary. Every screen imports from here.
//
// SPEC DECISIONS BAKED IN (2026-07-28 / 07-29):
//
//   1. Six lanes: Open → Needs Action → Scheduled → Returns → Estimates →
//      Good to Go.
//
//   2. TENTATIVE IS NOT A LANE. It is a badge on a card that stays in Open or
//      Returns. Tentative was dropped from the V3 schema entirely (not MVP).
//      own column. Inverted here — see hasHold().
//
//   3. "Bill it" is GOOD TO GO. Nobody in the field decides what gets billed —
//      the tech says the work is finished, Accounting decides the money.
//      v9 kept the stored value 'bill_it' to avoid migrating 358 rows. V3
//      launched empty, so the stored value IS 'good_to_go'.
//
//   4. SCHEDULED is scheduler-only. Setting it by hand produced nine "scheduled"
//      jobs with no date, no tech and no calendar event.
//
//   5. STRANDED work folds into Needs Action — scheduled, date passed, no time
//      entry. That is what the ctx argument to laneOf() is for.
//
//   6. ESTIMATES holds only 'sent'. not created -> Needs Action (it's on us);
//      won -> Needs Action (order parts); lost -> Accounting, to review and
//      archive against the customer. 'estimate_lost' therefore CANNOT be a
//      closed status — v9 had it closed AND in the Estimates lane, so Billing
//      could never see it.
//
//   7. Entry gate on Open: cannot ENTER without priority and estimated_hours.
//      Blocks entry, not exit. In v9 estimated_hours was null on all 400 jobs
//      and the scheduler silently assumed 4h for every one. due_date warns on
//      save but never blocks.
//
//   8. NON-BILLABLE IS NOT A JOB STATUS. (2026-07-29)
//      It is a decision made during the billing pass, by the one person doing
//      billing, looking at hours. It lives on time_entries.billable and is set
//      only in the Accounting screen. A tech, a scheduler, or anyone not doing
//      accounting never sees the field and never needs to.
//      Putting it on the board would print a word on every screen that exactly
//      one role can act on — the same mistake as v9's [NC] tag.
//      The job's own exit is 'closed': Accounting is finished with it. Whether
//      the hours were charged or written off is recorded against the hours.
//
//   9. There is no People screen. Not in the mockup, not in v3. It was a 9.16.0
//      invention that replaced My Tasks and OfficeHub without being asked for.
//
// CALENDAR RULE — REVISED 3.1.0:
//   Booking CREATES a calendar event, and rebooking removes the old one first.
//   The earlier rule ("the only write is move-to-Completed") was written when
//   the risk was v3 scribbling on live DRH calendars. With test calendars in
//   place the worse failure is a booking that exists on the board and not on
//   anyone's calendar — that disagreement is what produced v9's ghost bookings.
//   Still true: no [BILL IT] / [RETURN] / [IN PROGRESS] / [ESTIMATE] title tags
//   are ever written. Titles are "<Customer> — <what>". Legacy tag parsers stay
//   READ-ONLY. Tentative holds keep "Holding <customer>" verbatim.
// ============================================================================

export const LANES = [
  {
    key: 'open',
    label: 'Open',
    color: '#22c55e',
    target: 'ready_to_schedule',
    statuses: ['ready_to_schedule'],
    means: 'Ready — someone needs to put it on a calendar',
        entryGate: ['priority', 'estimated_hours'],
  },
  {
    key: 'needs_action',
    label: 'Needs action',
    color: '#ef4444',
    target: 'new',
    statuses: [
      'new', 'needs_details', 'needs_parts', 'pending_materials',
      'pending_decision', 'blocked',
      'needs_estimate',   // not written yet — on us, not the customer
      'won',              // estimate won — go order parts
    ],
    means: 'Somebody has to do something before this can be scheduled',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    color: '#3b82f6',
    statuses: ['scheduled'],
    needsScheduler: 'book',
    means: 'A tech is booked and it is on their calendar',
  },
  {
    key: 'returns',
    label: 'Returns',
    color: '#d97706',
    target: 'return_pending',
    statuses: ['return_pending'],
    means: 'Work started — needs another trip. Say why.',
        requiresReason: true,
  },
  {
    key: 'estimates',
    label: 'Estimates',
    color: '#8b5cf6',
    target: 'estimate_sent',
    statuses: ['estimate_sent'],
    means: 'Sent — waiting on the customer',
  },
  // good_to_go is NOT a board lane — it is the billing queue.
  // Jobs reaching this status leave the board and appear in the Billing tab.
  // They are fetchable and closeable from there; the board never renders them.
];

export const LANE_KEYS = LANES.map(l => l.key);
export const laneByKey = k => LANES.find(l => l.key === k) || null;
export const laneLabel = k => (laneByKey(k)?.label) ?? k;

// Off-board, Accounting-only. Never rendered as a lane.
// good_to_go is the billing queue — off the board, visible in the Billing tab.
export const ACCOUNTING_QUEUE = ['estimate_lost', 'good_to_go'];

// Genuinely finished. 'closed' means Accounting is done with it — NOT that
// money changed hands. That question lives on time_entries.billable.
export const CLOSED_STATUSES = ['closed', 'archived', 'dead'];

export const isClosed = status => CLOSED_STATUSES.includes(status);
export const isOpenWork = status => !isClosed(status);

// ── laneOf ───────────────────────────────────────────────────────────────────
// ctx optional: { hasTimeEntry: bool, today: Date }
export function laneOf(job, ctx) {
  if (!job) return null;
  const status = job.status;

  if (isClosed(status) || ACCOUNTING_QUEUE.includes(status)) return null;

  if (status === 'scheduled' && ctx) {
    // Both sides of this comparison must be LOCAL and both must be dates.
    //
    // `new Date('2026-08-01')` parses a bare date string as UTC midnight, while
    // `new Date()` is local now. In Mountain time that made every job scheduled
    // for TOMORROW drop into Needs action at 6:00 PM TODAY — the moment UTC
    // rolled over. Same trap startTimestamp() in jobs.js documents.
    //
    // And today is not past. A job scheduled for today is today's work, not
    // an overdue job, right up until the day ends.
    // jobs holds no dates. The schedule lives on job_assignments; ctx.nextScheduled
    // is supplied by the caller from v_job_schedule.
    const when = ctx.nextScheduled ? new Date(ctx.nextScheduled) : null;
    const now = ctx.today || new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (when && when < startOfToday && !ctx.hasTimeEntry) return 'needs_action';
  }

  const lane = LANES.find(l => l.statuses.includes(status));
  return lane ? lane.key : 'needs_action';   // unknown status = someone look at it
}

// Tentative holds were dropped from the schema (not MVP). Kept as a stub so
// callers do not break; always false until a hold model exists.
export const hasHold = () => false;

// ── Gates ────────────────────────────────────────────────────────────────────
export function gateFailures(job, targetLaneKey) {
  const lane = laneByKey(targetLaneKey);
  if (!lane?.entryGate) return [];
  return lane.entryGate.filter(f => {
    const v = job?.[f];
    return v === null || v === undefined || v === '';
  });
}

export function softWarnings(job) {
  const w = [];
  if (!job?.due_date) w.push('due_date');
  return w;
}

export function canMoveTo(job, targetLaneKey, ctx = {}) {
  // good_to_go requires at least one time entry with hours. The field team
  // must log time before a job leaves the board — no hours means no visit.
  if (targetLaneKey === 'good_to_go' && !ctx.hasTimeEntry) {
    return { ok: false, reason: 'Log hours before marking Good to go — no time entries found.' };
  }
  const lane = laneByKey(targetLaneKey);
  if (!lane) return { ok: false, reason: 'Unknown lane' };

  if (lane.needsScheduler) {
    return {
      ok: false,
      reason: 'Book it through the scheduler — Scheduled cannot be set by hand',
    };
  }

  const missing = gateFailures(job, targetLaneKey);
  if (missing.length) {
    return {
      ok: false,
      reason: `Needs ${missing.join(' and ')} before it can go to ${lane.label}`,
      missing,
    };
  }
  return { ok: true, target: lane.target };
}

export function moveOptions(job, ctx) {
  const current = laneOf(job, ctx);
  const opts = LANES
    .filter(l => l.key !== current && !l.needsScheduler)
    .map(l => ({ key: l.key, label: l.label, target: l.target, ...canMoveTo(job, l.key, ctx) }));

  // good_to_go is not a LANE but IS a valid move target — always offer it,
  // gated on hasTimeEntry. This is the only path to the Billing tab.
  if (current !== 'good_to_go') {
    opts.push({
      key: 'good_to_go',
      label: 'Good to go',
      target: 'good_to_go',
      ...canMoveTo(job, 'good_to_go', ctx),
    });
  }
  return opts;
}

// ── Accounting ───────────────────────────────────────────────────────────────
// The ONLY place billable / non-billable is decided. Field surfaces must not
// import anything below this line.
export const NON_BILLABLE_REASONS = [
  'Warranty',
  'Callback — our error',
  'Sales call',
  'Goodwill',
  'Absorbed cost',
  'Contract / included',
];

// A job may close once every time entry is resolved — billed, or written off
// with a reason. Nothing sits in limbo.
export function canClose(timeEntries = []) {
  const unresolved = timeEntries.filter(
    t => !t.archived && !t.billed && t.billable !== false
  );
  if (unresolved.length === 0) return { ok: true };
  return {
    ok: false,
    unresolved: unresolved.length,
    reason: `${unresolved.length} time ${unresolved.length === 1 ? 'entry is' : 'entries are'} still unresolved`,
  };
}
