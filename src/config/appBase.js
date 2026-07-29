// ============================================
// appBase — where THIS app actually lives
// ============================================
// Deep links written into Google Calendar events were hardcoded to
// `https://juc-e-v2.vercel.app` — the OLD JUC-E deployment. Anyone clicking
// one landed in a different app on its generic board, never reaching the
// finish sheet. Which also means they never dispositioned, never created a
// time_entry, and the job never showed up in Event Audit or Billing.
//
// Deriving the base from the browser makes it correct on production, on
// Vercel preview builds, and on localhost — and it can never silently rot
// again when a domain changes.
//
// SCOPE: this only affects links written from NOW ON. Existing calendar
// events keep their old links until they are dealt with separately — see
// the orphan scan in TechCalendar, which is the real path for pulling
// untracked calendar work into Overwatch.

export const APP_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://overwatch.highsidesecurity.com';

// The canonical deep link to a calendar-backed job.
export function jobDeepLink(calendarId, eventId) {
  return `${APP_BASE}/?cal=${encodeURIComponent(calendarId)}&job=${encodeURIComponent(eventId)}`;
}

// Link to a JOB by its Supabase UUID. This is the universal anchor — it works
// for calendar-backed jobs AND for jobs that have no calendar event at all
// ("JR to sign his taxes"), which is most of what gets captured as a note.
// Notes hang off job_id, so a job link is a note link.
export function jobLink(jobId) {
  return `${APP_BASE}/board?job=${encodeURIComponent(jobId)}`;
}

// ── SHORT LINKS ──────────────────────────────────────────────────────
// A raw UUID link is 80+ characters and looks like malware in a text message.
// The first 8 hex chars of a UUID are unique across 4 billion values; DRH has
// a few hundred jobs, so a collision is not a real concern — and the resolver
// still verifies against the full row before opening anything.
export function shortCode(jobId) {
  return String(jobId || '').replace(/-/g, '').slice(0, 8);
}

export function shortJobLink(jobId) {
  return `${APP_BASE}/j/${shortCode(jobId)}`;
}

// The message a tech actually receives. Customer, THE ASK, then the link —
// so they know what they are being asked to do before they tap anything.
export function assignmentMessage(job) {
  const who  = job.customer_name || 'a job';
  const ask  = (job.issue || '').trim();
  const when = job.scheduled_date
    ? ` (scheduled ${new Date(job.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    : '';
  const askLine = ask ? ` — ${ask.length > 90 ? ask.slice(0, 88).trimEnd() + '…' : ask}` : '';
  return `You've been assigned to ${who}${when}${askLine}\n${shortJobLink(job.id)}`;
}
