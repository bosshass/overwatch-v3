import { useState, useEffect, useCallback } from 'react';
import { CALENDARS, getWorkViewCalendars } from '../config/calendars.js';
import JobFinishSheet from '../components/JobFinishSheet.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const TECH_CAL_MAP = {
  'Austin':  CALENDARS.AUSTIN,  'austin':  CALENDARS.AUSTIN,
  'drhservicetech1@gmail.com':      CALENDARS.AUSTIN,
  'austin@drhsecurityservices.com': CALENDARS.AUSTIN,
  'JR':  CALENDARS.JR, 'jr':  CALENDARS.JR,
  'jr@drhsecurityservices.com':     CALENDARS.JR,
  'Brian': CALENDARS.TECH3, 'brian': CALENDARS.TECH3,
  'brian@drhsecurityservices.com':  CALENDARS.TECH3,
  'Shana': CALENDARS.SHANA, 'shana': CALENDARS.SHANA,
  'shanaparks@drhsecurityservices.com': CALENDARS.SHANA,
  'Subs': CALENDARS.SUBS, 'subs': CALENDARS.SUBS,
  'subs@drhsecurityservices.com':      CALENDARS.SUBS,
};

const HARD_SKIP = ['[BILLED]', '[IGNORED]', '[IGNORE]'];

function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

function getTab(title) {
  const t = (title || '').toUpperCase();
  // Bill-it bucket — accept new canonical [BILL IT] plus legacy [COMPLETED] / [TO BILL]
  if (t.includes('[BILL IT]') || t.includes('[COMPLETED]') || t.includes('[TO BILL]')) return 'billit';
  if (t.includes('[RETURN') || t.includes('NEEDS RETURN'))  return 'return';
  if (t.includes('[ESTIMATE') || t.includes('ESTIMATE NEEDED') || t.includes('[SALES]')) return 'estimate';
  return 'new';
}

