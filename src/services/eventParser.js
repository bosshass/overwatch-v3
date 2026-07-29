// Overwatch V3 - Event Parser
// Extracts customer name, status, and metadata from calendar event titles/descriptions

/**
 * Parse a calendar event into a normalized job object
 */
export function parseEvent(event, calendarName, calendarType) {
  const raw = event.summary || '';
  const desc = event.description || '';
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;

  // Extract customer name — strip common prefixes/tags
  const customerName = extractCustomerName(raw);

  // Extract status from title tags
  const status = extractStatus(raw, calendarType);

  // Extract address from description or location
  const address = event.location || extractAddress(desc);

  // Age in days
  const created = event.created ? new Date(event.created) : new Date(start);
  const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);

  return {
    id: event.id,
    googleEventId: event.id,
    customerName,
    rawTitle: raw,
    status,
    address,
    description: desc,
    start: start ? new Date(start) : null,
    end: end ? new Date(end) : null,
    calendarName,
    calendarType,
    ageDays,
    isAllDay: !event.start?.dateTime,
    isRecurring: !!event.recurringEventId,
    htmlLink: event.htmlLink,
  };
}

/**
 * Strip common DRH calendar title patterns to get customer name
 */
function extractCustomerName(title) {
  let name = title;

  // Remove common tag patterns
  name = name.replace(/^\[.*?\]\s*[-–—]?\s*/g, '');           // [SERVICE] -
  name = name.replace(/^(SERVICE|QUEUE|INSTALL|ESTIMATE)\s*[-–—:]\s*/gi, '');
  name = name.replace(/\s*[-–—]\s*(QUEUE|SERVICE|SCHEDULED|COMPLETE|NEEDS\s*PARTS|RETURN).*$/gi, '');
  name = name.replace(/^🔴\s*/, '');                           // Urgent emoji
  name = name.replace(/^🟡\s*/, '');                           // Warning emoji
  name = name.replace(/^✅\s*/, '');                           // Complete emoji

  // Remove trailing status markers
  name = name.replace(/\s*\(.*?\)\s*$/, '');

  return name.trim() || title.trim();
}

/**
 * Detect status from title and calendar type
 */
function extractStatus(title, calendarType) {
  const t = title.toLowerCase();

  if (calendarType === 'completed') return 'Completed';
  if (calendarType === 'queue') return 'Queued';

  if (t.includes('complete') || t.includes('✅')) return 'Completed';
  if (t.includes('needs parts') || t.includes('parts needed')) return 'Needs Parts';
  if (t.includes('return') || t.includes('callback')) return 'Return Needed';
  if (t.includes('estimate') || t.includes('bid')) return 'Estimate';
  if (t.includes('install')) return 'Installation';
  if (t.includes('scheduled') || calendarType === 'tech') return 'Scheduled';
  if (calendarType === 'installations') return 'Installation';

  return 'Active';
}

/**
 * Try to pull an address from event description
 */
function extractAddress(desc) {
  if (!desc) return '';
  // Look for common address patterns
  const lines = desc.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines that look like addresses (number + street)
    if (/^\d+\s+\w/.test(trimmed) && trimmed.length < 120) {
      return trimmed;
    }
  }
  return '';
}

/**
 * Group events by date for display
 */
export function groupByDate(events) {
  const groups = {};
  for (const ev of events) {
    const dateKey = ev.start ? ev.start.toISOString().split('T')[0] : 'unknown';
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(ev);
  }
  return groups;
}

/**
 * Group events by calendar for owner view
 */
export function groupByCalendar(events) {
  const groups = {};
  for (const ev of events) {
    const key = ev.calendarName || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  }
  return groups;
}

/**
 * Filter to just today's events
 */
export function filterToday(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return events.filter(ev => {
    if (!ev.start) return false;
    return ev.start >= today && ev.start < tomorrow;
  });
}

/**
 * Filter events for a specific tech calendar
 */
export function filterByCalendar(events, calendarName) {
  if (!calendarName) return events;
  return events.filter(ev => ev.calendarName === calendarName);
}
