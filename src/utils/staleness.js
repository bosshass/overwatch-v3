// ============================================
// Staleness — the "nobody has said anything" rule
// ============================================
// Measures the last time a HUMAN COMMENTED (last_note_at), not the last time a
// row was written. updated_at bumps on any status move or assignment, so a job
// could be dragged around the board all week and never look stale even though
// nobody actually said a word about it.
//
// The wall is MOVEABLE. Sara sets it from the Board header; it lives in
// localStorage so it survives reloads and is per-person — moving your wall does
// not change what anyone else sees. 'off' kills the pulse entirely.

const STALE_KEY = 'ow_stale_days';

export const STALE_OPTIONS = [
  { key: '1',   label: '1 day',   days: 1 },
  { key: '3',   label: '3 days',  days: 3 },
  { key: '7',   label: '7 days',  days: 7 },
  { key: '14',  label: '14 days', days: 14 },
  { key: 'off', label: 'Off',     days: null },
];

export function getStaleDays() {
  try {
    const v = localStorage.getItem(STALE_KEY);
    if (v === 'off') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
  } catch { return 3; }
}

export function setStaleDays(key) {
  try { localStorage.setItem(STALE_KEY, String(key)); } catch { /**/ }
}

// Red kicks in at ~2.3x the amber wall — so moving the wall moves both.
function thresholds() {
  const d = getStaleDays();
  if (d === null) return null;
  return { stale: d * 24, veryStale: d * 24 * 2.33 };
}

// Kept for the alert engine, which uses a fixed org-wide threshold.
export const STALE_HOURS      = 72;
export const VERY_STALE_HOURS = 168;

export function hoursSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

export function ageLabel(iso) {
  const h = hoursSince(iso);
  if (h < 1)  return 'just now';
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

// Terminal work is finished, not rotting.
const TERMINAL = ['complete', 'billed', 'archived', 'dead', 'lost', 'won'];

export function stalenessOf(job) {
  if (!job || TERMINAL.includes(job.status)) return { level: 'ok', hours: 0, label: null };
  const T = thresholds();
  if (!T) return { level: 'ok', hours: 0, label: null };   // wall is off
  const last = job.last_note_at || job.created_at;
  const h = hoursSince(last);
  const word = job.last_note_at ? 'no comment' : 'never commented';
  if (h >= T.veryStale) return { level: 'very_stale', hours: h, label: `${ageLabel(last)} ${word}` };
  if (h >= T.stale)     return { level: 'stale',      hours: h, label: `${ageLabel(last)} ${word}` };
  return { level: 'ok', hours: h, label: null };
}

export const STALE_COLOR = { ok: null, stale: '#f59e0b', very_stale: '#ef4444' };
