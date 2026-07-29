// ============================================
// Archive reasons — and why the class matters
// ============================================
// A visit can fail to be billed for two COMPLETELY different reasons, and
// collapsing them destroys the profitability picture:
//
//   NOT_REAL  — it never happened. Test entry, duplicate, data mistake.
//               No truck rolled. No tech spent an hour. It should vanish from
//               BOTH sides of the ledger: zero revenue, zero cost.
//
//   ABSORBED  — it happened and DRH ate it. Warranty callback, rework we
//               caused, goodwill for a client. The truck rolled. A tech's
//               hours went in. That is REAL COST with ZERO REVENUE — the
//               single most important number on a profitability dashboard,
//               because it is invisible everywhere else.
//
//   SALES     — it happened, real cost, zero revenue on THIS entry, but
//               deliberately separate from ABSORBED. A warranty callback is
//               a cost you want to minimize — it means something went wrong.
//               A sales/estimate visit is a normal, wanted part of running a
//               pipeline. Lumping them together would make a healthy month of
//               prospecting look identical to a month full of mistakes and
//               callbacks — the two numbers need to move independently.
//
// If an absorbed or sales visit gets archived as 'test', its cost disappears
// and the dashboard reports a customer as profitable when DRH actually spent
// real hours on them. That mistake is unrecoverable after the fact — nobody
// remembers in six months. So the class is captured AT ARCHIVE TIME,
// deliberately.

export const ARCHIVE_REASONS = [
  // ── Never happened — excluded from revenue AND cost ──────────────
  { key: 'test',         cls: 'not_real', label: 'Test entry',            hint: 'Not real work. Excluded from everything.' },
  { key: 'duplicate',    cls: 'not_real', label: 'Duplicate',             hint: 'Same visit recorded twice.' },
  { key: 'mistake',      cls: 'not_real', label: 'Data mistake',          hint: 'Logged in error — wrong customer, bad clock-out.' },

  // ── Happened, we ate it — REAL COST, ZERO REVENUE ────────────────
  { key: 'warranty',     cls: 'absorbed', label: 'Warranty / callback',   hint: 'We went back under warranty. Real cost, no revenue.' },
  { key: 'rework',       cls: 'absorbed', label: 'Rework — our fault',    hint: 'We had to fix our own work. Real cost, no revenue.' },
  { key: 'goodwill',     cls: 'absorbed', label: 'Goodwill / no charge',  hint: 'We chose not to bill. Real cost, no revenue.' },
  { key: 'contract',     cls: 'absorbed', label: 'Covered by contract',   hint: 'Inside a monitoring/service agreement.' },

  // ── Happened, real cost, but NOT a mistake — prospecting/estimate work ──
  { key: 'sales_call',   cls: 'sales',    label: 'Sales call / estimate',  hint: 'Prospecting or estimate visit. Real cost, no revenue on this entry.' },
];

export const REASON_BY_KEY = Object.fromEntries(ARCHIVE_REASONS.map(r => [r.key, r]));

// Did a truck actually roll? Drives the cost side of profitability.
export function isRealCost(reason) {
  const cls = REASON_BY_KEY[reason]?.cls;
  return cls === 'absorbed' || cls === 'sales';
}

// Sales cost specifically — kept separate from isRealCost so a dashboard can
// show "cost we ate from mistakes" and "cost of running the pipeline" as two
// different numbers instead of one blended one.
export function isSalesCost(reason) {
  return REASON_BY_KEY[reason]?.cls === 'sales';
}

export function reasonLabel(reason) {
  return REASON_BY_KEY[reason]?.label || reason || 'archived';
}

export function reasonColor(reason) {
  const c = REASON_BY_KEY[reason]?.cls;
  if (c === 'absorbed') return '#f59e0b';   // amber — this cost you money
  if (c === 'sales')    return '#a855f7';   // purple — matches the Estimates lane
  if (c === 'not_real') return '#64748b';   // grey — never happened
  return '#64748b';
}
