// ============================================================================
// calendar.js — READ-ONLY view of Google Calendar.
//
// v3's baseline deleted v9's calendarApi.js and calendarSync.js and nothing
// replaced them, so the scheduler had no idea what was already booked. This
// restores the read half only.
//
// WRITES ARE NOT IMPLEMENTED HERE ON PURPOSE. Per calendars.js, the only write
// v3 is ever supposed to make is moving an event to COMPLETED, and
// COMPLETED_CALENDAR is still null. Nothing in this file mutates Google.
//
// One 401 handling rule: a dead token returns { authExpired: true } rather than
// throwing. The scheduler shows "reconnect" instead of an empty grid, because
// an empty grid looks like "nobody is booked" — which is the one wrong answer
// that would cause a double-booking.
// ============================================================================

import { getAccessToken } from './useAuth';
import { CALENDARS, SCANNED_CALENDARS } from '../config/calendars';

// Display names, so an event chip can say where it came from.
export const CALENDAR_NAMES = {
  [CALENDARS.TECH_SCHEDULED]: 'Tech',
  [CALENDARS.MULTI_TECH]: 'Multi-tech',
  [CALENDARS.INTERNAL]: 'Internal',
};

// Read these when drawing the scheduler. INTERNAL is included: admin time is
// not billable but it still occupies a human being, and a scheduler that hides
// it will cheerfully book over it.
export const SCHEDULER_CALENDARS = [...SCANNED_CALENDARS, CALENDARS.INTERNAL];

const API = 'https://www.googleapis.com/calendar/v3/calendars';

function normalize(ev, calendarId) {
  // All-day events carry `date`; timed events carry `dateTime`.
  const startRaw = ev.start?.dateTime || ev.start?.date || null;
  const endRaw = ev.end?.dateTime || ev.end?.date || null;
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);

  return {
    id: ev.id,
    calendarId,
    calendarName: CALENDAR_NAMES[calendarId] || 'Calendar',
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

async function listOne(calendarId, timeMin, timeMax, token) {
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
    return { events: [], error: `${CALENDAR_NAMES[calendarId] || calendarId}: ${res.status}` };
  }
  if (!res.ok) return { events: [], error: `${res.status} ${res.statusText}` };

  const data = await res.json();
  return { events: (data.items || []).map(e => normalize(e, calendarId)) };
}

// Fetch across every scheduler calendar at once.
// → { events, authExpired, errors }
export async function fetchEvents({ from, to, calendars = SCHEDULER_CALENDARS }) {
  const token = getAccessToken();
  if (!token) return { events: [], authExpired: true, errors: [] };

  const results = await Promise.all(
    calendars.map(id => listOne(id, from, to, token))
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

function eventBody({ title, description, startISO, endISO, location }) {
  // Only include fields that are explicitly provided. A PATCH with
  // start: { dateTime: undefined } wipes the event time — the caller
  // should only pass what it intends to change.
  const body = {};
  if (title !== undefined)       body.summary     = title;
  if (description !== undefined) body.description = description || '';
  if (location !== undefined)    body.location    = location    || '';
  if (startISO !== undefined)    body.start       = { dateTime: startISO };
  if (endISO !== undefined)      body.end         = { dateTime: endISO };
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
