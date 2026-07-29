// ============================================
// Overwatch - RescheduleModal
// ============================================
// Moves an already-scheduled job to a new date/time/tech.
// Patches GCal event + updates Supabase assignment + auto-note.
// Same UI pattern as ScheduleModal to keep muscle memory intact.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { assignmentsApi, jobsApi, notesApi, techsApi, JOB_STATUS } from '../services/supabase.js';
import { TECH_COLORS, CALENDARS } from '../config/calendars.js';
import { scheduleToTechCalendar, archiveEvent } from '../services/calendarSync.js';

const TIME_SLOTS = [
  '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM'
];

const ACTIVE_TECHS = ['Austin', 'JR', 'Trevor'];

const TECH_GCAL_ID = {
  'Austin': CALENDARS.DRH_TECH_1,
  'JR':     CALENDARS.JR_APPOINTMENT,
  'Trevor': null,
};

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const parseTime = (timeStr) => {
  const [time, period] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
};

const toTimeSlot = (dateStr) => {
  if (!dateStr) return '9:00 AM';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const getWeekDates = (offset = 0) => {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

// Patch an existing GCal event to new start/end time on same calendar
async function patchGCalEvent(accessToken, calendarId, eventId, newStart, newEnd) {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: newStart.toISOString(), timeZone: 'America/Denver' },
        end:   { dateTime: newEnd.toISOString(),   timeZone: 'America/Denver' },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GCal patch failed: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

// Find which calendar an event lives on (search across all tech calendars)
async function findEventCalendar(accessToken, eventId) {
  const calendarsToSearch = [
    CALENDARS.DRH_TECH_1,
    CALENDARS.JR_APPOINTMENT,
    CALENDARS.TECH3,
    CALENDARS.SUBS,
    CALENDARS.SHANA,
    CALENDARS.INSTALLATIONS,
    CALENDARS.TENTATIVELY_SCHEDULED,
  ].filter(Boolean);

  for (const calId of calendarsToSearch) {
    try {
      const res = await fetch(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.ok) return calId;
    } catch (_) {}
  }
  return null;
}

async function fetchGCalBusyCount(accessToken, calendarId, weekDates) {
  if (!accessToken || !calendarId) return {};
  try {
    const timeMin = new Date(weekDates[0]); timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(weekDates[weekDates.length - 1]); timeMax.setHours(23, 59, 59, 999);
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const busy = data.calendars?.[calendarId]?.busy || [];
    const counts = {};
    busy.forEach(block => {
      const day = new Date(block.start).toISOString().split('T')[0];
      counts[day] = (counts[day] || 0) + 1;
    });
    return counts;
  } catch (_) { return {}; }
}

export default function RescheduleModal({ job, assignments, onClose, onRescheduled, userEmail, accessToken }) {
  // Find current active assignment
  const activeAssignment = assignments?.find(a => !a.is_complete) || assignments?.[0];
  const currentTechName = activeAssignment?.tech?.name || null;
  const currentScheduledFor = activeAssignment?.scheduled_for || null;

  const [techs, setTechs] = useState([]);
  const [selectedTech, setSelectedTech] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState('9:00 AM');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gcalBusyCounts, setGcalBusyCounts] = useState({});
  const [rescheduleNote, setRescheduleNote] = useState('');

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Format old schedule for display + note
  const oldDateStr = currentScheduledFor
    ? new Date(currentScheduledFor).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Unscheduled';
  const oldTimeStr = currentScheduledFor
    ? new Date(currentScheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  useEffect(() => {
    techsApi.getAll().then(list => {
      const filtered = list.filter(t => ACTIVE_TECHS.includes(t.name));
      setTechs(filtered);
      // Default to current tech
      const curr = filtered.find(t => t.name === currentTechName);
      if (curr) setSelectedTech(curr);
    }).catch(console.error);

    // Default date/time to current schedule
    if (currentScheduledFor) {
      setSelectedDate(new Date(currentScheduledFor));
      setSelectedTime(toTimeSlot(currentScheduledFor));
    } else {
      const today = new Date();
      setSelectedDate(today.getDay() >= 1 && today.getDay() <= 6 ? today : (() => {
        const m = new Date(today); m.setDate(today.getDate() + 1); return m;
      })());
    }
  }, []);

  useEffect(() => {
    if (!selectedTech || !accessToken) return;
    const calId = TECH_GCAL_ID[selectedTech.name];
    if (!calId) return;
    fetchGCalBusyCount(accessToken, calId, weekDates).then(setGcalBusyCounts);
  }, [selectedTech, weekDates, accessToken]);

  const isToday = (d) => d.toDateString() === new Date().toDateString();
  const isPast  = (d) => { const t = new Date(); t.setHours(0,0,0,0); return d < t; };
  const isSelected = (d) => selectedDate && d.toDateString() === selectedDate.toDateString();

  const getBusyCount = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return gcalBusyCounts[dateStr] || 0;
  };

  const handleSubmit = async () => {
    if (!selectedTech || !selectedDate || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const { hours, minutes } = parseTime(selectedTime);
      const newStart = new Date(selectedDate);
      newStart.setHours(hours, minutes, 0, 0);
      const newEnd = new Date(newStart.getTime() + 2 * 60 * 60 * 1000); // 2hr default

      const techChanged = selectedTech.name !== currentTechName;
      const oldEventId = activeAssignment?.calendar_event_id;

      // ── 1. Update Supabase assignment ──────────────────────────────
      if (activeAssignment) {
        const assignUpdate = { scheduled_for: newStart.toISOString() };
        if (techChanged) {
          // Find new tech record and update tech_id
          const newTechRecord = techs.find(t => t.name === selectedTech.name);
          if (newTechRecord) assignUpdate.tech_id = newTechRecord.id;
        }
        await assignmentsApi.update(activeAssignment.id, assignUpdate);
      }

      // ── 2. Google Calendar sync ────────────────────────────────────
      if (accessToken) {
        if (!techChanged && oldEventId) {
          // Same tech — just patch the existing event's time
          try {
            const calId = TECH_GCAL_ID[selectedTech.name];
            if (calId && oldEventId) {
              await patchGCalEvent(accessToken, calId, oldEventId, newStart, newEnd);
            } else if (oldEventId) {
              // Don't know the cal, search for it
              const foundCal = await findEventCalendar(accessToken, oldEventId);
              if (foundCal) await patchGCalEvent(accessToken, foundCal, oldEventId, newStart, newEnd);
            }
          } catch (calErr) {
            console.warn('GCal patch failed (non-fatal):', calErr.message);
          }
        } else if (techChanged) {
          // Tech changed — archive old event, create new one on new tech's calendar
          try {
            if (oldEventId) {
              const oldCalId = TECH_GCAL_ID[currentTechName] || await findEventCalendar(accessToken, oldEventId);
              if (oldCalId) await archiveEvent(accessToken, oldCalId, oldEventId);
            }
            const newCalEvent = await scheduleToTechCalendar(accessToken, job, selectedTech, newStart);
            if (newCalEvent?.id && activeAssignment) {
              await assignmentsApi.update(activeAssignment.id, { calendar_event_id: newCalEvent.id });
            }
          } catch (calErr) {
            console.warn('GCal tech-change failed (non-fatal):', calErr.message);
          }
        }
      }

      // ── 3. Auto-note ───────────────────────────────────────────────
      const newDateStr = newStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const newTimeStr = newStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const techNote = techChanged ? ` (${currentTechName || '?'} → ${selectedTech.name})` : '';
      const noteLines = [
        `📅 RESCHEDULED${techNote}`,
        `From: ${oldDateStr}${oldTimeStr ? ' @ ' + oldTimeStr : ''}`,
        `To:   ${newDateStr} @ ${newTimeStr}`,
      ];
      if (rescheduleNote.trim()) noteLines.push(`Note: ${rescheduleNote.trim()}`);
      await notesApi.addNote(job.id, noteLines.join('\n'), userEmail);

      onClose();
      onRescheduled?.();
    } catch (e) {
      console.error('Reschedule error:', e);
      alert('Error rescheduling: ' + e.message);
      setIsSubmitting(false);
    }
  };

  const newDateLabel = selectedDate
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '—';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 400, display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer' }}>✕ Cancel</button>
        <div style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>📅 Reschedule</div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Current schedule banner */}
      <div style={{ padding: '12px 16px', background: '#1e1a2e', borderBottom: '1px solid #334155' }}>
        <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' }}>Moving</div>
        <div style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '15px' }}>{job.customer_name}</div>
        <div style={{ color: '#f59e0b', fontSize: '12px', marginTop: '2px' }}>
          Currently: {currentTechName || '?'} · {oldDateStr}{oldTimeStr ? ' @ ' + oldTimeStr : ''}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Tech picker */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>TECH</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {techs.map(tech => (
              <button key={tech.id} onClick={() => { setSelectedTech(tech); setGcalBusyCounts({}); }}
                style={{
                  padding: '10px 18px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
                  cursor: 'pointer', border: 'none',
                  background: selectedTech?.id === tech.id ? TECH_COLORS[tech.name] || '#3b82f6' : '#1e293b',
                  color: selectedTech?.id === tech.id ? '#fff' : '#94a3b8',
                  boxShadow: selectedTech?.id === tech.id ? `0 0 0 2px ${TECH_COLORS[tech.name] || '#3b82f6'}` : 'none',
                  outline: tech.name === currentTechName ? `1px dashed #475569` : 'none',
                }}>
                {tech.name}{tech.name === currentTechName ? ' ●' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Week picker */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600' }}>NEW DATE</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: '#334155', border: 'none', borderRadius: '6px', padding: '6px 10px', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}>←</button>
              <button onClick={() => setWeekOffset(0)} style={{ background: weekOffset === 0 ? '#3b82f6' : '#334155', border: 'none', borderRadius: '6px', padding: '6px 10px', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}>Today</button>
              <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: '#334155', border: 'none', borderRadius: '6px', padding: '6px 10px', color: '#e2e8f0', fontSize: '11px', cursor: 'pointer' }}>→</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
            {weekDates.map((d, i) => {
              const busy = selectedTech ? getBusyCount(d) : 0;
              return (
                <button key={i} onClick={() => !isPast(d) && setSelectedDate(d)} disabled={isPast(d)}
                  style={{
                    padding: '8px 2px', borderRadius: '8px', border: 'none', cursor: isPast(d) ? 'default' : 'pointer',
                    background: isSelected(d) ? '#f59e0b' : isToday(d) ? '#1e3a5f' : '#1e293b',
                    opacity: isPast(d) ? 0.4 : 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  }}>
                  <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '600' }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span style={{ color: isSelected(d) ? '#000' : isToday(d) ? '#00c8e8' : '#e2e8f0', fontSize: '16px', fontWeight: '700' }}>
                    {d.getDate()}
                  </span>
                  {selectedTech && busy > 0 && (
                    <span style={{
                      background: busy >= 5 ? '#ef4444' : busy >= 3 ? '#f59e0b' : '#22c55e',
                      color: '#fff', fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '6px'
                    }}>{busy}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time picker */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>TIME</div>
          <button onClick={() => setShowTimePicker(!showTimePicker)}
            style={{
              width: '100%', padding: '12px 16px', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '10px', color: '#e2e8f0', fontSize: '15px', fontWeight: '600',
              cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
            <span>🕐 {selectedTime}</span>
            <span style={{ color: '#cbd5e1' }}>{showTimePicker ? '▲' : '▼'}</span>
          </button>
          {showTimePicker && (
            <div style={{ marginTop: '6px', background: '#1e293b', borderRadius: '10px', padding: '6px', maxHeight: '160px', overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
              {TIME_SLOTS.map(time => (
                <button key={time} onClick={() => { setSelectedTime(time); setShowTimePicker(false); }}
                  style={{ padding: '8px 4px', background: selectedTime === time ? '#f59e0b' : '#0f172a', border: 'none', borderRadius: '6px', color: selectedTime === time ? '#000' : '#94a3b8', fontSize: '11px', cursor: 'pointer', fontWeight: selectedTime === time ? '700' : '400' }}>
                  {time}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Optional note */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>REASON (optional)</div>
          <input
            value={rescheduleNote}
            onChange={e => setRescheduleNote(e.target.value)}
            placeholder="Customer asked, weather, parts delay..."
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
              color: '#e2e8f0', padding: '12px 14px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>

      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', background: '#0f172a', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
        {selectedTech && selectedDate && (
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '10px', textAlign: 'center' }}>
            <span style={{ color: '#f59e0b', fontWeight: '600' }}>
              {selectedTech.name}
            </span>
            {' · '}{newDateLabel} @ {selectedTime}
            {selectedTech.name !== currentTechName && (
              <span style={{ color: '#ef4444', fontSize: '11px', display: 'block', marginTop: '2px' }}>
                ⚠️ Tech change — old calendar event will be archived
              </span>
            )}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!selectedTech || !selectedDate || isSubmitting}
          style={{
            width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
            background: selectedTech && selectedDate ? '#f59e0b' : '#334155',
            color: selectedTech && selectedDate ? '#000' : '#64748b',
            fontSize: '15px', fontWeight: '700', cursor: selectedTech && selectedDate ? 'pointer' : 'default',
          }}>
          {isSubmitting ? 'Rescheduling...' : '📅 Confirm Reschedule'}
        </button>
      </div>
    </div>
  );
}
