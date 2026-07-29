// ============================================
// JUC-E — Command Center
// ============================================
// Displays events from: Tentatively Scheduled | Sales & Accounting | Admin Notes (Sara)
// Per-event actions: Schedule to Tech | Add to Task List
// All flows live in one modal — DispatchModal

import { useState, useEffect, useCallback } from 'react';
import { customersApi } from '../services/supabase.js';
import { createEventOnCalendar } from '../services/calendarSync.js';
import { CALENDARS } from '../config/calendars.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Source calendar for scheduling dispatch
const SOURCE_CALS = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Tentatively Scheduled', color: '#ef4444' },
];

// Tech calendars available for scheduling
const TECH_CALS = [
  { name: 'Austin', id: CALENDARS.AUSTIN, color: '#F4511E' },
  { name: 'JR',     id: CALENDARS.JR,     color: '#0B8043' },
  { name: 'Brian',  id: CALENDARS.TECH3,  color: '#3F51B5' },
];

const TASK_TYPES = [
  { key: 'internal',  label: '📝 Internal To-Do',           color: '#cbd5e1' },
  { key: 'parts',     label: '📦 Warehouse / Parts Needed',  color: '#f59e0b' },
  { key: 'followup',  label: '📞 Follow Up — Sales/Service', color: '#3b82f6' },
  { key: 'mgmt',      label: '⚠️ Management Needed',         color: '#ef4444' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFreeBusy(accessToken, calendarId, date) {
  const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
  const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999);
  const res = await fetch(`${GCAL}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), items: [{ id: calendarId }] })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.calendars?.[calendarId]?.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
}

function suggestTimes(busyBlocks, date) {
  const slots = [];
  const workStart = new Date(date); workStart.setHours(8,0,0,0);
  const workEnd   = new Date(date); workEnd.setHours(17,0,0,0);
  let cursor = new Date(workStart);
  const sorted = [...busyBlocks].sort((a,b) => a.start - b.start);
  for (const busy of sorted) {
    if (cursor < busy.start) {
      const slotEnd = new Date(Math.min(busy.start, workEnd));
      const mins = (slotEnd - cursor) / 60000;
      if (mins >= 60) slots.push({ start: new Date(cursor), end: slotEnd });
    }
    cursor = new Date(Math.max(cursor, busy.end));
    if (cursor >= workEnd) break;
  }
  if (cursor < workEnd) {
    const mins = (workEnd - cursor) / 60000;
    if (mins >= 60) slots.push({ start: new Date(cursor), end: new Date(workEnd) });
  }
  return slots.slice(0, 4);
}

function fmt(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function toLocalISODate(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

// ── Task storage (localStorage, keyed by app) ────────────────────────────────
const TASK_KEY = 'juce_tasks';
function loadTasks() { try { return JSON.parse(localStorage.getItem(TASK_KEY) || '[]'); } catch { return []; } }
function saveTask(task) {
  const tasks = loadTasks();
  tasks.unshift({ ...task, id: Date.now(), created_at: new Date().toISOString() });
  localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
}

// ── DispatchModal — all actions in one ───────────────────────────────────────
function DispatchModal({ event, accessToken, onClose, onRefresh }) {
  const [mode, setMode]               = useState(null); // 'task' | 'schedule'
  const [taskType, setTaskType]       = useState(null);
  const [taskNote, setTaskNote]       = useState('');
  const [taskSaved, setTaskSaved]     = useState(false);

  // Schedule state
  const [schedDate, setSchedDate]     = useState(toLocalISODate(new Date()));
  const [selectedTech, setSelectedTech] = useState(null);
  const [schedStart, setSchedStart]   = useState('');
  const [schedEnd, setSchedEnd]       = useState('');
  const [schedNotes, setSchedNotes]   = useState('');
  const [busyBlocks, setBusyBlocks]   = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [schedDone, setSchedDone]     = useState(false);

  // Load availability when tech or date changes
  useEffect(() => {
    if (!selectedTech || !schedDate || mode !== 'schedule') return;
    setAvailLoading(true);
    fetchFreeBusy(accessToken, selectedTech.id, new Date(schedDate + 'T12:00:00'))
      .then(busy => {
        setBusyBlocks(busy);
        setSuggestions(suggestTimes(busy, new Date(schedDate + 'T12:00:00')));
      })
      .catch(() => { setBusyBlocks([]); setSuggestions([]); })
      .finally(() => setAvailLoading(false));
  }, [selectedTech, schedDate, mode, accessToken]);

  const handleSaveTask = () => {
    if (!taskType) return;
    saveTask({
      type: taskType,
      title: event.summary,
      calendarName: event.calendarName,
      date: event.start?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      location: event.location || '',
      description: event.description || '',
      note: taskNote,
      sourceEventId: event.id,
      sourceCalendarId: event.calendarId,
    });
    setTaskSaved(true);
  };

  const handleSchedule = async () => {
    if (!selectedTech || !schedStart || !schedEnd) { setError('Choose a tech, start, and end time.'); return; }
    setSaving(true); setError('');
    try {
      const startDT = new Date(`${schedDate}T${schedStart}`);
      const endDT   = new Date(`${schedDate}T${schedEnd}`);
      if (endDT <= startDT) { setError('End time must be after start time.'); setSaving(false); return; }

      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });

      // Source event link + notes → goes in new event description as link, not inline
      const sourceLink = event.htmlLink ? `🔗 Source event: ${event.htmlLink}` : '';
      const carryNotes = event.description ? `\n--- From source event ---\n${event.description}` : '';
      const newDescription = [schedNotes || '', sourceLink, carryNotes].filter(Boolean).join('\n');

      // Create the new scheduled event
      const newEvent = await createEventOnCalendar(accessToken, selectedTech.id, {
        title: event.summary,
        description: newDescription,
        location: event.location || '',
        startTime: startDT,
        endTime: endDT,
      });

      // Archive source event to Completed — patch description with timestamp + link to new event
      try {
        const newEventLink = newEvent?.htmlLink || '';
        const getRes = await fetch(
          `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const current = await getRes.json();
        const existing = current.description || '';
        const archiveNote = `\n\n📅 SCHEDULED — ${ts}\nAssigned to: ${selectedTech.name}${newEventLink ? `\n🔗 Scheduled event: ${newEventLink}` : ''}`;
        await fetch(
          `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: existing + archiveNote }),
          }
        );
        // Move source event to Completed calendar
        await fetch(
          `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
          { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (archiveErr) {
        // Archive failure is non-fatal — new event still created
        console.warn('Archive failed:', archiveErr.message);
      }

      setSchedDone(true);
      onRefresh();
    } catch (e) {
      setError('Schedule failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const applySlot = (slot) => {
    setSchedStart(slot.start.toTimeString().slice(0,5));
    setSchedEnd(slot.end.toTimeString().slice(0,5));
  };

  const inputStyle = { background: '#0f1729', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '9px 11px', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Event header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1, paddingRight: 12 }}>
            <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{event.summary}</div>
            <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>
              {event.start?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {!event.isAllDay && event.start && ` · ${event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
            </div>
            {event.location && <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>📍 {event.location}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ height: 1, background: '#334155', margin: '12px 0' }} />

        {/* Mode selector */}
        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => setMode('schedule')} style={{ background: '#0f2820', border: '2px solid #16a34a', borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ color: '#22c55e', fontSize: 15, fontWeight: 700 }}>📅 Schedule This Job</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>Assign to a tech, pick a time, send to their calendar</div>
            </button>
            <button onClick={() => setMode('task')} style={{ background: '#0f1729', border: '2px solid #334155', borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>➕ Add to Task List</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>Log this as an internal to-do, parts request, follow-up, or escalation</div>
            </button>
          </div>
        )}

        {/* ── TASK MODE ── */}
        {mode === 'task' && !taskSaved && (
          <div>
            <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>What kind of task?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {TASK_TYPES.map(t => (
                <button key={t.key} onClick={() => setTaskType(t.key)} style={{
                  background: taskType === t.key ? '#1e293b' : '#0f1729',
                  border: `2px solid ${taskType === t.key ? t.color : '#334155'}`,
                  borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                }}>
                  <div style={{ color: taskType === t.key ? t.color : '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{t.label}</div>
                </button>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Note (optional)</label>
              <textarea value={taskNote} onChange={e => setTaskNote(e.target.value)} rows={3}
                placeholder="Any extra context..."
                style={{ ...inputStyle, resize: 'none' }} />
            </div>
            <button onClick={handleSaveTask} disabled={!taskType} style={{
              width: '100%', background: taskType ? '#00c8e8' : '#334155', color: taskType ? '#000' : '#64748b',
              border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 700, cursor: taskType ? 'pointer' : 'not-allowed',
            }}>Save Task</button>
          </div>
        )}

        {mode === 'task' && taskSaved && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 700 }}>Task saved</div>
            <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6 }}>You can view all tasks in the Office tab.</div>
            <button onClick={onClose} style={{ marginTop: 20, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '10px 24px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          </div>
        )}

        {/* ── SCHEDULE MODE ── */}
        {mode === 'schedule' && !schedDone && (
          <div>
            {/* Tech picker */}
            <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Assign to</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {TECH_CALS.map(t => (
                <button key={t.name} onClick={() => setSelectedTech(t)} style={{
                  flex: 1, background: selectedTech?.name === t.name ? '#0f2820' : '#0f1729',
                  border: `2px solid ${selectedTech?.name === t.name ? t.color : '#334155'}`,
                  borderRadius: 10, padding: '12px', cursor: 'pointer',
                }}>
                  <div style={{ color: selectedTech?.name === t.name ? t.color : '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                </button>
              ))}
            </div>

            {/* Date */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Date</label>
              <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} style={inputStyle} />
            </div>

            {/* Availability suggestions */}
            {selectedTech && (
              <div style={{ marginBottom: 14, background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#00c8e8', fontSize: 13, fontWeight: 700 }}>💡 Suggested Times</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>— {selectedTech.name} · {new Date(schedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
                {availLoading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Checking calendar...</div>}
                {!availLoading && suggestions.length === 0 && <div style={{ color: '#ef4444', fontSize: 12 }}>No open windows found this day.</div>}
                {!availLoading && suggestions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {suggestions.map((s, i) => (
                      <button key={i} onClick={() => applySlot(s)} style={{
                        background: '#1e293b', border: '1px solid #00c8e840', borderRadius: 8,
                        color: '#00c8e8', fontSize: 12, padding: '7px 12px', cursor: 'pointer', fontWeight: 600,
                      }}>{fmt(s.start)} – {fmt(s.end)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Start / End time */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Start</label>
                <input type="time" value={schedStart} onChange={e => setSchedStart(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>End</label>
                <input type="time" value={schedEnd} onChange={e => setSchedEnd(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Notes for this event (optional)</label>
              <textarea value={schedNotes} onChange={e => setSchedNotes(e.target.value)} rows={3}
                placeholder="Any instructions, entry codes, context..."
                style={{ ...inputStyle, resize: 'none' }} />
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>Source event notes will be attached as a link — not copied inline.</div>
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

            <button onClick={handleSchedule} disabled={saving || !selectedTech || !schedStart || !schedEnd} style={{
              width: '100%',
              background: saving || !selectedTech || !schedStart || !schedEnd ? '#334155' : '#22c55e',
              color: saving || !selectedTech || !schedStart || !schedEnd ? '#64748b' : '#000',
              border: 'none', borderRadius: 12, padding: '16px', fontSize: 15, fontWeight: 700,
              cursor: saving || !selectedTech || !schedStart || !schedEnd ? 'not-allowed' : 'pointer',
            }}>
              {saving ? 'Scheduling...' : `Schedule — ${selectedTech?.name || 'Pick a tech'}`}
            </button>
          </div>
        )}

        {mode === 'schedule' && schedDone && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
            <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 700 }}>Scheduled</div>
            <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6 }}>Event added to {selectedTech?.name}'s calendar.</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>Source event moved to Completed with timestamp + link.</div>
            <button onClick={onClose} style={{ marginTop: 20, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#94a3b8', padding: '10px 24px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ event, onAction }) {
  const borderColor = SOURCE_CALS.find(c => c.name === event.calendarName)?.color || '#334155';
  const isPast = event.start && event.start < new Date() && event.start.toDateString() !== new Date().toDateString();

  return (
    <div style={{ background: '#1e293b', borderRadius: 12, borderLeft: `4px solid ${borderColor}`, padding: '14px', marginBottom: 10, position: 'relative' }}>
      {isPast && <div style={{ color: '#ef4444', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>⚠️ Past Due</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{event.summary}</div>
          <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>
            {event.start?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {!event.isAllDay && event.start && ` · ${event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
          </div>
          {event.location && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>📍 {event.location}</div>}
          {event.description && (
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, lineHeight: 1.4, maxHeight: 40, overflow: 'hidden' }}>
              {event.description.replace(/📱 Open in JUC-E:.*/g, '').trim().slice(0, 120)}
            </div>
          )}
        </div>
        <button
          onClick={() => onAction(event)}
          style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: 8, color: '#00c8e8', fontSize: 12, fontWeight: 700, padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Actions ›
        </button>
      </div>
      <div style={{ marginTop: 8, display: 'inline-block', background: '#0f1729', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: borderColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {event.calendarName}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function CommandCenter({ accessToken, userEmail }) {
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeEvent, setActiveEvent] = useState(null);
  const [activeSection, setActiveSection] = useState('all');
  const [capacityView, setCapacityView] = useState(false);
  const [capacityData, setCapacityData] = useState({ loading: true, days: [] });

  const fetchEvents = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days back
    const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days forward
    const all = [];

    await Promise.all(SOURCE_CALS.map(async (cal) => {
      try {
        const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
        const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(e => {
          if (e.status === 'cancelled') return;
          const start = e.start?.dateTime ? new Date(e.start.dateTime) : e.start?.date ? new Date(e.start.date + 'T00:00:00') : null;
          const end   = e.end?.dateTime   ? new Date(e.end.dateTime)   : e.end?.date   ? new Date(e.end.date   + 'T23:59:59') : null;
          all.push({
            id: e.id, calendarId: cal.id, calendarName: cal.name,
            summary: e.summary || '(no title)', location: e.location || '',
            description: e.description || '', htmlLink: e.htmlLink || '',
            start, end, isAllDay: !e.start?.dateTime,
          });
        });
      } catch {}
    }));

    all.sort((a, b) => (a.start || 0) - (b.start || 0));
    setEvents(all);
    setLoading(false);
  }, [accessToken]);

  // ── Install Capacity Check ─────────────────────────────────────────────────
  const fetchCapacity = useCallback(async () => {
    if (!accessToken) return;
    setCapacityData(d => ({ ...d, loading: true }));
    
    const now = new Date();
    const days = [];
    
    // Check next 14 business days
    for (let i = 0; i < 21; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      
      // Skip weekends
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      if (days.length >= 14) break;
      
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayData = {
        date,
        dateStr: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        techs: []
      };
      
      // Check each tech's calendar
      for (const tech of TECH_CALS) {
        try {
          const params = new URLSearchParams({
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: 'true'
          });
          const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(tech.id)}/events?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (!res.ok) continue;
          const data = await res.json();
          
          const events = (data.items || []).filter(e => e.status !== 'cancelled');
          let totalHours = 0;
          let hasInstall = false;
          
          events.forEach(e => {
            if (e.start?.dateTime && e.end?.dateTime) {
              const hrs = (new Date(e.end.dateTime) - new Date(e.start.dateTime)) / 3600000;
              totalHours += hrs;
            }
            // Check for install indicators in title
            const title = (e.summary || '').toLowerCase();
            if (title.includes('install') || title.includes('[install]') || title.includes('installation')) {
              hasInstall = true;
            }
          });
          
          dayData.techs.push({
            name: tech.name,
            color: tech.color,
            hours: totalHours,
            eventCount: events.length,
            hasInstall,
            overbooked: totalHours > 8
          });
        } catch (err) {
          console.error('Capacity fetch error:', err);
        }
      }
      
      days.push(dayData);
    }
    
    setCapacityData({ loading: false, days });
  }, [accessToken]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { if (capacityView) fetchCapacity(); }, [capacityView, fetchCapacity]);

  const sections = [
    { key: 'all', label: 'All' },
    ...SOURCE_CALS.map(c => ({ key: c.name, label: c.name })),
  ];

  const filtered = activeSection === 'all' ? events : events.filter(e => e.calendarName === activeSection);

  // ── Capacity View ──────────────────────────────────────────────────────────
  if (capacityView) {
    const overbookedDays = capacityData.days.filter(d => d.techs.some(t => t.overbooked));
    
    return (
      <div style={{ padding: '0', minHeight: '100vh', background: '#0f1729' }}>
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <button onClick={() => setCapacityView(false)} style={{ background: 'none', border: 'none', color: '#00c8e8', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6, display: 'block' }}>
              ← Back to Command Center
            </button>
            <div style={{ color: '#e2e8f0', fontSize: 17, fontWeight: 700 }}>📊 Install Capacity</div>
            <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>Next 14 business days — avoid overbooking</div>
          </div>
          <button onClick={fetchCapacity} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            ↺ Refresh
          </button>
        </div>

        {/* Overbooking alert */}
        {overbookedDays.length > 0 && (
          <div style={{ margin: '0 16px 12px', padding: '12px', background: '#dc262620', border: '1px solid #dc262650', borderRadius: 10 }}>
            <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
              ⚠️ {overbookedDays.length} day{overbookedDays.length > 1 ? 's' : ''} overbooked (8+ hours)
            </div>
          </div>
        )}

        {/* Capacity grid */}
        <div style={{ padding: '0 16px 100px' }}>
          {capacityData.loading ? (
            <div style={{ color: '#cbd5e1', fontSize: 14, textAlign: 'center', marginTop: 40 }}>Loading capacity...</div>
          ) : (
            capacityData.days.map((day, i) => {
              const totalHours = day.techs.reduce((sum, t) => sum + t.hours, 0);
              const isOverbooked = day.techs.some(t => t.overbooked);
              const isToday = i === 0;
              
              return (
                <div key={day.dateStr} style={{
                  background: isOverbooked ? '#dc262615' : '#1e293b',
                  borderRadius: 10, padding: '14px', marginBottom: 8,
                  border: `1px solid ${isOverbooked ? '#dc262640' : isToday ? '#00c8e840' : '#334155'}`,
                  borderLeft: isToday ? '4px solid #00c8e8' : isOverbooked ? '4px solid #dc2626' : '4px solid transparent'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
                      {isToday ? '📌 TODAY' : day.dateStr}
                    </div>
                    <div style={{ color: isOverbooked ? '#dc2626' : '#64748b', fontSize: 12, fontWeight: 600 }}>
                      {totalHours.toFixed(1)}h total
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: 8 }}>
                    {day.techs.map(tech => (
                      <div key={tech.name} style={{
                        flex: 1, background: '#0f1729', borderRadius: 8, padding: '10px',
                        borderLeft: `3px solid ${tech.color}`
                      }}>
                        <div style={{ color: tech.color, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                          {tech.name}
                        </div>
                        <div style={{ 
                          color: tech.overbooked ? '#dc2626' : '#e2e8f0', 
                          fontSize: 18, fontWeight: 700 
                        }}>
                          {tech.hours.toFixed(1)}h
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: 10, marginTop: 2 }}>
                          {tech.eventCount} event{tech.eventCount !== 1 ? 's' : ''}
                          {tech.hasInstall && <span style={{ color: '#f59e0b' }}> • 📦 Install</span>}
                        </div>
                        {/* Capacity bar */}
                        <div style={{ marginTop: 6, height: 4, background: '#334155', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${Math.min(100, (tech.hours / 8) * 100)}%`,
                            background: tech.overbooked ? '#dc2626' : tech.hours > 6 ? '#f59e0b' : '#22c55e',
                            borderRadius: 2
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0', minHeight: '100vh', background: '#0f1729' }}>

      {/* Header */}
      <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#e2e8f0', fontSize: 17, fontWeight: 700 }}>Command Center</div>
          <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>Schedule, task, and dispatch from here</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCapacityView(true)} style={{ 
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8, 
            color: '#00c8e8', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 
          }}>
            📊 Capacity
          </button>
          <button onClick={fetchEvents} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Section filter chips */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 16px', overflowX: 'auto' }}>
        {sections.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            style={{
              background: activeSection === s.key ? '#00c8e820' : '#1e293b',
              border: `1px solid ${activeSection === s.key ? '#00c8e8' : '#334155'}`,
              borderRadius: 20, padding: '6px 14px', color: activeSection === s.key ? '#00c8e8' : '#94a3b8',
              fontSize: 12, fontWeight: activeSection === s.key ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {s.label}
            {s.key !== 'all' && (
              <span style={{ marginLeft: 6, background: '#334155', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>
                {events.filter(e => e.calendarName === s.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div style={{ padding: '0 16px 100px' }}>
        {loading && <div style={{ color: '#cbd5e1', fontSize: 14, textAlign: 'center', marginTop: 40 }}>Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: '#cbd5e1', fontSize: 14, textAlign: 'center', marginTop: 40 }}>No events in this section.</div>
        )}
        {!loading && filtered.map(e => (
          <EventCard key={`${e.calendarId}-${e.id}`} event={e} onAction={setActiveEvent} />
        ))}
      </div>

      {/* Dispatch modal */}
      {activeEvent && (
        <DispatchModal
          event={activeEvent}
          accessToken={accessToken}
          onClose={() => setActiveEvent(null)}
          onRefresh={fetchEvents}
        />
      )}
    </div>
  );
}
