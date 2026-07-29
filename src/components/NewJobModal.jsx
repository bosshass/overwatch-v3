// ============================================
// JUC-E V4 - NewJobModal (Quick Add + Visual Scheduler)
// ============================================
// Customer → Issue → Type → Tech → VISUAL AVAILABILITY → CREATE
// Fetches actual GCal events for selected tech + date
// Shows timeline bar with busy blocks + green open slots

import { useState, useEffect, useCallback } from 'react';
import { jobsApi, customersApi, assignmentsApi, techsApi, JOB_STATUS, supabase } from '../services/supabase.js';
import { JOB_TYPE_INFO, JOB_TYPE_PICKER, PRIORITY_INFO } from '../utils/statusMachine.js';
import { SYNC_CALENDARS, TECH_COLORS, getTechCalendarId, CALENDARS } from '../config/calendars.js';
import CustomerPicker from './CustomerPicker.jsx';
import { canonicalEmail } from '../utils/ownership.js';

const TECH_PILL_COLORS = {
  'Austin': '#3b82f6',
  'JR': '#22c55e',
  'Shana': '#eab308',
  'Sara': '#a855f7',
  'Trevor': '#14b8a6',
};

export default function NewJobModal({ onClose, onCreated, userEmail, accessToken, prefill = null }) {
  const isConnect = !!prefill?.isConnect;
  const [mode, setMode] = useState(prefill ? 'job' : null);
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState(prefill?.customerName || '');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(true); // always start with search open on connect
  const [isSaving, setIsSaving] = useState(false);
  const [techs, setTechs] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [showMore, setShowMore] = useState(false);

  // Schedule — pre-filled from calendar event if connecting
  const [scheduleDate, setScheduleDate] = useState(prefill?.scheduleDate || '');
  const [scheduleTime, setScheduleTime] = useState(prefill?.scheduleTime || '');

  // Availability
  const [busyBlocks, setBusyBlocks] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [suggestedTime, setSuggestedTime] = useState('');

  useEffect(() => {
    techsApi.getAll().then(list => {
      setTechs(list);
      if (prefill?.techName && !assignedTo) {
        const match = list.find(t => t.name?.toLowerCase() === prefill.techName?.toLowerCase());
        if (match) setAssignedTo(match.id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!scheduleDate) setScheduleDate(new Date().toISOString().split('T')[0]);
  }, []);

  const INTAKE_TEMPLATE = `Name: 
Phone: 
On-Site Contact: 
Contact Phone: 
CMS #: 
Access: ☐ Permission to enter without client present
Scope of Work: `;

  const [form, setForm] = useState({
    customer_name: prefill?.customerName || '',
    customer_address: prefill?.address || '',
    customer_phone: '',
    job_type: prefill?.jobType || 'service_res',
    priority: 'normal',
    issue: prefill?.issue || INTAKE_TEMPLATE,
    photoLink: '',
    gate_code: '',
    panel_password: '',
    cms_account_id: ''
  });

  const [taskForm, setTaskForm] = useState({ title: '', assignedTo: '', customerId: null });
  const [noteForm, setNoteForm] = useState({ content: '', customerId: null, assignedTo: '' });

  const searchCustomers = useCallback(async (q) => {
    if (!q || q.length < 2) { setCustomers([]); return; }
    try { setCustomers(await customersApi.search(q)); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchCustomers]);

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setForm(f => {
      // If the issue is still the blank intake template, pre-fill the Name/Phone
      // lines from the customer record so they don't have to retype known info.
      let issue = f.issue;
      if (issue && issue.includes('Name:') && issue.includes('Phone:')) {
        issue = issue
          .replace(/^Name:\s*$/m, `Name: ${customer.name || ''}`)
          .replace(/^Phone:\s*$/m, `Phone: ${customer.phone || ''}`)
          .replace(/^CMS #:\s*$/m, `CMS #: ${customer.cms_account_id || ''}`);
      }
      return {
        ...f,
        customer_name: customer.name,
        customer_address: customer.address || '',
        customer_phone: customer.phone || '',
        gate_code: customer.gate_code || '',
        panel_password: customer.panel_password || '',
        cms_account_id: customer.cms_account_id || '',
        issue,
      };
    });
    setShowCustomerSearch(false);
    setSearchQuery(customer.name);
  };

  // ========== FETCH AVAILABILITY ==========
  const fetchAvailability = useCallback(async (techId, dateStr) => {
    if (!accessToken || !techId || !dateStr) { setBusyBlocks([]); setSuggestedTime(''); return; }
    setAvailLoading(true);

    const tech = techs.find(t => t.id === techId);
    if (!tech) { setAvailLoading(false); return; }

    // Resolve calendar ID
    let calendarId = null;
    if (tech.email) calendarId = getTechCalendarId(tech.email);
    if (!calendarId && tech.calendar_id) calendarId = tech.calendar_id;
    if (!calendarId) {
      const match = SYNC_CALENDARS.find(c => c.name === tech.name);
      if (match) calendarId = match.id;
    }

    // Also check all calendars this tech might appear on
    const calendarIds = new Set();
    if (calendarId) calendarIds.add(calendarId);
    // Check tech-named calendars
    const namedCal = SYNC_CALENDARS.find(c => c.name === tech.name);
    if (namedCal) calendarIds.add(namedCal.id);

    const dayStart = new Date(dateStr + 'T06:00:00');
    const dayEnd = new Date(dateStr + 'T20:00:00');
    const blocks = [];

    for (const calId of calendarIds) {
      try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?` +
          `timeMin=${dayStart.toISOString()}&timeMax=${dayEnd.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) continue;
        const data = await res.json();
        (data.items || []).forEach(event => {
          if (event.status === 'cancelled') return;
          const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
          const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
          if (start && end) {
            blocks.push({
              start, end,
              summary: event.summary || '(busy)',
              startHour: start.getHours() + start.getMinutes() / 60,
              endHour: end.getHours() + end.getMinutes() / 60,
            });
          }
        });
      } catch (e) { console.warn('Avail fetch error:', e); }
    }

    blocks.sort((a, b) => a.start - b.start);
    setBusyBlocks(blocks);

    // Auto-suggest: find first open 2-hour slot between 8am-5pm
    const slotDuration = (JOB_TYPE_INFO[form.job_type]?.minutes || 120) / 60;
    let suggested = '';
    for (let h = 8; h <= 17 - slotDuration; h += 0.5) {
      const slotStart = h;
      const slotEnd = h + slotDuration;
      const conflict = blocks.some(b => b.startHour < slotEnd && b.endHour > slotStart);
      if (!conflict) {
        const hour = Math.floor(h);
        const min = (h % 1) * 60;
        suggested = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        break;
      }
    }
    setSuggestedTime(suggested);
    if (suggested && !scheduleTime) setScheduleTime(suggested);

    setAvailLoading(false);
  }, [accessToken, techs, form.job_type, scheduleTime]);

  // Fetch when tech or date changes
  useEffect(() => {
    if (assignedTo && scheduleDate) fetchAvailability(assignedTo, scheduleDate);
  }, [assignedTo, scheduleDate, fetchAvailability]);

  // ========== CREATE GCAL EVENT ==========
  const createCalendarEvent = async (job, tech, scheduledFor) => {
    if (!accessToken) return null;
    let calendarId = null;
    if (tech.email) calendarId = getTechCalendarId(tech.email);
    if (!calendarId && tech.calendar_id) calendarId = tech.calendar_id;
    if (!calendarId) {
      const match = SYNC_CALENDARS.find(c => c.name === tech.name);
      if (match) calendarId = match.id;
    }
    if (!calendarId) return null;

    const startTime = new Date(scheduledFor);
    const duration = JOB_TYPE_INFO[job.job_type]?.minutes || 120;
    const endTime = new Date(startTime.getTime() + duration * 60000);

    const event = {
      summary: `${job.customer_name} - ${JOB_TYPE_INFO[job.job_type]?.full || job.job_type}`,
      location: job.customer_address || '',
      description: [
        job.issue ? `Issue: ${job.issue}` : '',
        job.customer_phone ? `Phone: ${job.customer_phone}` : '',
        job.gate_code ? `Gate: ${job.gate_code}` : '',
        job.panel_password ? `Panel: ${job.panel_password}` : '',
        `JUC-E Job: ${job.job_number || job.id}`
      ].filter(Boolean).join('\n'),
      start: { dateTime: startTime.toISOString(), timeZone: 'America/Denver' },
      end: { dateTime: endTime.toISOString(), timeZone: 'America/Denver' },
    };

    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }
      );
      if (res.ok) return await res.json();
    } catch (e) { console.error('GCal create error:', e); }
    return null;
  };

  // ========== SUBMIT JOB ==========
  const handleSubmitJob = async () => {
    if (!form.customer_name.trim()) return;
    setIsSaving(true);
    try {
      let customerId = selectedCustomer?.id;
      if (!customerId && form.customer_name.trim()) {
        const newCustomer = await customersApi.create({
          name: form.customer_name.trim(), address: form.customer_address, phone: form.customer_phone,
          gate_code: form.gate_code, panel_password: form.panel_password, cms_account_id: form.cms_account_id, is_active: true
        });
        customerId = newCustomer.id;
      }
      const willSchedule = assignedTo && scheduleDate && scheduleTime;
      const job = await jobsApi.create({
        customer_id: customerId, customer_name: form.customer_name.trim(), customer_address: form.customer_address,
        customer_phone: form.customer_phone, job_type: form.job_type, priority: form.priority,
        issue: [form.issue, form.photoLink.trim() ? `📎 Photos: ${form.photoLink.trim()}` : ''].filter(Boolean).join('\n\n'),
        gate_code: form.gate_code, panel_password: form.panel_password, cms_account_id: form.cms_account_id,
        status: willSchedule ? JOB_STATUS.SCHEDULED : JOB_STATUS.NEW
      }, userEmail);
      if (assignedTo && job?.id) {
        const scheduledFor = willSchedule ? `${scheduleDate}T${scheduleTime}:00` : null;
        const assignment = await assignmentsApi.create({ job_id: job.id, tech_id: assignedTo, scheduled_for: scheduledFor }, userEmail);
        if (willSchedule) {
          const tech = techs.find(t => t.id === assignedTo);
          if (tech) {
            const gcalEvent = await createCalendarEvent(job, tech, scheduledFor);
            if (gcalEvent && assignment?.id) {
              try { await supabase.from('job_assignments').update({ calendar_event_id: gcalEvent.id }).eq('id', assignment.id); }
              catch (e) { console.warn('Link GCal event failed:', e); }
            }
          }
        }
      }
      onClose();
      try { onCreated?.(job); } catch (_) {}

      // If not scheduled, write to Service/Urgent calendar so it appears in Queue
      if (!willSchedule) {
        const today = new Date().toISOString().split('T')[0];
        const queueEvent = {
          summary: `${form.customer_name.trim()} - ${JOB_TYPE_INFO[form.job_type]?.full || 'Service Call'}`,
          location: form.customer_address || '',
          description: [
            form.issue && `Issue: ${form.issue}`,
            form.customer_phone && `Phone: ${form.customer_phone}`,
            form.gate_code && `Gate: ${form.gate_code}`,
            form.panel_password && `Panel PW: ${form.panel_password}`,
            form.cms_account_id && `CMS: ${form.cms_account_id}`,
          ].filter(Boolean).join('\n'),
          start: { date: today },
          end:   { date: today },
        };
        fetch(
          // Uses the config constant now. This was a HARDCODED calendar id that
          // bypassed config/calendars.js entirely — which is why fixing the
          // config alone could never have fixed this writer.
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARS.TENTATIVELY_SCHEDULED)}/events`,
          { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(queueEvent) }
        ).catch(e => console.warn('Queue event write failed:', e));
      }
    } catch (e) {
      console.error('Create job error:', e);
      alert('Error creating job: ' + e.message);
      setIsSaving(false);
    }
  };

  // FIXED 9.11.5 — this created a real jobs row (status NEW), which put a
  // personal reminder on the BOARD next to real customer work. A quick note
  // is not a job; it belongs in the notes table (lane 'todo'), which My Tasks
  // already renders and already supports move-to-done, exactly like every
  // other personal to-do item. assignedTo, if set, hands it to that person's
  // To Do instead of the creator's — same meaning "assign" has everywhere else.
  const handleSubmitNote = async () => {
    if (!noteForm.content.trim()) return;
    setIsSaving(true);
    try {
      // No UI ever set noteForm.assignedTo (it was dead state from the old
      // job-based flow) — dropped rather than left as a silent no-op.
      const { data, error } = await supabase.from('notes').insert([{
        body: noteForm.content.trim(),
        author_email: canonicalEmail(userEmail),
        lane: 'todo',
        status: 'open',
        customer_id: noteForm.customerId || null,
        on_customer_record: !!noteForm.customerId,
      }]).select().single();
      if (error) throw error;
      onClose(); try { onCreated?.(data); } catch (_) {}
    } catch (e) { alert('Error saving note: ' + e.message); setIsSaving(false); }
  };

  // Same fix as handleSubmitNote, same reason — a task is a to-do item, not a
  // customer job, and should never have been eligible to sit on the board.
  const handleSubmitTask = async () => {
    if (!taskForm.title.trim()) return;
    setIsSaving(true);
    try {
      const { data, error } = await supabase.from('notes').insert([{
        body: taskForm.title.trim(),
        author_email: canonicalEmail(userEmail),
        lane: 'todo',
        status: 'open',
        customer_id: taskForm.customerId || null,
        on_customer_record: !!taskForm.customerId,
      }]).select().single();
      if (error) throw error;
      onClose(); try { onCreated?.(data); } catch (_) {}
    } catch (e) { alert('Error creating task: ' + e.message); setIsSaving(false); }
  };

  const fieldStyle = {
    width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
    color: '#e2e8f0', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  };
  const labelStyle = { color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' };

  // Time helpers
  const timeSlots = ['07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'];
  const formatSlotLabel = (t) => {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr);
    const m = mStr;
    const suffix = h >= 12 ? 'p' : 'a';
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m === '00' ? `${display}${suffix}` : `${display}:${m}${suffix}`;
  };

  const getDateOptions = () => {
    const dates = [];
    const d = new Date();
    while (dates.length < 7) {
      const dateStr = d.toISOString().split('T')[0];
      const day = d.getDay();
      const label = dates.length === 0 ? 'Today' :
        dates.length === 1 ? 'Tomorrow' :
        d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      dates.push({ value: dateStr, label, isWeekend: day === 0 || day === 6 });
      d.setDate(d.getDate() + 1);
    }
    return dates;
  };

  // Check if a time slot conflicts with busy blocks
  const isSlotBusy = (timeStr) => {
    const [hStr, mStr] = timeStr.split(':');
    const slotStart = parseInt(hStr) + parseInt(mStr) / 60;
    const duration = (JOB_TYPE_INFO[form.job_type]?.minutes || 120) / 60;
    const slotEnd = slotStart + duration;
    return busyBlocks.some(b => b.startHour < slotEnd && b.endHour > slotStart);
  };

  // ========== CONNECT MODE — link orphan calendar event to a customer ==========
  if (isConnect && mode === 'job') {
    const selectedTech = techs.find(t => t.id === assignedTo);
    const techColor = selectedTech ? (TECH_PILL_COLORS[selectedTech.name] || '#3b82f6') : '#3b82f6';
    const formattedDate = scheduleDate ? new Date(scheduleDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
    const formattedTime = scheduleTime ? new Date(`2000-01-01T${scheduleTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200, overflowY: 'auto' }}>
        <div style={{ background: '#0f1729', minHeight: '100vh', maxWidth: '500px', margin: '0 auto', padding: '20px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ color: '#00c8e8', fontSize: 18, fontWeight: 800 }}>🔗 Connect This Job</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>Match this calendar event to a customer</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>

          {/* Locked event details */}
          <div style={{ background: '#1e293b', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #334155' }}>
            <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              {prefill?.customerName || '(No title)'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {formattedDate && (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>📅 {formattedDate}</div>
              )}
              {formattedTime && (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>🕐 {formattedTime}</div>
              )}
              {prefill?.techName && (
                <div style={{ color: techColor, fontSize: 13, fontWeight: 700 }}>👤 {prefill.techName}</div>
              )}
              {prefill?.address && (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>📍 {prefill.address}</div>
              )}
            </div>
          </div>

          {/* Customer search */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              FIND CUSTOMER *
            </label>
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowCustomerSearch(true); }}
              placeholder="Search by name, phone, address..."
              autoFocus
              style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '12px 14px', color: '#e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
            {showCustomerSearch && customers.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, marginTop: 4, overflow: 'hidden' }}>
                {customers.map(c => (
                  <div key={c.id} onClick={() => selectCustomer(c)} style={{ padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #334155' }}>
                    <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: '#cbd5e1', fontSize: 12 }}>{c.phone} {c.address ? `· ${c.address}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected customer confirmation */}
          {selectedCustomer && (
            <div style={{ background: '#00c8e815', border: '1px solid #00c8e840', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ color: '#00c8e8', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>✓ Customer linked</div>
              <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{selectedCustomer.name}</div>
              {selectedCustomer.phone && <div style={{ color: '#94a3b8', fontSize: 12 }}>📞 {selectedCustomer.phone}</div>}
              {selectedCustomer.address && <div style={{ color: '#94a3b8', fontSize: 12 }}>📍 {selectedCustomer.address}</div>}
              {selectedCustomer.gate_code && <div style={{ color: '#f59e0b', fontSize: 12 }}>🔑 Gate: {selectedCustomer.gate_code}</div>}
              {selectedCustomer.panel_password && <div style={{ color: '#f59e0b', fontSize: 12 }}>🔐 Panel: {selectedCustomer.panel_password}</div>}
            </div>
          )}

          {/* Availability grid */}
          {selectedTech && scheduleDate && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {availLoading ? `Checking ${selectedTech.name}'s calendar...` : `${selectedTech.name}'s Day — tap a slot`}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                {Array.from({ length: 12 }, (_, i) => i + 7).map(h => {
                  const timeStr = `${String(h).padStart(2,'0')}:00`;
                  const busy = isSlotBusy(timeStr);
                  const selected = scheduleTime === timeStr;
                  const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
                  return (
                    <button key={h} onClick={() => !busy && setScheduleTime(timeStr)}
                      style={{
                        padding: '8px 2px', borderRadius: 6,
                        border: `2px solid ${selected ? '#00c8e8' : 'transparent'}`,
                        background: busy ? '#450a0a' : selected ? '#052e16' : '#0a2918',
                        color: busy ? '#fca5a5' : '#86efac',
                        fontSize: 10, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', textAlign: 'center'
                      }}>
                      {label}
                      <div style={{ fontSize: 8, marginTop: 1 }}>{busy ? '●' : '○'}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>● busy &nbsp; ○ open</div>
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={handleSubmitJob}
            disabled={!selectedCustomer || isSaving}
            style={{
              width: '100%', padding: '16px', fontSize: 16, fontWeight: 700,
              background: selectedCustomer ? '#00c8e8' : '#334155',
              color: selectedCustomer ? '#000' : '#64748b',
              border: 'none', borderRadius: 12, cursor: selectedCustomer ? 'pointer' : 'default'
            }}
          >
            {isSaving ? 'Connecting...' : '🔗 Connect & Save'}
          </button>
        </div>
      </div>
    );
  }

  // ========== MODE PICKER ==========
  if (!mode) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '28px 24px', width: '100%', maxWidth: '340px', border: '1px solid #1e293b' }}>
          <h2 style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '800', margin: '0 0 6px 0', textAlign: 'center' }}>What are you adding?</h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 24px 0' }}>Pick the right lane</p>
          {[
            { key: 'job', icon: '🔧', label: 'New Job', desc: 'Service call, install, estimate', color: '#3b82f6' },
            { key: 'task', icon: '📝', label: 'Quick Task', desc: 'Internal to-do, follow-up', color: '#f59e0b' },
            { key: 'note', icon: '📌', label: 'Quick Note', desc: 'Jot it down, assign later', color: '#10b981' },
          ].map(opt => (
            <button key={opt.key} onClick={() => setMode(opt.key)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '14px', background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '16px', marginBottom: '10px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: '28px' }}>{opt.icon}</span>
              <div>
                <div style={{ color: opt.color, fontWeight: '700', fontSize: '16px' }}>{opt.label}</div>
                <div style={{ color: '#cbd5e1', fontSize: '12px' }}>{opt.desc}</div>
              </div>
            </button>
          ))}
          <button onClick={onClose} style={{ width: '100%', padding: '12px', background: 'none', border: '1px solid #334155', borderRadius: '10px', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer', marginTop: '8px' }}>Cancel</button>
        </div>
      </div>
    );
  }

  // ========== TASK MODE ==========
  if (mode === 'task') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '380px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ color: '#f59e0b', fontSize: '18px', fontWeight: '700', margin: 0 }}>📝 Quick Task</h2>
            <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer' }}>← Back</button>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>What needs to be done? *</label>
            <textarea value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Follow up with supplier, check inventory..." rows={2} autoFocus style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Customer (optional)</label>
            <CustomerPicker value={taskForm.customerId}
              onChange={(id) => setTaskForm(f => ({ ...f, customerId: id }))}
              placeholder="Who's it about?" />
          </div>
          <button onClick={handleSubmitTask} disabled={!taskForm.title.trim() || isSaving}
            style={{ width: '100%', padding: '14px', fontSize: '16px', fontWeight: '700', background: taskForm.title.trim() ? '#f59e0b' : '#334155', color: taskForm.title.trim() ? '#000' : '#64748b', border: 'none', borderRadius: '12px', cursor: taskForm.title.trim() ? 'pointer' : 'default' }}>
            {isSaving ? 'Creating...' : '✓ Create Task'}
          </button>
        </div>
      </div>
    );
  }

  // ========== NOTE MODE ==========
  if (mode === 'note') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#0f1729', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '380px', border: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ color: '#10b981', fontSize: '18px', fontWeight: '700', margin: 0 }}>📌 Quick Note</h2>
            <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer' }}>← Back</button>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Note *</label>
            <textarea value={noteForm.content} onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))} placeholder="Jot it down..." rows={3} autoFocus style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Customer (optional)</label>
            {/* A real customer link now, not a free-text label — so this note
                shows up on that customer's history the same way any other
                logged interaction does. */}
            <CustomerPicker value={noteForm.customerId}
              onChange={(id) => setNoteForm(f => ({ ...f, customerId: id }))}
              placeholder="Who's it about?" />
          </div>
          <button onClick={handleSubmitNote} disabled={!noteForm.content.trim() || isSaving}
            style={{ width: '100%', padding: '14px', fontSize: '16px', fontWeight: '700', background: noteForm.content.trim() ? '#10b981' : '#334155', color: noteForm.content.trim() ? '#fff' : '#64748b', border: 'none', borderRadius: '12px', cursor: noteForm.content.trim() ? 'pointer' : 'default' }}>
            {isSaving ? 'Saving...' : '✓ Save Note'}
          </button>
        </div>
      </div>
    );
  }

  // ========== JOB MODE — VISUAL QUICK ADD ==========
  const willSchedule = assignedTo && scheduleDate && scheduleTime;
  const selectedTech = techs.find(t => t.id === assignedTo);
  const dateOptions = getDateOptions();
  const techColor = selectedTech ? (TECH_PILL_COLORS[selectedTech.name] || '#3b82f6') : '#3b82f6';

  // Visual timeline constants
  const TIMELINE_START = 7; // 7am
  const TIMELINE_END = 19; // 7pm
  const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1729', zIndex: 10 }}>
        <button onClick={() => setMode(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>← Back</button>
        <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>New Job</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '20px', cursor: 'pointer' }}>×</button>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* 1. CUSTOMER */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Customer *</label>
          <input value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowCustomerSearch(true); setSelectedCustomer(null); setForm(f => ({ ...f, customer_name: e.target.value })); }}
            placeholder="Search or type new customer name..." autoFocus style={fieldStyle} />
          {showCustomerSearch && customers.length > 0 && (
            <div style={{ background: '#1e293b', borderRadius: '8px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #334155' }}>
              {customers.map(c => (
                <div key={c.id} onClick={() => selectCustomer(c)}
                  style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #0f1729', background: selectedCustomer?.id === c.id ? '#00c8e815' : 'transparent' }}>
                  <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '500' }}>{c.name}</div>
                  {c.address && <div style={{ color: '#cbd5e1', fontSize: '12px' }}>{c.address}</div>}
                </div>
              ))}
            </div>
          )}
          {showCustomerSearch && searchQuery.length >= 2 && customers.length === 0 && (
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px', padding: '8px' }}>No match — will create new customer.</div>
          )}
        </div>

        {/* 2. ISSUE */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Issue / Description</label>
          <textarea value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} placeholder="What's the job?" rows={8} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          <input value={form.photoLink} onChange={e => setForm(f => ({ ...f, photoLink: e.target.value }))} placeholder="📎 Photos — paste a Google Drive share link (optional)" style={fieldStyle} />
        </div>


        {/* 5. VISUAL SCHEDULER */}
        {assignedTo && (
          <div style={{
            background: '#1a2332', borderRadius: '16px', padding: '18px',
            marginBottom: '16px', border: `2px solid ${techColor}30`,
            boxShadow: `0 0 30px ${techColor}10`
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: techColor }} />
                <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>
                  {selectedTech?.name}'s Schedule
                </span>
              </div>
              {availLoading && <span style={{ color: '#cbd5e1', fontSize: '11px' }}>Loading...</span>}
            </div>

            {/* Date pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {dateOptions.map(d => (
                <button key={d.value} onClick={() => { setScheduleDate(d.value); setScheduleTime(''); }}
                  style={{
                    background: scheduleDate === d.value ? techColor : '#0f1729',
                    color: scheduleDate === d.value ? '#fff' : d.isWeekend ? '#475569' : '#94a3b8',
                    border: `1px solid ${scheduleDate === d.value ? techColor : '#334155'}`,
                    borderRadius: '10px', padding: '8px 14px', fontSize: '12px',
                    cursor: 'pointer', fontWeight: scheduleDate === d.value ? '700' : '500'
                  }}>
                  {d.label}
                </button>
              ))}
            </div>

            {/* ===== VISUAL TIMELINE BAR ===== */}
            {scheduleDate && !availLoading && (
              <div style={{ marginBottom: '16px' }}>
                {/* Hour labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', padding: '0 2px' }}>
                  {[7, 9, 11, 13, 15, 17, 19].map(h => (
                    <span key={h} style={{ color: '#94a3b8', fontSize: '10px', fontWeight: '500' }}>
                      {h > 12 ? `${h-12}p` : h === 12 ? '12p' : `${h}a`}
                    </span>
                  ))}
                </div>

                {/* Timeline bar */}
                <div style={{
                  position: 'relative', height: '36px', background: '#22c55e20',
                  borderRadius: '8px', border: '1px solid #22c55e30', overflow: 'hidden'
                }}>
                  {/* Green base = all free */}
                  <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(90deg, #22c55e12, #22c55e12 ${100/TIMELINE_HOURS}%, #22c55e08 ${100/TIMELINE_HOURS}%, #22c55e08 ${200/TIMELINE_HOURS}%)` }} />

                  {/* Busy blocks — red overlay */}
                  {busyBlocks.map((b, i) => {
                    const leftPct = Math.max(0, ((b.startHour - TIMELINE_START) / TIMELINE_HOURS) * 100);
                    const widthPct = Math.min(100 - leftPct, ((b.endHour - b.startHour) / TIMELINE_HOURS) * 100);
                    if (leftPct >= 100 || widthPct <= 0) return null;
                    return (
                      <div key={i} title={`${b.summary} (${Math.floor(b.startHour)}:${String(Math.round((b.startHour % 1) * 60)).padStart(2, '0')} - ${Math.floor(b.endHour)}:${String(Math.round((b.endHour % 1) * 60)).padStart(2, '0')})`}
                        style={{
                          position: 'absolute', top: 2, bottom: 2, left: `${leftPct}%`, width: `${widthPct}%`,
                          background: '#ef444490', borderRadius: '4px', minWidth: '4px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
                        }}>
                        <span style={{ color: '#fff', fontSize: '9px', fontWeight: '600', whiteSpace: 'nowrap', padding: '0 4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                          {widthPct > 8 ? b.summary : ''}
                        </span>
                      </div>
                    );
                  })}

                  {/* Selected time indicator */}
                  {scheduleTime && (() => {
                    const [hStr, mStr] = scheduleTime.split(':');
                    const h = parseInt(hStr) + parseInt(mStr) / 60;
                    const duration = (JOB_TYPE_INFO[form.job_type]?.minutes || 120) / 60;
                    const leftPct = ((h - TIMELINE_START) / TIMELINE_HOURS) * 100;
                    const widthPct = (duration / TIMELINE_HOURS) * 100;
                    return (
                      <div style={{
                        position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
                        background: `${techColor}60`, border: `2px solid ${techColor}`,
                        borderRadius: '4px', zIndex: 2
                      }} />
                    );
                  })()}
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#cbd5e1' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: '#22c55e40', border: '1px solid #22c55e60' }} /> Open
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#cbd5e1' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ef444490' }} /> Busy
                  </span>
                  {scheduleTime && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#cbd5e1' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: techColor, border: `1px solid ${techColor}` }} /> Selected
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Suggested time banner */}
            {suggestedTime && !scheduleTime && !availLoading && (
              <button onClick={() => setScheduleTime(suggestedTime)}
                style={{
                  width: '100%', padding: '12px', marginBottom: '12px',
                  background: `${techColor}15`, border: `1px solid ${techColor}40`,
                  borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: '10px'
                }}>
                <span style={{ fontSize: '20px' }}>⚡</span>
                <div>
                  <div style={{ color: techColor, fontSize: '14px', fontWeight: '700' }}>
                    Suggested: {formatSlotLabel(suggestedTime)}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '11px' }}>
                    First open {Math.round((JOB_TYPE_INFO[form.job_type]?.minutes || 120) / 60 * 10) / 10}hr slot
                  </div>
                </div>
              </button>
            )}

            {/* Time slot grid */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {timeSlots.map(t => {
                const busy = busyBlocks.length > 0 && isSlotBusy(t);
                const active = scheduleTime === t;
                const isSuggested = t === suggestedTime && !scheduleTime;
                return (
                  <button key={t} onClick={() => setScheduleTime(scheduleTime === t ? '' : t)}
                    disabled={busy}
                    style={{
                      background: active ? techColor : busy ? '#ef444425' : isSuggested ? `${techColor}20` : '#0f1729',
                      color: active ? '#fff' : busy ? '#ef444480' : isSuggested ? techColor : '#94a3b8',
                      border: `1px solid ${active ? techColor : busy ? '#ef444440' : isSuggested ? `${techColor}50` : '#334155'}`,
                      borderRadius: '10px', padding: '10px 14px', fontSize: '13px',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      fontWeight: active || isSuggested ? '700' : '500',
                      minWidth: '48px', textAlign: 'center',
                      textDecoration: busy ? 'line-through' : 'none',
                      opacity: busy ? 0.5 : 1,
                      boxShadow: active ? `0 0 12px ${techColor}40` : 'none',
                      transition: 'all 0.15s ease'
                    }}>
                    {formatSlotLabel(t)}
                  </button>
                );
              })}
            </div>

            {/* Busy event list */}
            {busyBlocks.length > 0 && (
              <div style={{ marginTop: '14px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '6px' }}>
                  {busyBlocks.length} event{busyBlocks.length > 1 ? 's' : ''} on this day
                </div>
                {busyBlocks.map((b, i) => {
                  const startTime = b.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  const endTime = b.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 0' }}>
                      <div style={{ width: 4, height: 24, borderRadius: 2, background: '#ef4444', flexShrink: 0 }} />
                      <div>
                        <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{b.summary}</div>
                        <div style={{ color: '#cbd5e1', fontSize: '11px' }}>{startTime} – {endTime}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {busyBlocks.length === 0 && !availLoading && scheduleDate && (
              <div style={{ marginTop: '12px', color: '#22c55e', fontSize: '12px', fontWeight: '600' }}>
                ✓ Wide open — no conflicts
              </div>
            )}
          </div>
        )}

        {/* Phone */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Phone</label>
          <input value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} placeholder="(303) 555-0000" style={fieldStyle} />
        </div>

        {/* Expandable details */}
        <button onClick={() => setShowMore(!showMore)}
          style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '12px', color: '#cbd5e1', fontSize: '13px', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span>{showMore ? '▾' : '▸'} Priority, Address, Access Codes</span>
          {(form.priority !== 'normal' || form.gate_code || form.panel_password) && <span style={{ color: '#f59e0b', fontSize: '11px' }}>●</span>}
        </button>

        {showMore && (
          <div style={{ background: '#1e293b15', borderRadius: '10px', padding: '12px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Address</label>
              <input value={form.customer_address} onChange={e => setForm(f => ({ ...f, customer_address: e.target.value }))} placeholder="123 Main St" style={fieldStyle} />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Gate Code</label>
                <input value={form.gate_code} onChange={e => setForm(f => ({ ...f, gate_code: e.target.value }))} placeholder="#1234" style={fieldStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Panel Password</label>
                <input value={form.panel_password} onChange={e => setForm(f => ({ ...f, panel_password: e.target.value }))} placeholder="****" style={fieldStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>CMS Account ID</label>
              <input value={form.cms_account_id} onChange={e => setForm(f => ({ ...f, cms_account_id: e.target.value }))} placeholder="DRH-0090" style={fieldStyle} />
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom */}
      <div style={{ padding: '16px', background: '#0f1729', borderTop: '1px solid #1e293b', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}>
        {willSchedule && (
          <div style={{ color: techColor, fontSize: '13px', textAlign: 'center', marginBottom: '8px', fontWeight: '600' }}>
            📅 {selectedTech?.name} • {new Date(scheduleDate + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} @ {formatSlotLabel(scheduleTime)}
            {isSlotBusy(scheduleTime) && <span style={{ color: '#ef4444', marginLeft: '8px' }}>⚠️ CONFLICT</span>}
          </div>
        )}
        <button onClick={handleSubmitJob} disabled={!form.customer_name.trim() || isSaving}
          style={{
            width: '100%', padding: '16px', fontSize: '16px', fontWeight: '700',
            background: form.customer_name.trim() ? willSchedule ? techColor : '#22c55e' : '#334155',
            color: form.customer_name.trim() ? '#fff' : '#64748b',
            border: 'none', borderRadius: '12px', cursor: form.customer_name.trim() ? 'pointer' : 'default',
            boxShadow: willSchedule ? `0 4px 20px ${techColor}40` : 'none'
          }}>
          {isSaving ? 'Creating...' : willSchedule ? '📅 Create & Schedule' : assignedTo ? '✓ Create & Assign' : '✓ Create Job'}
        </button>
      </div>
    </div>
  );
}
