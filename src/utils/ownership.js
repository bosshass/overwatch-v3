// ============================================================================
// ownership.js — who is on a job.
//
// ONE SOURCE. job_assignments. That is the whole design.
//
// v9 had five: jobs.tech_name, jobs.assigned_to, jobs.tech_assigned,
// job_assignments.tech_id, and a case-insensitive fallback chain that had to
// cope with 'shana' vs 'Shana' vs 'Jr' vs 'JR'. assigned_to had approximately
// zero real rows, so every screen actually ran on the tech_name fallback and
// each one drifted differently.
//
// V3: jobs carries NO tech column at all. A job has zero or more assignments.
// A card renders a LIST of people, never a string. Multiple techs on one job is
// the normal case, not an edge case.
// ============================================================================

// assignments: rows from job_assignments, each expected to carry a joined tech
//   { id, job_id, tech_id, day_number, scheduled_for, estimated_hours,
//     is_complete, tech: { id, name, email, calendar_id, color } }

export function techsOn(assignments = []) {
  const seen = new Map();
  for (const a of assignments) {
    const t = a.tech;
    if (t?.id && !seen.has(t.id)) seen.set(t.id, t);
  }
  return [...seen.values()];
}

export const isUnowned = (assignments = []) => techsOn(assignments).length === 0;
export const isMultiTech = (assignments = []) => techsOn(assignments).length > 1;

// Display. Never returns a bare string pretending one person owns it.
export function ownerLabel(assignments = []) {
  const techs = techsOn(assignments);
  if (techs.length === 0) return 'Unassigned';
  if (techs.length === 1) return techs[0].name;
  if (techs.length === 2) return `${techs[0].name} + ${techs[1].name}`;
  return `${techs[0].name} +${techs.length - 1}`;
}

// Identity: one human can hold several logins (jr@ as tech, info@ as operator).
// Match on tech_id where possible; email only as a fallback, case-insensitive.
const norm = s => (s || '').trim().toLowerCase();

export function isOnJob(assignments = [], person = {}) {
  return techsOn(assignments).some(t =>
    (person.id && t.id === person.id) ||
    (person.email && norm(t.email) === norm(person.email))
  );
}

export function assignmentsForTech(assignments = [], person = {}) {
  return assignments.filter(a =>
    (person.id && a.tech?.id === person.id) ||
    (person.email && norm(a.tech?.email) === norm(person.email))
  );
}

// Multi-day work: assignments carry day_number, so a job can span days per tech.
export function daysOn(assignments = []) {
  return [...new Set(assignments.map(a => a.day_number || 1))].sort((a, b) => a - b);
}

export function byDay(assignments = []) {
  const out = new Map();
  for (const a of assignments) {
    const d = a.day_number || 1;
    if (!out.has(d)) out.set(d, []);
    out.get(d).push(a);
  }
  return out;
}

// Booked hours per tech — the honest number, from assignments, not a guess.
export function hoursByTech(assignments = []) {
  const out = new Map();
  for (const a of assignments) {
    const t = a.tech;
    if (!t?.id) continue;
    const hrs = Number(a.estimated_hours) || 0;
    out.set(t.id, { tech: t, hours: (out.get(t.id)?.hours || 0) + hrs });
  }
  return [...out.values()];
}

export const isFullyComplete = (assignments = []) =>
  assignments.length > 0 && assignments.every(a => a.is_complete);

export const isPartiallyComplete = (assignments = []) =>
  assignments.some(a => a.is_complete) && !isFullyComplete(assignments);
