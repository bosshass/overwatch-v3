// ============================================================================
// calendar.js — READ-ONLY view of Google Calendar.
//
// v3's baseline deleted v9's calendarApi.js and calendarSync.js and nothing
// replaced them, so the scheduler had no idea what was already booked. This
// restores the read half only.
//
// WRITES: create / update / move / delete are implemented and used by book()
// and closeJob(). Every event Overwatch creates carries the owJobId marker.
//
// CALENDARS ARE RESOLVED FROM THE techs TABLE, never hardcoded. Passing no
// `calendars` to fetchEvents() reads every active tech's own calendar. The
// PTO calendar is deliberately excluded — it is availability, and an event on
// it must never become a job.
//
// One 401 handling rule: a dead token returns { authExpired: true } rather than
// throwing. The scheduler shows "reconnect" instead of an empty grid, because
// an empty grid looks like "nobody is booked" — which is the one wrong answer
// that would cause a double-booking.
// ============================================================================

import { getAccessToken } from './useAuth';
import { supabase } from './supabaseClient';
import { scannedCalendars, COMPLETED_CALENDAR, PTO_CALENDAR } from '../config/calendars';

// Display names, so an event chip can say where it came from.

// Read these when drawing the scheduler. INTERNAL is included: admin time is
// not billable but it still occupies a human being, and a scheduler that hides
// it will cheerfully book over it.
// Calendars are resolved from the techs table now — pass them in.
export const SCHEDULER_CALENDARS = [];

const API = 'https://www.googleapis.com/calendar/v3/calendars';

function normalize(ev, calendarId, calendarName) {
  // All-day events carry `date`; timed events carry `dateTime`.
  const startRaw = ev.start?.dateTime || ev.start?.date || null;
  const endRaw = ev.end?.dateTime || ev.end?.date || null;
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);

  return {
    id: ev.id,
    calendarId,
    calendarName: calendarName || 'Calendar',
    // The marker. Null means a tech booked this by hand -> orphan queue,
    // never an automatic job.
    owJobId: ev?.extendedProperties?.private?.owJobId || null,
    title: ev.summary || '(no title)',
    where: ev.location || '',
    start: startRaw,
    end: endRaw,
    allDay,
    // Local YYYY-MM-DD, which is what the day grid keys on. Deliberately not
    // toISOString().slice(0,10) — that converts to UTC and shifts an evening
    // Mountain-time event onto the following day.
    day: startRaw ? localDay(new Date(startRaw)) : null,
    // Shana's tentative convention, preserved verbatim elsewhere. Read-only here.
    isHold: /^holding\b/i.test(ev.summary || ''),
  };
}

