// ============================================
// billing — what a visit is worth, and who has said so. ONE vocabulary.
// ============================================
// THE PROBLEM THIS EXISTS TO END
//   "Has this been billed?" had six answers living in six places:
//     time_entries.disposition   what the tech picked in the field
//     time_entries.billed        the flag Unbilled stamps
//     jobs.status                to_bill / billed / complete
//     jobs.invoice_ref           the invoice number, when someone typed one
//     the Completed calendar     where the office drags finished events
//     the event TITLE            [BILL IT] [BILLED] [TO BILL] [NC] [FF] ...
//   None outranks the others and none is derived from the rest, so a job could
//   read "To Bill" on the board, sit on a tech calendar tagged [BILL IT], have
//   no time entry at all, and never appear in Billing. All four were true.
//
// This file does not merge them — merging them is a data project. It gives
// every screen ONE way to READ them, so at least the app stops disagreeing
// with itself while that gets sorted out.

// ── What the tech said in the field ──────────────────────────────────────────
// FieldVisits, CustomerHistory, CustomerAudit and JobFinishSheet each had a
// private copy of this. They had already drifted: `return` was #f97316 in two
// and #f59e0b in the third, `in_progress` had three different colours. Same
// tag, different colour depending on which screen you opened.
export const DISPOSITIONS = {
  bill_it:     { key: 'bill_it',     label: 'Bill it',     color: '#22c55e',
                 means: 'Work is done and chargeable' },
  return:      { key: 'return',      label: 'Return',      color: '#f97316',
                 means: 'Started — somebody has to go back before this can bill' },
  estimate:    { key: 'estimate',    label: 'Estimate',    color: '#3b82f6',
                 means: 'Priced work — waiting on a number or on the customer' },
  in_progress: { key: 'in_progress', label: 'In progress', color: '#00c8e8',
                 means: 'Mid-job — not finished, not billable yet' },
};

export const DISPO_KEYS = Object.keys(DISPOSITIONS);

export function dispo(d) {
  return DISPOSITIONS[d] || {
    key: d || null,
    label: (d || '—').replace(/_/g, ' '),
    color: '#cbd5e1',
    means: '',
  };
}

// ── What the office wrote in the calendar event TITLE ────────────────────────
// This vocabulary was never defined anywhere; it accreted. These are the tags
// actually in use on the DRH calendars, read off July 2026:
//
//   [BILL IT]      tech finished it, office has not invoiced
//   [TO BILL]      same intent, different words — both are in the data
//   [BILLED]       invoiced. Note: these events often are NOT on the Completed
//                  calendar, so "not on Completed" does NOT mean "not billed"
//   [Invoice NNN]  billed WITH a reference — the only self-evidencing tag
//   [NC]           no charge
//   [FF]           field free / follow-up, not chargeable on its own
//   [ESTIMATE]     quoted, not work
//   [RETURN]       needs another trip
//   [IGNORE]       not work at all (PTO, meetings, personal)
//
// Nothing enforces these and nothing reads them back. Parsing them in one place
// at least makes reconciliation possible instead of eyeballing titles.
export const TITLE_TAGS = {
  BILL_IT:  { re: /\[\s*BILL\s*IT\s*\]/i,       state: 'to_bill',  label: 'Bill it' },
  TO_BILL:  { re: /\[\s*TO\s*BILL\s*\]/i,       state: 'to_bill',  label: 'To bill' },
  BILLED:   { re: /\[\s*BILLED\s*\]/i,          state: 'billed',   label: 'Billed' },
  INVOICE:  { re: /\[\s*Invoice\s+([\w-]+)\s*\]/i, state: 'billed', label: 'Invoiced' },
  NC:       { re: /\[\s*NC\s*\]/i,              state: 'no_charge', label: 'No charge' },
  FF:       { re: /\[\s*FF\s*\]/i,              state: 'no_charge', label: 'Field free' },
  ESTIMATE: { re: /\[\s*ESTIMATE[^\]]*\]/i,     state: 'estimate', label: 'Estimate' },
  RETURN:   { re: /\[\s*RETURN\s*\]/i,          state: 'return',   label: 'Return' },
  IGNORE:   { re: /\[\s*IGNORE\s*\]/i,          state: 'ignore',   label: 'Not work' },
};

// Read every tag off an event title. Returns the tags found, the invoice
// reference if one was written, and the title with the tags stripped.
export function parseTitleTags(title) {
  const t = String(title || '');
  const found = [];
  let invoiceRef = null;
  for (const [name, def] of Object.entries(TITLE_TAGS)) {
    const m = t.match(def.re);
    if (!m) continue;
    found.push({ name, ...def });
    if (name === 'INVOICE' && m[1]) invoiceRef = m[1];
  }
  const clean = t.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
  return { tags: found, invoiceRef, clean, chargeable: !found.some(f => f.state === 'no_charge' || f.state === 'ignore') };
}

// ── Do the sources agree? ────────────────────────────────────────────────────
// The honest answer for a single visit. Returns what each source says and
// whether they conflict, rather than picking a winner it has no right to pick.
//
//   job    a jobs row (or null)
//   entry  a time_entries row (or null)
//   title  the calendar event title, if you have it
export function billingStateOf({ job = null, entry = null, title = null } = {}) {
  const fromTitle  = title ? parseTitleTags(title) : null;
  const titleState = fromTitle?.tags.find(t => t.state === 'billed' || t.state === 'to_bill')?.state || null;
  const jobState   = job?.status === 'billed' ? 'billed'
                   : ['to_bill', 'complete'].includes(job?.status) ? 'to_bill'
                   : null;
  const entryState = entry ? (entry.billed ? 'billed' : 'to_bill') : null;

  const said = [titleState, jobState, entryState].filter(Boolean);
  const agree = said.length <= 1 || said.every(s => s === said[0]);

  return {
    title: titleState, job: jobState, entry: entryState,
    invoiceRef: fromTitle?.invoiceRef || job?.invoice_ref || entry?.invoice_ref || null,
    hasHours: !!(entry && entry.total_minutes > 0),
    agree,
    // The one thing worth alerting on: somebody says billed, somebody says not.
    conflict: !agree,
  };
}
