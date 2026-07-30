// ============================================================================
// contact.js — the ONLY place a customer contact is composed or recorded.
//
// This is the P2P path: it opens the phone's own messaging app with the number
// and text prefilled, and the person taps send. The message leaves THEIR line,
// not a DRH shortcode, which is why it needs no A2P 10DLC registration, costs
// nothing, and works tonight.
//
// It is also better for field work than a shared number would be. The reply —
// "gate code is 4412", "make it 3pm" — goes back to the phone of the person
// actually driving there. A2P is only needed for UNATTENDED sends (automated
// confirmations firing with nobody tapping). That is api/send-sms.js, and it
// waits on the campaign.
//
// No "Reply STOP to opt out" in these templates. That language belongs on A2P
// traffic. On a person's own line it is wrong and it reads like a robot.
//
// Every tap is logged to job_history through addNote — the same single writer
// notes already use. An untracked contact is the thing that makes two people
// call the same customer an hour apart.
// ============================================================================

import { addNote } from './jobs';

export const digits = p => String(p || '').replace(/[^\d+]/g, '');

export const canContact = p => digits(p).replace(/\D/g, '').length >= 10;

export const telHref = p => (canContact(p) ? `tel:${digits(p)}` : null);

// `?&body=` is not a typo. iOS wants `sms:NUMBER&body=…`, Android wants
// `sms:NUMBER?body=…`. The combined form is the one string both parse.
export function smsHref(phone, body) {
  if (!canContact(phone)) return null;
  return `sms:${digits(phone)}?&body=${encodeURIComponent(body || '')}`;
}

// Short form of an address — "1412 Elm" not the full postal line. The customer
// knows where they live; the point is confirming we mean the right property.
function shortAddr(customer) {
  const a = String(customer?.address || '').split(',')[0].trim();
  return a || 'your property';
}

function firstName(actorEmail, techName) {
  if (techName) return String(techName).split(' ')[0];
  const local = String(actorEmail || '').split('@')[0];
  if (!local) return 'DRH';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function whenText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'numeric', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

// ── Templates ────────────────────────────────────────────────────────────────
// Each returns { key, label, body }. Kept short on purpose: a text that runs
// past two lines gets skimmed, and long ones split into billable segments if
// they ever move to the A2P path.

export function templatesFor({ job, customer, actor, techName, scheduledFor }) {
  const me = firstName(actor, techName);
  const place = shortAddr(customer);
  const when = whenText(scheduledFor);

  const list = [
    {
      key: 'en_route',
      label: 'On my way',
      body: `Hi, this is ${me} with DRH Security Services — I'm on my way to ${place} now.`,
    },
    {
      key: 'arrived',
      label: 'Here, no answer',
      body: `This is ${me} with DRH Security Services — I'm at ${place} and can't get an answer. Give me a call at this number when you see this.`,
    },
    {
      key: 'access',
      label: 'Need access',
      body: `Hi, this is ${me} with DRH Security Services. To finish the work at ${place} I need access — is there a gate code or someone on site who can let me in?`,
    },
    {
      key: 'running_late',
      label: 'Running late',
      body: `Hi, this is ${me} with DRH Security Services — running behind on the job before yours. I'll text when I'm heading your way.`,
    },
    {
      key: 'follow_up',
      label: 'Follow up',
      body: `Hi, this is ${me} with DRH Security Services following up on ${job?.issue ? `the ${String(job.issue).slice(0, 60)}` : 'your service request'}. Let me know a good time and I'll get it scheduled.`,
    },
  ];

  if (when) {
    list.unshift({
      key: 'confirm',
      label: 'Confirm appointment',
      body: `Hi, this is ${me} with DRH Security Services confirming ${when} at ${place}. Reply here if that no longer works.`,
    });
  }
  return list;
}

// ── Logging ──────────────────────────────────────────────────────────────────
// Called on the tap, not on delivery. There is no delivery receipt on a P2P
// text — the OS hands off and tells us nothing. So the log says "opened", which
// is the honest claim. Recording "sent" would be inventing a fact.

export async function logContact(job, { kind, to, body, actor, label }) {
  const verb = kind === 'call' ? 'Called' : 'Texted';
  const detail = kind === 'call'
    ? ''
    : ` — ${label || 'message'}: "${String(body || '').slice(0, 120)}"`;
  const line = `📱 ${verb} ${to}${detail}`;
  return addNote(job, line, actor);
}