export function localDay(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function listOne(calendarId, timeMin, timeMax, token, calName) {
  const qs = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',      // expand recurring series into instances
    orderBy: 'startTime',
    maxResults: '250',
  });
  const url = `${API}/${encodeURIComponent(calendarId)}/events?${qs}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) return { authExpired: true, events: [] };
  if (res.status === 403 || res.status === 404) {
    // Not shared with this account, or the ID is wrong. Name it — a silent
    // skip here is how v9 shipped a wrong Tent calendar ID for weeks.
    return { events: [], error: `${calName || calendarId}: ${res.status}` };
  }
  if (!res.ok) return { events: [], error: `${res.status} ${res.statusText}` };

  const data = await res.json();
  return { events: (data.items || []).map(ev => normalize(ev, calendarId, calName)) };
}

// Fetch across every scheduler calendar at once.
// → { events, authExpired, errors }
export async function fetchEvents({ from, to, calendars = null }) {
  const token = getAccessToken();
  if (!token) return { events: [], authExpired: true, errors: [] };

  // No explicit list -> every active tech's own calendar, from the techs table.
  // An empty list here would render an empty grid, and an empty grid reads as
  // "nobody is booked" — the one wrong answer that causes a double-booking.
  let ids = calendars;
  const nameFor = {};
  if (!ids) {
    const { data } = await supabase
      .from('techs').select('name, calendar_id, is_active').eq('is_active', true);
    for (const t of data || []) if (t.calendar_id) nameFor[t.calendar_id] = t.name;
    ids = scannedCalendars((data || []).map(t => ({ ...t, is_active: true })));
  }
  if (!ids.length) return { events: [], authExpired: false, errors: ['No tech calendars configured'] };

  const results = await Promise.all(
    ids.map(id => listOne(id, from, to, token, nameFor[id]))
  );

  const events = results.flatMap(r => r.events);
  const errors = results.map(r => r.error).filter(Boolean);
  const authExpired = results.some(r => r.authExpired);

  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { events, authExpired, errors };
}

// Group by local day for a day-column grid.
export function byDay(events) {
  const m = new Map();
  for (const e of events) {
    if (!e.day) continue;
    if (!m.has(e.day)) m.set(e.day, []);
    m.get(e.day).push(e);
  }
  return m;
}

// A run of days starting at `start`, as local YYYY-MM-DD plus display bits.
export function dayRange(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push({
      key: localDay(d),
      date: d,
      dow: d.toLocaleDateString(undefined, { weekday: 'short' }),
      dom: d.getDate(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isToday: localDay(d) === localDay(new Date()),
    });
  }
  return out;
}

// Monday of the week containing d — the grid always starts on a Monday so the
// columns do not shift as you page.
export function weekStart(d = new Date()) {
  const x = new Date(d);
  const shift = (x.getDay() + 6) % 7;   // Mon=0 … Sun=6
  x.setDate(x.getDate() - shift);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ============================================================================
// WRITES — added 3.1.0.
//
// This reverses the original v3 rule ("the only write is move-to-Completed").
// The reason that rule existed was risk of scribbling on live DRH calendars;
// with test calendars in place, a booking that does not appear on a calendar is
// worse — it means the board and the calendar disagree, which is the exact
// condition that produced v9's ghost bookings.
//
// Title convention: "<Customer> — <what>". NO bracket tags. v9's [BILL IT] /
// [RETURN] / [IN PROGRESS] tags are still never written; legacy parsers that
// read them stay read-only. Tentative holds keep Shana's "Holding <customer>"
// via holdTitle() in config/calendars.js.
// ============================================================================

// extendedProperties carries owJobId — the marker that separates an Overwatch
// event from a tech's own manual booking.
function eventBody({ title, description, startISO, endISO, location, extendedProperties }) {
  // Only include fields that are explicitly provided. A PATCH with
  // start: { dateTime: undefined } wipes the event time — the caller
  // should only pass what it intends to change.
  const body = {};
  if (title !== undefined)       body.summary     = title;
  if (description !== undefined) body.description = description || '';
  if (location !== undefined)    body.location    = location    || '';
  if (startISO !== undefined)    body.start       = { dateTime: startISO };
  if (endISO !== undefined)      body.end         = { dateTime: endISO };
  // The owJobId marker. Without it a sync cannot tell an Overwatch event from a
  // tech's own manual booking, and drift detection becomes guesswork on titles.
  if (extendedProperties !== undefined) body.extendedProperties = extendedProperties;
  return body;
}

export async function createEvent(calendarId, ev) {
  const token = getAccessToken();
  if (!token) return { ok: false, authExpired: true, reason: 'Not signed in' };

  const res = await fetch(`${API}/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody(ev)),
  });

  if (res.status === 401) return { ok: false, authExpired: true, reason: 'Google session expired' };
  if (!res.ok) return { ok: false, reason: `Calendar ${res.status} ${res.statusText}` };

  const data = await res.json();
  return { ok: true, eventId: data.id, htmlLink: data.htmlLink };
}

