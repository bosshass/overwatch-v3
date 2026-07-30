// ============================================================================
// api/send-sms.js — the ONLY place an SMS leaves this app.
//
// v3's first serverless function. v9 had one of these and it shipped with
// Access-Control-Allow-Origin:* and no auth, which is an open SMS relay:
// anyone who reads the JS bundle can curl the URL and spend DRH's Twilio
// balance. This one refuses to send without a valid Google token from an
// allowed address, so the cost of the endpoint is bounded by who can sign in.
//
// GET  /api/send-sms          → diagnostics. Tells you which env vars are
//                               present, whether they have stray whitespace,
//                               and whether Twilio accepts the credentials.
//                               Reads nothing, sends nothing, costs nothing.
// POST /api/send-sms          → { to, body, dryRun? }
//
// Env vars (Vercel → Settings → Environment Variables):
//   TWILIO_ACCOUNT_SID            AC…  required
//   TWILIO_AUTH_TOKEN                  required
//   TWILIO_MESSAGING_SERVICE_SID  MG…  preferred sender
//   TWILIO_FROM_NUMBER            +1…  fallback sender, used only if no MG
//   SMS_ALLOWED_DOMAINS               optional, comma-separated. Defaults below.
//
// A Messaging Service (MG…) is preferred over a bare From number because the
// service owns the number pool, the A2P campaign registration and the opt-out
// handling. Point it at whichever number is actually verified and this code
// does not change.
// ============================================================================

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

const DEFAULT_ALLOWED_DOMAINS = ['drhsecurityservices.com', 'jnbservice.com'];

// Twilio returns a numeric code on failure. The code is the useful part; its
// message is not written for the person holding the phone. These are the ones
// that actually stop a small security company from sending.
const HINTS = {
  20003: 'Twilio rejected the credentials. Account SID or Auth Token is wrong — most often a trailing space or a newline pasted into Vercel. Re-copy the Auth Token from the Twilio console and redeploy.',
  21211: 'The destination number is not valid E.164. Expected +1 followed by 10 digits.',
  21266: 'To and From are the same number.',
  21408: 'The account is not permitted to send to this region.',
  21606: 'The From number cannot send SMS — it is not an SMS-capable number on this account.',
  21608: 'Trial account: this destination is not a Verified Caller ID. Verify the number in Twilio, or upgrade the account.',
  21610: 'That number replied STOP. Twilio blocks it permanently until the person texts START.',
  21612: 'Twilio cannot route SMS from this From number to that destination.',
  30032: 'Toll-free number is not verified. Toll-free verification takes days. A local 10-digit number sends immediately — buy one and point the Messaging Service at it.',
  30034: 'A2P 10DLC not registered. A local number needs a Brand + Campaign registration before carriers will deliver. Register in Twilio → Messaging → Regulatory Compliance.',
  63038: 'Daily message limit for a trial account reached.',
};

const clean = v => (typeof v === 'string' ? v.trim() : v);
const dirty = v => typeof v === 'string' && v !== v.trim();

function env() {
  return {
    sid: clean(process.env.TWILIO_ACCOUNT_SID),
    token: clean(process.env.TWILIO_AUTH_TOKEN),
    service: clean(process.env.TWILIO_MESSAGING_SERVICE_SID),
    from: clean(process.env.TWILIO_FROM_NUMBER),
  };
}

// 10 digits → +1. 11 leading 1 → +1. Already +… → left alone.
// Anything else is returned as-is so Twilio names the problem, not us.
function toE164(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s;
}

