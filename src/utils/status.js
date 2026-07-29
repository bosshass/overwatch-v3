// ============================================
// status — one label, one colour, one icon. Per status. Everywhere.
// ============================================
// STATUS_INFO in services/supabase.js has always been the canonical map, but
// six files kept private copies (JobSearchModal, AdminGap, CustomerAudit and
// Workspace ×2). They had drifted: 'return_pending' was "Return Pending" in
// one, "Return needed" in another, "Returns" in a third — same row, three
// words, depending on which screen you were looking at.
//
// This wraps the canonical map with a safe accessor so a status nobody
// anticipated renders as readable text instead of `undefined`.
//
// Import from here. Do not declare another STATUS_LABEL.

import { STATUS_INFO } from '../services/supabase.js';

const FALLBACK = { label: null, color: '#64748b', icon: '•' };

// Turn 'return_pending' into 'Return pending' if it isn't in the map at all —
// better than a blank chip on an unrecognised status.
function humanise(status) {
  if (!status) return 'Unknown';
  const s = String(status).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function statusInfo(status) {
  const hit = STATUS_INFO[status];
  if (hit) return hit;
  return { ...FALLBACK, label: humanise(status) };
}

export const statusLabel = (status) => statusInfo(status).label || humanise(status);
export const statusColor = (status) => statusInfo(status).color;
export const statusIcon  = (status) => statusInfo(status).icon;

// The chip every screen should use, so padding, radius and contrast match.
export function statusChipStyle(status) {
  const c = statusColor(status);
  return {
    background: `${c}22`,
    color: c,
    borderRadius: 20,
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  };
}

export { STATUS_INFO };
