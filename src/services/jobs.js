// ============================================================================
// jobs.js — the ONLY place job state is written.
//
// v9 had five schedulers and several independent status writers. Two of them
// wrote columns that did not exist (9.17.2 fixed changeStatus doing exactly
// that). Every mutation in v3 goes through this file so there is one place to
// audit and one place to fix.
//
// Rules enforced here, not in the UI:
//   - Scheduled cannot be set by hand. Only book() reaches it.
//   - Open has an entry gate (priority + estimated_hours).
//   - Every move writes job_history. No silent state changes.
//   - Ownership writes go to job_assignments. jobs has no tech column.
// ============================================================================

import { supabase } from './supabaseClient';
import { canMoveTo, laneByKey, softWarnings, canClose } from '../utils/lanes';

const JOB_SELECT = `
  *,
  customer:customers ( id, short_code, name, address, phone, cs_number ),
  assignments:job_assignments (
    id, tech_id, day_number, scheduled_for, estimated_hours,
    is_complete, calendar_event_id,
    tech:techs ( id, name, email, calendar_id, color )
  )
`;

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchBoard() {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .not('status', 'in', '(closed,archived,dead)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Stranded detection needs to know which jobs have any time logged.
  const ids = jobs.map(j => j.id);
  let withTime = new Set();
  if (ids.length) {
    const { data: te } = await supabase
      .from('time_entries')
      .select('job_id')
      .in('job_id', ids);
    withTime = new Set((te || []).map(t => t.job_id));
  }

  return jobs.map(j => ({ ...j, hasTimeEntry: withTime.has(j.id) }));
}

export async function fetchJob(id) {
  const { data, error } = await supabase
    .from('jobs').select(JOB_SELECT).eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchTimeEntries(jobId) {
  const { data, error } = await supabase
    .from('time_entries').select('*')
    .eq('job_id', jobId)
    .order('event_start', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── The single status write path ─────────────────────────────────────────────

export async function moveTo(job, laneKey, { actor, note } = {}) {
  const verdict = canMoveTo(job, laneKey);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, missing: verdict.missing };

  const target = laneByKey(laneKey).target;
  const from = job.status;

  const patch = { status: target, updated_at: new Date().toISOString(), updated_by: actor || null };

  // Leaving a hold behind clears it — a hold is a badge, not a destination,
  // and a stale one is how v9 produced ghost bookings.
  if (laneKey !== 'open' && laneKey !== 'returns') {
    patch.tentative_date = null;
    patch.tentative_event_id = null;
  }

  const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
  if (error) return { ok: false, reason: error.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: from, to_status: target,
    notes: note || null, changed_by: actor || null,
  });

  return { ok: true, status: target, warnings: softWarnings(job) };
}

// ── Booking — the only route into Scheduled ──────────────────────────────────
// techs: [{ id, hours, day }]. More than one is normal, not an edge case.

export async function book(job, { techs = [], date, actor } = {}) {
  if (!techs.length) return { ok: false, reason: 'Pick at least one tech' };
  if (!date) return { ok: false, reason: 'Pick a date' };

  const { error: delErr } = await supabase
    .from('job_assignments').delete().eq('job_id', job.id);
  if (delErr) return { ok: false, reason: delErr.message };

  const rows = techs.map(t => ({
    job_id: job.id,
    tech_id: t.id,
    day_number: t.day || 1,
    scheduled_for: date,
    estimated_hours: t.hours ?? job.estimated_hours ?? null,
    created_by: actor || null,
  }));

  const { error: insErr } = await supabase.from('job_assignments').insert(rows);
  if (insErr) return { ok: false, reason: insErr.message };

  const { error: jobErr } = await supabase.from('jobs').update({
    status: 'scheduled',
    scheduled_date: date,
    tentative_date: null,
    tentative_event_id: null,
    is_multi_day: new Set(techs.map(t => t.day || 1)).size > 1,
    updated_at: new Date().toISOString(),
    updated_by: actor || null,
  }).eq('id', job.id);
  if (jobErr) return { ok: false, reason: jobErr.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'scheduled',
    notes: `Booked ${techs.length} tech${techs.length > 1 ? 's' : ''} for ${date}`,
    changed_by: actor || null,
  });

  return { ok: true, techCount: techs.length };
}

// A hold is a badge. It does not move the card out of its lane.
export async function hold(job, { date, actor } = {}) {
  const { error } = await supabase.from('jobs')
    .update({ tentative_date: date, updated_at: new Date().toISOString(), updated_by: actor || null })
    .eq('id', job.id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function clearHold(job, { actor } = {}) {
  const { error } = await supabase.from('jobs')
    .update({ tentative_date: null, tentative_event_id: null, updated_by: actor || null })
    .eq('id', job.id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// ── Accounting ───────────────────────────────────────────────────────────────
// Not reachable from any field screen.

export async function markNonBillable(entryId, reason, actor) {
  if (!reason) return { ok: false, reason: 'A reason is required' };
  const { error } = await supabase.from('time_entries').update({
    billable: false, non_billable_reason: reason,
    resolved_by: actor || null, resolved_at: new Date().toISOString(),
  }).eq('id', entryId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export async function markBilled(entryId, actor) {
  const { error } = await supabase.from('time_entries').update({
    billed: true, billed_at: new Date().toISOString(),
    resolved_by: actor || null, resolved_at: new Date().toISOString(),
  }).eq('id', entryId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

// Closing requires every entry resolved. This is the gate that stops work
// piling up unbilled the way 61 entries / 209.5 hours did in v9.
export async function closeJob(job, actor) {
  const entries = await fetchTimeEntries(job.id);
  const verdict = canClose(entries);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const { error } = await supabase.from('jobs').update({
    status: 'closed', completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), updated_by: actor || null,
  }).eq('id', job.id);
  if (error) return { ok: false, reason: error.message };

  await supabase.from('job_history').insert({
    job_id: job.id, from_status: job.status, to_status: 'closed',
    notes: 'Closed by Accounting', changed_by: actor || null,
  });
  return { ok: true };
}
