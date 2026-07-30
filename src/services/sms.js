// ============================================================================
// sms.js — the ONLY place the app calls the SMS endpoint.
//
// Same rule as jobs.js: one writer, one place to audit. If a "text the
// customer" button ever lands on TicketSheet or MyWork, it calls sendSms()
// from here. It does not fetch /api/send-sms directly.
//
// The Google access token goes with every call because the endpoint refuses
// anonymous senders. getAccessToken() is useAuth's read-only accessor — this
// file never mounts a hook and never writes a token.
// ============================================================================

import { getAccessToken } from './useAuth';

const ENDPOINT = '/api/send-sms';

function authHeader() {
  const t = getAccessToken();
  if (!t) throw new Error('Not signed in — no access token to authorize the send.');
  return { Authorization: `Bearer ${t}` };
}

// Kept in sync with toE164() in api/send-sms.js. Duplicated deliberately: the
// UI wants to show the operator what will be dialed BEFORE they hit send, and
// the server cannot be trusted to be the only validator of its own input.
export function formatPhone(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s;
}

export function isSendable(raw) {
  return /^\+\d{10,15}$/.test(formatPhone(raw));
}

// Returns { ok, sid, status, ... } or { ok:false, error, code, hint }.
// Never throws on a Twilio refusal — a rejected message is data, not a crash.
export async function sendSms({ to, body, dryRun = false }) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ to, body, dryRun }),
  });
  try {
    return await r.json();
  } catch {
    return { ok: false, error: `Endpoint returned ${r.status} with no JSON body.` };
  }
}

// Configuration check. Sends nothing.
export async function smsDiag() {
  const r = await fetch(ENDPOINT, { headers: authHeader() });
  try {
    return await r.json();
  } catch {
    return { ok: false, error: `Endpoint returned ${r.status} with no JSON body.` };
  }
}