export async function updateEvent(calendarId, eventId, ev) {
  const token = getAccessToken();
  if (!token) return { ok: false, authExpired: true, reason: 'Not signed in' };

  const res = await fetch(
    `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody(ev)),
    }
  );

  if (res.status === 401) return { ok: false, authExpired: true, reason: 'Google session expired' };
  if (res.status === 404) return { ok: false, gone: true, reason: 'Event no longer exists' };
  if (!res.ok) return { ok: false, reason: `Calendar ${res.status} ${res.statusText}` };
  return { ok: true, eventId };
}

// Relocate an event to another calendar. Google's move endpoint keeps the SAME
// event id and carries description, attachments, attendees and history across
// intact — which is the whole point. Delete+create loses all of it, and a
// tentative hold from Shana can carry access codes, gate instructions and
// customer context that must survive promotion to a real booking.
//
// PATCH cannot do this: an event's calendar is not a writable field.
export async function moveEvent(calendarId, eventId, destinationCalendarId) {
  const token = getAccessToken();
  if (!token) return { ok: false, authExpired: true, reason: 'Not signed in' };
  if (calendarId === destinationCalendarId) return { ok: true, eventId };

  const res = await fetch(
    `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move`
      + `?destination=${encodeURIComponent(destinationCalendarId)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 401) return { ok: false, authExpired: true, reason: 'Google session expired' };
  if (res.status === 404) return { ok: false, gone: true, reason: 'Event no longer exists' };
  if (!res.ok) return { ok: false, reason: `Calendar ${res.status} ${res.statusText}` };

  const data = await res.json();
  return { ok: true, eventId: data.id };
}

// Deleting an already-deleted event is success, not failure — 404 and 410 both
// mean "it is not there", which is the state we wanted.
export async function deleteEvent(calendarId, eventId) {
  const token = getAccessToken();
  if (!token) return { ok: false, authExpired: true, reason: 'Not signed in' };

  const res = await fetch(
    `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 401) return { ok: false, authExpired: true, reason: 'Google session expired' };
  if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
  return { ok: false, reason: `Calendar ${res.status} ${res.statusText}` };
}


// ── Access preflight ─────────────────────────────────────────────────────────
// The signed-in account must be able to READ every active tech's calendar to
// build the board, and WRITE to it to book. Those are different grants in
// Google: "See all event details" is read; booking needs "Make changes to
// events". A tech signed in on their own account will usually have read on the
// team calendars and write on none of them.
//
// Without this check the first symptom is a booking that silently does not
// appear on anyone's calendar — the exact disagreement between board and
// calendar that produced v9's ghost bookings. Run it from a settings screen,
// or on first load for office roles.
//
// → [{ calendarId, label, role, read, write, reason }]
export async function checkCalendarAccess() {
  const token = getAccessToken();
  if (!token) return { authExpired: true, results: [] };

  const { data: techs } = await supabase
    .from('techs').select('name, calendar_id, kind, is_active').eq('is_active', true);

  const targets = [
    ...(techs || [])
      .filter(t => t.calendar_id)
      .map(t => ({ calendarId: t.calendar_id, label: t.name, role: t.kind === 'field' ? 'tech' : 'function', needsWrite: true })),
    { calendarId: COMPLETED_CALENDAR, label: 'Completed', role: 'archive', needsWrite: true },
    { calendarId: PTO_CALENDAR,       label: 'PTO',       role: 'availability', needsWrite: false },
  ].filter(t => t.calendarId);

  const results = await Promise.all(targets.map(async t => {
    // accessRole comes back on the calendarList entry: reader | writer | owner.
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(t.calendarId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 401) return { ...t, read: false, write: false, reason: 'signed out' };
    if (!res.ok) {
      return { ...t, read: false, write: false,
               reason: res.status === 404 ? 'not shared with this account' : `HTTP ${res.status}` };
    }
    const cal = await res.json();
    const role = cal.accessRole;                       // reader | writer | owner | freeBusyReader
    const read  = ['reader', 'writer', 'owner'].includes(role);
    const write = ['writer', 'owner'].includes(role);
    return {
      ...t, read, write, accessRole: role,
      reason: t.needsWrite && !write
        ? `read-only — cannot book ${t.label}`
        : (!read ? 'no access' : null),
    };
  }));

  return {
    authExpired: false,
    results,
    ok: results.every(r => r.read && (!r.needsWrite || r.write)),
    // PTO is read-only BY DESIGN: availability, never a source of jobs.
    ptoWritable: results.find(r => r.role === 'availability')?.write === true,
  };
}
