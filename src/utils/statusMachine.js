// ============================================
// JUC-E V3 - Status Machine
// ============================================

import { JOB_STATUS } from '../services/supabase.js';

// Valid transitions — permissive. The office/operator can move a ticket to any other
// status (Bill It from anywhere, schedule from anywhere, un-stick a pending estimate,
// un-archive, etc.). The order below is the order the move buttons appear in.
const FLOW_ORDER = [
  JOB_STATUS.READY_TO_SCHEDULE,
  JOB_STATUS.SCHEDULED,
  JOB_STATUS.NEEDS_PARTS,
  JOB_STATUS.PENDING_MATERIALS,
  JOB_STATUS.PENDING_DECISION,
  JOB_STATUS.NEEDS_DETAILS,
  JOB_STATUS.NEEDS_ESTIMATE,
  JOB_STATUS.ESTIMATE_SENT,
  JOB_STATUS.WON,
  JOB_STATUS.RETURN_PENDING,
  JOB_STATUS.COMPLETE,
  JOB_STATUS.TO_BILL,
  JOB_STATUS.BILLED,
  JOB_STATUS.LOST,
  JOB_STATUS.DEAD,
  JOB_STATUS.ARCHIVED,
  JOB_STATUS.NEW,
];

export const VALID_TRANSITIONS = Object.fromEntries(
  FLOW_ORDER.map(s => [s, FLOW_ORDER.filter(x => x !== s)])
);