function dayStart(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function dayEnd(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }


function isProjectLike(title = '', description = '') {
  const t = `${title} ${description}`.toLowerCase();
  return [
    'install', 'project', 'phase', 'day 1', 'day 2', 'rough-in',
    'trim out', 'trim-out', 'wire pull', 'camera install', 'access control install'
  ].some(k => t.includes(k));
}

// Labels match the shared lane vocabulary (utils/lanes.js). "Bill It" was this
// screen's own phrase for what the rest of the app calls To Bill — same pile,
// two names. Keys, tab logic and data flow are untouched on purpose: this
// screen is half-adopted in the field and the fastest way to lose the other
// half is to move things around under their thumbs.
const TABS = [
  { key: 'new',    label: 'Today',    emoji: '📋', color: '#1a8a8a' },
  { key: 'billit', label: 'To Bill',  emoji: '💵', color: '#1B2A4A' },
];

export default function TechWorkToday({ accessToken, userEmail, userName, onBack, showAllTechs = false }) {
  const today = dayStart(new Date());
  const [offset, setOffset]     = useState(0);
  const [allEvents, setAll]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setTab]     = useState('new');
  const [selected, setSelected] = useState(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);


  // Single tech calendar OR all techs for operators
  const techCalId = TECH_CAL_MAP[userEmail?.toLowerCase()] || TECH_CAL_MAP[userName] || CALENDARS.AUSTIN;

  const viewDate = new Date(today);
  viewDate.setDate(today.getDate() + offset);

  const dayLabel = () => {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    if (offset === -1) return 'Yesterday';
    return viewDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const d = new Date(today); d.setDate(today.getDate() + offset);
    const params = new URLSearchParams({
      timeMin: dayStart(d).toISOString(), timeMax: dayEnd(d).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '100'
    });

    // Per-user list: which tech calendars show up in this user's Work view.
    // Operators see Austin + JR + Brian. Austin sees his own + Brian's.
    // JR sees JR. Brian sees Brian. (Defined in config/calendars.js)
    const workCals = getWorkViewCalendars(userEmail);
    // Fallback: if no rule matched (unknown user), show their own tech calendar
    const techCalendars = workCals.length > 0
      ? workCals
      : [{ id: techCalId, name: null }];

    const calIds = techCalendars.map(c => c.id);
    const calNameById = Object.fromEntries(techCalendars.map(c => [c.id, c.name]));
    const fetches = calIds.map(calId =>
      fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.json())
        .then(data => (data.items || []).map(ev => ({
          ...ev,
          _calId: calId,
          _techName: calNameById[calId] || null
        })))
        .catch(() => [])
    );

    const results = await Promise.all(fetches);
    const merged  = results.flat();

    const items = merged.filter(ev => {
      if (ev.status === 'cancelled') return false;
      // Skip events with no title or empty title
      if (!ev.summary || !ev.summary.trim()) return false;
      const t = (ev.summary || '').toUpperCase();
      return !HARD_SKIP.some(s => t.includes(s.toUpperCase()));
    }).map(ev => ({
      id: ev.id,
      calendarId: ev._calId,
      techName: ev._techName,
      title: ev.summary || '(no title)',
      start: ev.start?.dateTime ? new Date(ev.start.dateTime) : new Date((ev.start?.date || '') + 'T08:00:00'),
      end:   ev.end?.dateTime   ? new Date(ev.end.dateTime)   : new Date((ev.end?.date   || '') + 'T09:00:00'),
      location: ev.location || '',
      description: ev.description || '',
      isAllDay: !ev.start?.dateTime,
      tab: getTab(ev.summary || ''),
    })).sort((a, b) => a.start - b.start);

    setAll(items);
    setLoading(false);
  }, [accessToken, userEmail, techCalId, offset, showAllTechs]);

  useEffect(() => { load(); }, [load]);

  // The first tab ("Today") shows the tech's WHOLE day — every scheduled job
  // that isn't already billed/completed, including ones tagged [RETURN] or
  // [ESTIMATE]. This is the safety fix: a scheduled appointment can never be
  // hidden from the tech just because it carries a return/estimate tag.
  // Return / Estimate / Bill It remain filtered views of the same day.
  const events = activeTab === 'new'
    ? allEvents.filter(e => e.tab !== 'billit')
    : allEvents.filter(e => e.tab === activeTab);

  const openDetail = (ev) => {
    setSelected(ev);
    setDetailsExpanded(false);
  };
  const closeSheet = () => {
    setSelected(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Called by JobFinishSheet after a successful disposition.
  // Optimistically updates the local list so the just-finished item flips
  // tabs immediately, then closes the sheet.
  const onFinished = (disposition, newTitle) => {
    const newTab =
      disposition === 'bill_it'     ? 'billit' :
      disposition === 'return'      ? 'return' :
      disposition === 'estimate'    ? 'estimate' :
      'new'; // in_progress stays in 'new' tab
    setAll(prev => prev.map(e => e.id === selected?.id ? { ...e, title: newTitle, tab: newTab } : e));
    closeSheet();
  };

  // Customer link is rendered inside the rich detail header AND fed to JobFinishSheet
  // (via prefillCustomer) so the tech doesn't have to link twice.

  // ── DISPOSITION HANDLERS — now live in JobFinishSheet (../components/JobFinishSheet.jsx)
  // Removed in the consolidation cleanup. JobFinishSheet writes time_entries +
  // return_cards and patches the calendar title with canonical [BILL IT] / [RETURN] /
  // [IN PROGRESS] / [ESTIMATE] tags.

  const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const extractPhone = (desc) => {
    const m = (desc || '').match(/(?:Phone|Ph|Tel|Call)?:?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
    return m ? m[1] : null;
  };

  const tabCounts   = {};
  TABS.forEach(t => { tabCounts[t.key] = allEvents.filter(e => e.tab === t.key).length; });
  // "Today" shows everything not yet billed, so its badge counts that.
  tabCounts.new = allEvents.filter(e => e.tab !== 'billit').length;
  const activeTabObj = TABS.find(t => t.key === activeTab);
  
  const headerTitle = showAllTechs ? "Tech Jobs (Austin + JR + Brian + Subs)" : `${userName}'s Jobs`;

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', color: '#1B2A4A', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Header */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}>
          <button onClick={onBack}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            ← Home
          </button>
          <img src="/overwatch-logo.png" alt="Overwatch" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1B2A4A' }}>{headerTitle}</div>
          <button onClick={load}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, color: '#6b7280', padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
            ↻
          </button>
        </div>

        {/* Day nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
          <button onClick={() => setOffset(o => o - 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 22, cursor: 'pointer', color: '#374151', minWidth: 52 }}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: offset === 0 ? '#1a8a8a' : '#1B2A4A' }}>{dayLabel()}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              {viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {!loading && ' · ' + allEvents.length + ' total'}
            </div>
          </div>
          <button onClick={() => setOffset(o => o + 1)}
            style={{ background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 22, cursor: 'pointer', color: '#374151', minWidth: 52 }}>›</button>
        </div>

        {/* Four Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderTop: '1px solid #e5e7eb' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTab(tab.key)}
              style={{
                background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? '3px solid ' + tab.color : '3px solid transparent',
                padding: '12px 4px 10px', cursor: 'pointer', textAlign: 'center',
                color: activeTab === tab.key ? tab.color : '#9ca3af',
                fontWeight: activeTab === tab.key ? 700 : 500, fontSize: 14,
              }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{tab.emoji}</div>
              <div>{tab.label}</div>
              {tabCounts[tab.key] > 0 && (
                <div style={{
                  display: 'inline-block', marginTop: 3,
                  background: activeTab === tab.key ? tab.color : '#e5e7eb',
                  color: activeTab === tab.key ? '#fff' : '#6b7280',
                  borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px',
                }}>{tabCounts[tab.key]}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>Loading...</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{activeTab === 'new' && offset === 0 ? '🎉' : '📭'}</div>
            <div style={{ color: '#6b7280', fontSize: 16, fontWeight: 600 }}>
              {activeTab === 'new' && offset === 0 ? 'Nothing scheduled today' : activeTab === 'new' ? 'Nothing scheduled' : 'Nothing in ' + activeTabObj?.label}
            </div>
          </div>
        )}

        {!loading && events.map((ev, i) => {
          const name  = cleanTitle(ev.title);
          const phone = extractPhone(ev.description);
          const now   = new Date();
          const isNow = ev.start <= now && ev.end >= now;
          const techColor = ev.techName === 'Austin' ? '#3b82f6' : ev.techName === 'JR' ? '#22c55e' : ev.techName === 'Brian' ? '#FB923C' : ev.techName === 'Subs' ? '#EC4899' : null;

          return (
            <div key={ev.id} onClick={() => openDetail(ev)}
              style={{
                background: '#ffffff',
                borderRadius: i === 0 && events.length === 1 ? 12 : i === 0 ? '12px 12px 0 0' : i === events.length - 1 ? '0 0 12px 12px' : 0,
                padding: '18px 16px', cursor: 'pointer',
                borderBottom: i < events.length - 1 ? '1px solid #f3f4f6' : 'none',
                borderLeft: '4px solid ' + (techColor || (isNow ? '#1a8a8a' : activeTabObj?.color || '#e5e7eb')),
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isNow && <div style={{ color: '#1a8a8a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>In Progress</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {ev.techName && (
                    <span style={{ 
                      background: techColor + '20', 
                      color: techColor, 
                      fontSize: 11, 
                      fontWeight: 700, 
                      padding: '3px 8px', 
                      borderRadius: 4 
                    }}>
                      {ev.techName}
                    </span>
                  )}
                  {ev.tab === 'return' && (
                    <span style={{ background: '#fef3c7', color: '#b45309', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>🔄 Return Visit</span>
                  )}
                  {ev.tab === 'estimate' && (
                    <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>→ Estimates</span>
                  )}
                  <span style={{ fontWeight: 700, fontSize: 17, color: '#1B2A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name || '(no name)'}
                  </span>
                </div>
                <div style={{ fontSize: 14, color: '#6b7280' }}>
                  {ev.isAllDay ? 'All day' : fmtTime(ev.start) + ' – ' + fmtTime(ev.end)}
                  {ev.location && ' · ' + ev.location.split(',')[0]}
                </div>
                {phone && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>📞 {phone}</div>}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: 26, marginLeft: 10 }}>›</div>
            </div>
          );
        })}
      </div>

      {/* Bottom Sheet */}
      {selected && (
        <div onClick={closeSheet}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '16px 16px calc(24px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 480, maxHeight: '92vh', maxHeight: '92dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

            <div style={{ width: 40, height: 5, background: '#e5e7eb', borderRadius: 3, margin: '0 auto 14px' }} />

            <div style={{ fontWeight: 800, fontSize: 19, color: '#1B2A4A', marginBottom: 3 }}>
              {cleanTitle(selected.title)}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
              {selected.isAllDay ? 'All day' : fmtTime(selected.start) + ' – ' + fmtTime(selected.end)}
            </div>

            {(selected.location || extractPhone(selected.description)) && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {selected.location && (
                  <a href={'https://maps.google.com/?q=' + encodeURIComponent(selected.location)}
                    target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, color: '#2563eb', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                    🗺️ Navigate
                  </a>
                )}
                {extractPhone(selected.description) && (
                  <a href={'tel:' + (extractPhone(selected.description) || '').replace(/\D/g, '')}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, color: '#16a34a', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                    📞 Call
                  </a>
                )}
              </div>
            )}

            {/* Finish form — customer link, time entry, notes, materials, disposition buttons.
                Lives in src/components/JobFinishSheet.jsx and is the SINGLE canonical
                "tech finishes a job" UI used everywhere in the app. */}
            <JobFinishSheet
              inline
              event={{
                id: selected.id,
                title: selected.title,
                calendarId: selected.calendarId,
                start: selected.start,
                end: selected.end,
                description: selected.description,
                location: selected.location,
                techName: selected.techName,
              }}
              accessToken={accessToken}
              userEmail={userEmail}
              userName={userName}
              mode="full"
              onFinished={onFinished}
              onCancel={closeSheet}
            />
          </div>
        </div>
      )}
    </div>
  );
}
