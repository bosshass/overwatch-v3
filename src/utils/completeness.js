import { isAssigned } from './ownership.js';

// ============================================
// completeness — what is this job missing?
// ============================================
// The rule Sara set: every piece of work should end up attached to a REAL
// customer UUID. If the customer genuinely doesn't exist yet, that's fine —
// the tech is never blocked in the field. But the job is ORPHANED until
// someone matches it, and it gets called out loudly everywhere until then.
//
// This file is the single definition of "orphaned" and "incomplete" so the
// Board card, the finish sheet, and JR's alert panel can never disagree.

// A job with no customer_id is not attached to anyone real.
export function isOrphaned(job) {
  return !job?.customer_id;
}

// The specific things missing, in plain words, so an alert can say
// "missing phone, address" instead of a useless "incomplete".
export function missingFields(job) {
  if (!job) return [];
  const missing = [];
  const blank = v => v === null || v === undefined || String(v).trim() === '';

  if (isOrphaned(job))               missing.push('customer link');
  if (blank(job.customer_phone))     missing.push('phone');
  if (blank(job.customer_address))   missing.push('address');
  if (blank(job.issue))              missing.push('issue');
  // was blank(job.tech_name) — flagged jobs as missing an assignee when they
  // had one in assigned_to. The warning fired on correctly-assigned work.
  if (!isAssigned(job))              missing.push('assignee');
  return missing;
}

// "missing customer link, phone, address"
export function missingLabel(job) {
  const m = missingFields(job);
  return m.length ? `missing ${m.join(', ')}` : '';
}

// Terminal work is done — don't nag about it.
const TERMINAL = ['billed', 'archived', 'dead', 'lost'];
export function needsAttention(job) {
  if (!job || TERMINAL.includes(job.status)) return false;
  return isOrphaned(job);
}