// Who is calling. The access token is the same one useAuth already holds, so
// nothing new is stored anywhere and there is no shared secret in the bundle.
async function caller(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return { ok: false, why: 'No Authorization header.' };

  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: header },
  });
  if (!r.ok) return { ok: false, why: 'Google rejected the access token. Sign out and back in.' };

  const me = await r.json();
  const email = String(me.email || '').toLowerCase();
  if (!email) return { ok: false, why: 'Token carries no email.' };

  const allowed = (process.env.SMS_ALLOWED_DOMAINS || DEFAULT_ALLOWED_DOMAINS.join(','))
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

  if (!allowed.some(d => email.endsWith(`@${d}`))) {
    return { ok: false, why: `${email} is not on an allowed domain.` };
  }
  return { ok: true, email };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const who = await caller(req);
  if (!who.ok) return res.status(401).json({ ok: false, error: who.why });

  const e = env();

  // ── Diagnostics ──────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const report = {
      ok: true,
      caller: who.email,
      env: {
        TWILIO_ACCOUNT_SID: e.sid
          ? { set: true, looksRight: e.sid.startsWith('AC'), tail: e.sid.slice(-4),
              whitespace: dirty(process.env.TWILIO_ACCOUNT_SID) }
          : { set: false },
        TWILIO_AUTH_TOKEN: e.token
          ? { set: true, length: e.token.length,
              whitespace: dirty(process.env.TWILIO_AUTH_TOKEN) }
          : { set: false },
        TWILIO_MESSAGING_SERVICE_SID: e.service
          ? { set: true, looksRight: e.service.startsWith('MG'), tail: e.service.slice(-4),
              whitespace: dirty(process.env.TWILIO_MESSAGING_SERVICE_SID) }
          : { set: false },
        TWILIO_FROM_NUMBER: e.from
          ? { set: true, value: e.from, looksRight: /^\+\d{10,15}$/.test(e.from),
              whitespace: dirty(process.env.TWILIO_FROM_NUMBER) }
          : { set: false },
      },
      sender: e.service ? `Messaging Service ${e.service.slice(-4)}` : e.from || null,
    };

    if (!e.sid || !e.token) {
      report.twilio = { reachable: false, note: 'Cannot test credentials — SID or token missing.' };
      return res.status(200).json(report);
    }

    // One read-only call. Confirms the credentials before anyone tries to send.
    try {
      const r = await fetch(`${TWILIO_BASE}/Accounts/${e.sid}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${e.sid}:${e.token}`).toString('base64')}` },
      });
      const d = await r.json();
      report.twilio = r.ok
        ? { reachable: true, accountStatus: d.status, accountType: d.type, friendlyName: d.friendly_name }
        : { reachable: false, code: d.code, message: d.message, hint: HINTS[d.code] };
    } catch (err) {
      report.twilio = { reachable: false, message: err.message };
    }
    return res.status(200).json(report);
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // ── Send ─────────────────────────────────────────────────────────────────
  const { to, body, dryRun } = req.body || {};
  if (!to || !body) return res.status(400).json({ ok: false, error: 'Both `to` and `body` are required.' });

  if (!e.sid || !e.token || (!e.service && !e.from)) {
    return res.status(500).json({
      ok: false,
      error: 'Twilio is not configured.',
      detail: 'Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER. Check GET /api/send-sms.',
    });
  }

  const dest = toE164(to);
  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true, to: dest, body,
      sender: e.service ? `Messaging Service ${e.service.slice(-4)}` : e.from,
    });
  }

  const form = new URLSearchParams({ To: dest, Body: String(body) });
  if (e.service) form.set('MessagingServiceSid', e.service);
  else form.set('From', e.from);

  try {
    const r = await fetch(`${TWILIO_BASE}/Accounts/${e.sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${e.sid}:${e.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const d = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: d.message || 'Twilio rejected the message.',
        code: d.code,
        hint: HINTS[d.code] || null,
        to: dest,
      });
    }

    // `queued` is Twilio accepting it, not the carrier delivering it. A message
    // can sit at queued and then fail silently — that is what 30034 looks like
    // from here. Status callbacks are the fix and are not wired yet.
    return res.status(200).json({
      ok: true, sid: d.sid, status: d.status, to: d.to, from: d.from, sentBy: who.email,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Could not reach Twilio: ${err.message}` });
  }
}
