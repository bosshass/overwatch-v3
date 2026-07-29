// ============================================
// Overwatch — real email send via Gmail API
// ============================================
// Sends from the LOGGED-IN user's Gmail using the same OAuth token the
// calendar already uses. Requires the gmail.send scope (added to SCOPES
// in App.jsx v9.3.5) — users grant it on their next sign-in.
// No server, no env vars, no Twilio-style config.

import { assignmentMessage } from '../config/appBase.js';

// Base64url-encode a UTF-8 string (Gmail requires base64url, not plain base64)
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Send an email. Returns { ok, msg }.
// { ok:false, reauth:true } means the token lacks gmail.send —
// the user needs to sign out/in once to grant the new scope.
export async function sendGmail(accessToken, { to, subject, body }) {
  if (!accessToken) return { ok: false, msg: 'Not signed in' };
  if (!to) return { ok: false, msg: 'No email address' };

  const raw = [
    `To: ${to}`,
    `Subject: ${subject || '(no subject)'}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body || '',
  ].join('\r\n');

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
    if (res.ok) return { ok: true, msg: `Sent to ${to}` };
    const err = await res.json().catch(() => ({}));
    const detail = err?.error?.message || `HTTP ${res.status}`;
    // 403 insufficient scope = token predates the gmail.send scope
    if (res.status === 403 && /insufficient|scope/i.test(detail)) {
      return { ok: false, reauth: true, msg: 'Email permission not granted yet — sign out and back in once, then retry.' };
    }
    return { ok: false, msg: detail };
  } catch (e) {
    return { ok: false, msg: e.message || 'Send failed' };
  }
}

// Standard assignment notification body
export function assignmentEmail(techName, job) {
  return {
    subject: `Job assigned: ${job.customer_name || 'Job'}`,
    body: `Hi ${techName},\n\n${assignmentMessage(job)}` +
      (job.customer_address ? `\n\nAddress: ${job.customer_address}` : '') +
      `\n\n— Overwatch`,
  };
}

