// ============================================
// lanes — the five destinations. One definition. Everywhere.
// ============================================
// THE PROBLEM THIS EXISTS TO END
//   A job's destination was defined in at least four places:
//     BoardView.COLUMNS      — what the swim lanes are called
//     BoardView.LANE_MOVES   — what the move buttons are called
//     MoveStatus.MOVES       — what the ticket panel offers
//     JobFinishSheet.DISPOS  — what a tech picks in the field
//   They drifted. The board said "New / Notes", the mover said "Triage", the
//   field sheet said "Needs estimate", and Tentative existed in one of them.
//   Same card, four vocabularies, and a destination you could see but not reach.
//
// Everything that moves a job imports from here. If a label needs changing, it
// changes once and every screen follows.

export const LANES = [
  {
    key: 'triage',
    label: 'New / Notes',
    icon: '📝',
    color: '#ef4444',
    // Where a job LANDS when sent here.
    target: 'new',
    // Statuses that render in this lane.
    statuses: ['new', 'needs_details', 'needs_parts', 'pending_materials', 'pending_decision', 'blocked'],
    // What choosing this means, in the words a person would use.
    means: 'Not actionable yet — needs info, parts or a decision',
  },
  {
    key: 'ready',
    label: 'Ready to Schedule',
    icon: '✅',
    color: '#22c55e',
    target: 'ready_to_schedule',
    // return_pending RENDERS in this column (one scheduling queue on the
    // board) but it is NOT the same thing — see RETURN_LANE below.
    statuses: ['ready_to_schedule', 'return_pending'],
    means: 'Good to go — someone needs to put it on a calendar',
  },
  {
    key: 'tentative',
    label: 'Tentative',
    icon: '✏️',
    color: '#f59e0b',
    // No target status: a hold is an overlay on tentative_date, not a status.
    // Choosing it opens the scheduler, because a hold needs a date.
    virtual: 'tentative',
    needsScheduler: 'hold',
    statuses: [],
    means: 'Pencilled in on the Tent calendar — nobody booked yet',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    icon: '📅',
    color: '#3b82f6',
    // Also scheduler-only. Marking this by hand is what produced nine
    // "scheduled" jobs with no date, no tech and no calendar event.
    needsScheduler: 'book',
    statuses: ['scheduled'],
    means: 'A tech is booked and it is on their calendar',
  },
  {
    key: 'estimates',
    label: 'Estimates',
    icon: '📋',
    color: '#a855f7',
    target: 'needs_estimate',
    statuses: ['needs_estimate', 'estimate_sent', 'won', 'lost'],
    means: 'Priced work — waiting on a number or on the customer',
  },
];

// A RETURN is not "ready to schedule." Ready means fresh work waiting for a
// slot. Return means work STARTED and somebody has to go back — it carries a
// reason, it feeds return_cards, and treating the two as one erases why the
// truck is rolling twice. It shares the Ready COLUMN (one scheduling queue)
// but is its own destination with its own name everywhere else.
export const RETURN_LANE = {
  key: 'return',
  label: 'Return Visit',
  icon: '🔄',
  color: '#d97706',
  target: 'return_pending',
  statuses: ['return_pending'],
  means: 'Work started — needs another trip. Say why.',
};

// Billing is a real destination but lives on its own screen, so it is offered
// as a move without being a board column.
export const BILLING_LANE = {
  key: 'billing',
  label: 'Done — To Bill',
  icon: '💵',
  color: '#22c55e',
  target: 'to_bill',
  // 'billed' USED TO LIVE HERE. That was wrong twice over: a paid job rendered
  // as "Done — To Bill" forever, and because no lane had target:'billed' there
  // was no way to reach it — the only exits from To Bill were back to a work
  // lane or Clear, which archives the job and throws away the fact it was
  // invoiced. Eight jobs with real invoice numbers were stuck like that.
  statuses: ['complete', 'to_bill'],
  means: 'Work finished — hours go to Billing to invoice',
};

// Invoiced and closed. The end of the line, and now actually reachable.
export const BILLED_LANE = {
  key: 'billed',
  label: 'Billed',
  icon: '💰',
  color: '#6b7280',
  target: 'billed',
  statuses: ['billed'],
  means: 'Invoiced — nothing further owed on it',
};

// Leaves the active board without touching money. For test rows and dupes.
export const CLEAR_LANE = {
  key: 'clear',
  label: 'Clear (not billable)',
  icon: '🗑️',
  color: '#94a3b8',
  target: 'archived',
  statuses: ['archived', 'dead'],
  means: 'Not real work — remove it without billing anything',
};

export const ALL_LANES = [...LANES, RETURN_LANE, BILLING_LANE, BILLED_LANE, CLEAR_LANE];

const STATUS_TO_LANE = {};
// Order matters: RETURN_LANE registers LAST so return_pending resolves to
// Return (its identity), not Ready (the column it happens to render in).
[...LANES, BILLING_LANE, BILLED_LANE, CLEAR_LANE, RETURN_LANE]
  .forEach(l => l.statuses.forEach(s => { STATUS_TO_LANE[s] = l; }));

// Which lane a job is currently sitting in. A tentative hold wins over the
// underlying status, because that is what the board shows.
// A hold is a PENCIL MARK ON OPEN WORK. It was outranking every status except
// 'scheduled', so a job that got held, worked and marked To Bill stayed in the
// Tentative column with a "To Bill" chip on it — the board showing a plan for
// work that was already finished. A hold can only win while the job is still
// open; once it reaches a settled status the hold is history, not a location.
const SETTLED = ['complete', 'to_bill', 'billed', 'won', 'lost', 'dead', 'archived'];
export const isSettled = (job) => SETTLED.includes(job?.status);

export function laneOf(job) {
  if (!job) return null;
  if (job.tentative_date && job.status !== 'scheduled' && !isSettled(job)) {
    return LANES.find(l => l.key === 'tentative');
  }
  return STATUS_TO_LANE[job.status] || null;
}

// The board used to inline this test twice to build its columns, which is how
// the rule and the lane could disagree. Ask laneOf; don't re-derive it.
export const isHeld = (job) => laneOf(job)?.key === 'tentative';

export const laneLabel = (job) => laneOf(job)?.label || job?.status || 'Unknown';
export const laneColor = (job) => laneOf(job)?.color || '#64748b';

// The moves offered from where a job is now — every lane except its own.
// Deliberately NOT a restrictive transition table: the old one had five
// statuses with no exits at all, so those tickets could not be moved.
export function movesFor(job, { includeBilling = true, includeClear = true } = {}) {
  const here = laneOf(job)?.key;
  // Billed is only a sensible destination for work that is actually finished.
  // Offering it on a job nobody has done yet invites marking unworked jobs paid.
  const finished = ['complete', 'to_bill', 'billed'].includes(job?.status);
  return [
    ...LANES.slice(0, 2),        // New/Notes, Ready
    RETURN_LANE,                 // its own destination, right after Ready
    ...LANES.slice(2),           // Tentative, Scheduled, Estimates
    ...(includeBilling ? [BILLING_LANE] : []),
    ...(includeBilling && finished ? [BILLED_LANE] : []),
    ...(includeClear ? [CLEAR_LANE] : []),
  ].filter(l => l.key !== here);
}