export function canTransition(fromStatus, toStatus) {
  return (VALID_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

// Actions
export const ACTIONS = {
  MARK_READY: { label: '✅ Ready to Schedule', toStatus: JOB_STATUS.READY_TO_SCHEDULE, color: '#22c55e' },
  NEEDS_DETAILS: { label: '📝 Needs Details', toStatus: JOB_STATUS.NEEDS_DETAILS, color: '#f97316' },
  NEEDS_PARTS: { label: '📦 Needs Parts', toStatus: JOB_STATUS.NEEDS_PARTS, color: '#eab308' },
  PENDING_DECISION: { label: '⏳ Pending Decision', toStatus: JOB_STATUS.PENDING_DECISION, color: '#a855f7' },
  MATERIALS_IN: { label: '🚚 Materials Received', toStatus: JOB_STATUS.READY_TO_SCHEDULE, color: '#22c55e' },
  SCHEDULE: { label: '📅 Schedule', toStatus: JOB_STATUS.SCHEDULED, color: '#3b82f6' },
  COMPLETE_FIXED: { label: '✅ All Fixed', toStatus: JOB_STATUS.TO_BILL, color: '#22c55e' },
  COMPLETE_RETURN: { label: '🔄 Return Needed', toStatus: JOB_STATUS.RETURN_PENDING, color: '#f59e0b' },
  COMPLETE_SALES: { label: '💰 Sales Opportunity', toStatus: JOB_STATUS.NEEDS_ESTIMATE, color: '#eab308' },
  COMPLETE_NC: { label: '🚫 No Charge', toStatus: JOB_STATUS.BILLED, color: '#6b7280' },
  COMPLETE_PARTS: { label: '📦 Pending Parts', toStatus: JOB_STATUS.NEEDS_PARTS, color: '#eab308' },
  MARK_BILLED: { label: '💰 Billed', toStatus: JOB_STATUS.BILLED, color: '#8b5cf6' },
  SEND_ESTIMATE: { label: '📤 Send Estimate', toStatus: JOB_STATUS.ESTIMATE_SENT, color: '#06b6d4' },
  MARK_WON: { label: '🎉 Won', toStatus: JOB_STATUS.WON, color: '#22c55e' },
  MARK_LOST: { label: '❌ Lost', toStatus: JOB_STATUS.LOST, color: '#6b7280' },
  BILL_MATERIALS: { label: '💵 Bill Materials', toStatus: JOB_STATUS.PENDING_MATERIALS, color: '#8b5cf6' },
  MARK_DEAD: { label: '☠️ Mark Dead', toStatus: JOB_STATUS.DEAD, color: '#374151' },
  KICK_BACK: { label: '↩️ Kick Back', toStatus: JOB_STATUS.NEEDS_DETAILS, color: '#f97316' },
  ARCHIVE: { label: '📁 Archive', toStatus: JOB_STATUS.ARCHIVED, color: '#9ca3af' }
};

// Status groups for each role's view
export const STATUS_GROUPS = {
  ATC_TRIAGE: [JOB_STATUS.NEW, JOB_STATUS.NEEDS_DETAILS, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_MATERIALS],
  FLIGHT_DECK: [JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.RETURN_PENDING],
  ACTIVE: [JOB_STATUS.SCHEDULED],
  BILLING: [JOB_STATUS.TO_BILL, JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON],
  TERMINAL: [JOB_STATUS.BILLED, JOB_STATUS.LOST, JOB_STATUS.DEAD, JOB_STATUS.ARCHIVED]
};

// Helpers
// Helpers — DRH-specific job types from Shana's SOP
export const JOB_TYPE_INFO = {
  service_res: { label: 'SVC - RESI', color: '#dc2626', icon: '🏠', full: 'Service Call - Residential', minutes: 60 },
  service_com: { label: 'SVC - COMM', color: '#b91c1c', icon: '🏢', full: 'Service Call - Commercial', minutes: 60 },
  return_trip: { label: 'RETURN', color: '#ec4899', icon: '🔄', full: 'Return Trip', minutes: 60 },
  install: { label: 'INSTALL', color: '#8b5cf6', icon: '🔨', full: 'New Install', minutes: null },
  new_construction: { label: 'NEW CONST', color: '#6d28d9', icon: '🏗️', full: 'New Construction Install', minutes: null },
  subcontractor: { label: 'SUB', color: '#0891b2', icon: '🤝', full: 'Subcontractor Job', minutes: null },
  government: { label: 'GOV', color: '#1d4ed8', icon: '🏛️', full: 'Government - Clearance', minutes: null },
  estimate: { label: 'ESTIMATE', color: '#0ea5e9', icon: '📐', full: 'Estimate', minutes: null },
  sales: { label: 'SALES', color: '#22c55e', icon: '💼', full: 'Sales Call', minutes: null },
  task: { label: 'TASK', color: '#f59e0b', icon: '📝', full: 'Internal Task', minutes: null },
  note: { label: 'NOTE', color: '#10b981', icon: '📌', full: 'Quick Note', minutes: null },
  service: { label: 'SERVICE', color: '#dc2626', icon: '🔧', full: 'Service Call (legacy)', minutes: 60 },
  project: { label: 'PROJECT', color: '#2563eb', icon: '📋', full: 'Project', minutes: null },
};

export const JOB_TYPE_PICKER = ['service_res', 'service_com', 'return_trip', 'install', 'new_construction', 'subcontractor', 'government', 'estimate', 'sales'];
export const INSTALL_TYPES = ['install', 'new_construction', 'subcontractor', 'government'];

// PRE-SCHEDULE CHECKLIST (Shana's SOP gates)
export const PRE_SCHEDULE_CHECKLIST = [
  { id: 'scope_defined', label: 'Scope clearly defined', auto: true },
  { id: 'tech_assigned', label: 'Technician assigned', auto: true },
  { id: 'parts_confirmed', label: 'Parts confirmed (in stock or ordered)', auto: true },
  { id: 'access_documented', label: 'Access info documented', auto: false },
  { id: 'client_availability', label: 'Client availability confirmed', auto: false },
  { id: 'notes_complete', label: 'Notes complete for tech', auto: false },
];

export function getChecklistState(job, assignments = [], manualChecks = {}) {
  const auto = {
    scope_defined: !!(job.issue && job.issue.trim().length > 3),
    tech_assigned: assignments.some(a => !a.is_complete),
    parts_confirmed: job.status !== 'needs_parts' && job.status !== 'pending_materials',
  };
  const state = {};
  PRE_SCHEDULE_CHECKLIST.forEach(item => {
    if (item.auto && auto[item.id] !== undefined) {
      state[item.id] = auto[item.id];
    } else {
      state[item.id] = !!(manualChecks[item.id]);
    }
  });
  return state;
}

export function getChecklistBlockers(checklistState) {
  return PRE_SCHEDULE_CHECKLIST.filter(item => !checklistState[item.id]);
}

export const PRIORITY_INFO = {
  urgent: { label: 'URGENT', color: '#dc2626', icon: '🔴' },
  high: { label: 'HIGH', color: '#f59e0b', icon: '🟠' },
  normal: { label: 'Normal', color: '#6b7280', icon: '⚪' },
  low: { label: 'Low', color: '#22c55e', icon: '🟢' }
};

export function getJobAge(createdAt) {
  if (!createdAt) return 0;
  const diffMs = Date.now() - new Date(createdAt).getTime();
  if (isNaN(diffMs)) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getAgeUrgency(days) {
  if (days >= 7) return { level: 'critical', color: '#dc2626', label: '7+ days' };
  if (days >= 4) return { level: 'overdue', color: '#f59e0b', label: '4-7 days' };
  if (days >= 2) return { level: 'attention', color: '#eab308', label: '2-3 days' };
  return { level: 'fresh', color: '#22c55e', label: 'Fresh' };
}

// The Service/Urgent intake form's fixed header ("Name: / Phone: / On-Site
// Contact: / Contact Phone: / CMS #: / Access: ☐.../ Scope of Work:") gets
// copied verbatim into job.issue / the calendar event description whenever a
// job is created from that intake flow. Most of it duplicates fields already
// shown elsewhere on the card (name, phone, CMS id) and the rest is unfilled
// placeholder scaffolding — it's noise in every description preview, not
// content. This strips the header, keeping only whatever real scope-of-work
// text was actually written after it (if any).
const INTAKE_TEMPLATE_RE = /^\s*Name:.*?\n\s*Phone:.*?\n(?:\s*On-?Site Contact:.*?\n)?(?:\s*Contact Phone:.*?\n)?(?:\s*CMS\s*#?:.*?\n)?(?:\s*Access:.*?\n)?\s*Scope of Work:\s*/is;

export function stripIntakeTemplate(text) {
  if (!text) return text;
  return text.replace(INTAKE_TEMPLATE_RE, '').trim();
}

// Customer phone fields often hold more than one number in one string, e.g.
// "(800) 787-0545 , Mobile:(970) 282-6985" — a main line plus a labeled
// mobile. Passing that WHOLE string straight into a tel: link produces
// garbage (the dialer tries to parse "Mobile" as digits). This pulls out
// each real number separately, with its label if one precedes it, so each
// can get its own clean tel: link.
export function parsePhoneNumbers(raw) {
  if (!raw) return [];
  const re = /(?:([A-Za-z][A-Za-z\s]{0,12}):\s*)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/g;
  const out = [];
  let m;
  while ((m = re.exec(raw))) {
    out.push({ label: m[1]?.trim() || null, digits: `${m[2]}${m[3]}${m[4]}`, display: `(${m[2]}) ${m[3]}-${m[4]}` });
  }
  return out;
}
