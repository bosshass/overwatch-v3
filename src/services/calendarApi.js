// Overwatch V3 - Google Calendar API (read-only)
// Fetches events from DRH calendars using OAuth token

const API = 'https://www.googleapis.com/calendar/v3';

/**
 * Fetch events from a single calendar
 * opts: { q?: string, maxResults?: number } — optional text search + result cap
 */
export async function fetchCalendarEvents(accessToken, calendarId, timeMin, timeMax, opts = {}) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults ?? 250),
  });
  if (opts.q) params.set('q', opts.q);

  const res = await fetch(
    `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    if (res.status === 401) throw new Error('TOKEN_EXPIRED');
    console.warn(`Calendar fetch failed for ${calendarId}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.items || [];
}

/**
 * Fetch events from multiple calendars and tag each with source
 */
export async function fetchAllCalendars(accessToken, calendars, timeMin, timeMax) {
  const results = await Promise.allSettled(
    calendars.map(async (cal) => {
      const events = await fetchCalendarEvents(accessToken, cal.id, timeMin, timeMax);
      return events.map(e => ({
        ...e,
        _calendarName: cal.name,
        _calendarType: cal.type,
        _calendarId: cal.id,
      }));
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date));
}

/**
 * Check availability for a tech's calendar in a given time range
 */
export async function checkAvailability(accessToken, calendarId, timeMin, timeMax) {
  const events = await fetchCalendarEvents(accessToken, calendarId, timeMin, timeMax);
  return events.map(e => ({
    start: new Date(e.start?.dateTime || e.start?.date),
    end: new Date(e.end?.dateTime || e.end?.date),
    summary: e.summary || 'Busy',
  }));
}
