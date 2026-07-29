// ============================================
// ownership — who owns a job. ONE answer.
// ============================================
// There were two rules for "assigned to Shana" and they disagreed:
//   BoardView    → assigned_to, falling back to tech_name  → 22 cards
//   Workspace    → assigned_to only                        → 0 cards
// Same person, same data, same afternoon. Her workspace looked broken.
//
// Import from here. Do not write a third one.
//
// WHY tech_name IS A FALLBACK AND NOT A MISTAKE
//   `assigned_to` (migration 030) is the real column, but it is new and most
//   rows predate it. `tech_name` has been carrying this meaning informally for
//   months — it holds 'Shana' on 22 open jobs and 'Sara' on 4, and neither of
//   them is a field tech. People used it as a general assignee because nothing
//   else existed. Ignoring it throws away every assignment made before today.
//
//   An explicit `assigned_to` always beats a stale `tech_name`, so reassigning
//   a job actually moves it.

// The roster is PEOPLE, not techs. Office staff own plenty of work and were
// unrepresentable while the only ownership field pointed at the techs table.
export const ASSIGNEES = [
  { email: 'shanaparks@drhsecurityservices.com', name: 'Shana' },
  { email: 'jr@drhsecurityservices.com',          name: 'JR' },
  { email: 'austin@drhsecurityservices.com',      name: 'Austin' },
  { email: 'brian@drhsecurityservices.com',       name: 'Brian' },
  { email: 'trevor@drhsecurityservices.com',      name: 'Trevor' },
  { email: 'admin@jnbservice.com',                name: 'Sara' },
  { email: 'subs@drhsecurityservices.com',        name: 'Subs' },
];

// ── ONE PERSON, SEVERAL LOGINS ───────────────────────────────────────────────
// JR signs in as info@ (the shared mailbox) but his ROSTER email is jr@.
// Sara has admin@jnbservice.com, sara@jnbservice.com and
// accounting@drhsecurityservices.com. Notes were written with whatever Google
// account was signed in, and My Tasks queried the ROSTER address — so JR wrote
// a note as info@, My Tasks looked for jr@, and the note was simply never
// found. Same reason a hand-off "didn't work": the job moved, the card didn't.
//
// Every alias resolves to one canonical person. Writes use the canonical
// address; reads accept ALL of them, so notes already stored under an alias
// surface instead of staying lost.
export const LOGIN_ALIASES = {
  'info@drhsecurityservices.com':       'jr@drhsecurityservices.com',
  'accounting@drhsecurityservices.com': 'admin@jnbservice.com',
  'sara@jnbservice.com':                'admin@jnbservice.com',
  'sara@jnbllc.com':                    'admin@jnbservice.com',
  'drhservicetech1@gmail.com':          'austin@drhsecurityservices.com',
};

// Any login address -> the one roster address for that human.
export function canonicalEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  return LOGIN_ALIASES[e] || e;
}

// Every address this person might have authored something under. Use for READS.
export function emailsFor(email) {
  const canon = canonicalEmail(email);
  if (!canon) return [];
  const aliases = Object.entries(LOGIN_ALIASES)
    .filter(([, target]) => target === canon).map(([alias]) => alias);
  return [...new Set([canon, ...aliases])];
}

export const NAME_BY_EMAIL  = Object.fromEntries(ASSIGNEES.map(a => [a.email, a.name]));
export const EMAIL_BY_NAME  = Object.fromEntries(ASSIGNEES.map(a => [a.name.toLowerCase(), a.email]));

// Normalise free-text tech_name to roster spelling. The data holds 'shana' and
// 'Shana', 'jr', 'Jr' and 'JR' — without this the filter chips silently drop a
// third of someone's cards.
export function canonicalName(raw) {
  const t = (raw || '').trim();
  if (!t) return null;
  const hit = ASSIGNEES.find(a => a.name.toLowerCase() === t.toLowerCase());
  return hit ? hit.name : t;
}

// THE rule. Returns a display name or null.
//
// FIVE PLACES CLAIMED TO ANSWER THIS. In precedence order:
//   1. assigned_to      migration 030, the real column. An explicit choice.
//   2. tech_name        free text, months of informal use, most of the data.
//   3. _tech_name       hydrated from job_assignments (18 rows). OfficeHub read
//                       ONLY this, so it showed nearly every job unassigned and
//                       every tech lane empty — the table is essentially unused.
// Anything past 1 is legacy. Reassigning writes assigned_to, which outranks the
// rest, so a fresh assignment always moves the job.
export function assigneeOf(job) {
  if (!job) return null;
  if (job.assigned_to) {
    const canon = canonicalEmail(job.assigned_to);
    return NAME_BY_EMAIL[canon] || NAME_BY_EMAIL[job.assigned_to] || job.assigned_to;
  }
  return canonicalName(job.tech_name) || canonicalName(job._tech_name);
}

// Is anyone on the hook for this? The one test for "unassigned".
export const isAssigned = (job) => !!assigneeOf(job);

// KPIDashboard grew its own normName() because ownership.js didn't exist yet;
// it split 'JR'/'jr'/'Jr' into three people in every metric. Same rule, one
// name, so the numbers and the board agree about who did what.
export { canonicalName as normName };

// Does this job belong to this person? Accepts either an email or a name.
export function ownsJob(job, emailOrName) {
  if (!job || !emailOrName) return false;
  const name = NAME_BY_EMAIL[emailOrName] || canonicalName(emailOrName);
  return assigneeOf(job) === name;
}

// Statuses that mean "finished or abandoned" — never surface these as someone's
// open work, however they're assigned.
export const CLOSED_STATUSES = ['billed', 'archived', 'dead', 'lost'];
