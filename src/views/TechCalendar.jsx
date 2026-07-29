// ============================================
// JUC-E V4 - TechCalendar View (Redesigned)
// ============================================
// Screen 2: Desktop week grid with colored-border event cards
// Screen 5: Mobile day view with timeline + tech pills
// Preserves: GCal fetch, Supabase sync, orphan detection, search, tasks tab

import { useState, useEffect, useCallback, useMemo } from 'react';
import { assignmentsApi, jobsApi, queries, JOB_STATUS, techsApi, supabase } from '../services/supabase.js';
import { scanForOrphans, ignoreOrphan, ignoreAllOrphans, syncIgnoredOrphansFromSupabase } from '../services/calendarSync.js';
import { fetchCalendarEvents as gcalFetchEvents } from '../services/calendarApi.js';
import { TECH_COLORS, getVisibleCalendars, CALENDARS } from '../config/calendars.js';
import { JOB_TYPE_INFO, getJobAge, getAgeUrgency } from '../utils/statusMachine.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';
import JobCard from '../components/JobCard.jsx';
import JobDetail from '../components/JobDetail.jsx';
import NewJobModal from '../components/NewJobModal.jsx';
import JobFinishSheet from '../components/JobFinishSheet.jsx';
import { APP_BASE } from '../config/appBase.js';
import InboxBar from '../components/InboxBar.jsx';
import { assigneeOf } from '../utils/ownership.js';

const CALENDAR_COLORS = {
  ...TECH_COLORS,
  'Tentatively Scheduled': '#ef4444',
  'Sales & Accounting': '#ec4899',
  'Completed': '#6b7280',
  'Installations': '#14b8a6',
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6);

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + (offset * 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatHour(h) {
  if (h === 0 || h === 12) return h === 0 ? '12am' : '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export default function TechCalendar({ accessToken, userEmail, defaultCalendar, isRestricted, isOperator, userName, autoWorkToDo, defaultTab, autoNewJob, onJobCreated }) {
  const [mainTab, setMainTab] = useState(
    defaultTab || (autoWorkToDo ? 'tasks' : isOperator ? 'calendar' : isRestricted ? 'calendar' : 'tasks')
  );

  // Calendars this user is allowed to see — computed once from email
  const USER_CALENDARS = getVisibleCalendars(userEmail);

  // ===== CALENDAR STATE =====
  const [calEvents, setCalEvents] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calLoading, setCalLoading] = useState(true);
  const [hiddenCalendars, setHiddenCalendars] = useState(() => {
    try {
      const saved = localStorage.getItem(`juce-cal-hidden-${userEmail}`);
      if (saved) {
        const parsed = new Set(JSON.parse(saved));
        // Safety: if saved state hides the user's own tech calendar, reset it
        const techCals = USER_CALENDARS.filter(c => c.type === 'tech').map(c => c.name);
        const allTechHidden = techCals.length > 0 && techCals.every(n => parsed.has(n));
        if (allTechHidden) {
          // Reset — show only defaultCalendar
          if (defaultCalendar) {
            const allNames = USER_CALENDARS.filter(c => c.type !== 'completed').map(c => c.name);
            return new Set(allNames.filter(n => n !== defaultCalendar));
          }
          return new Set();
        }
        return parsed;
      }
    } catch {}
    if (defaultCalendar) {
      const allNames = USER_CALENDARS.filter(c => c.type !== 'completed').map(c => c.name);
      return new Set(allNames.filter(n => n !== defaultCalendar));
    }
    return new Set();
  });
  const [calViewMode, setCalViewMode] = useState('week');
  const todayRef = new Date();
  todayRef.setHours(0, 0, 0, 0);
  const [selectedDay, setSelectedDay] = useState(todayRef.getDay() === 0 ? 6 : todayRef.getDay() - 1);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ===== TASKS STATE =====
  const [taskTab, setTaskTab] = useState('today');
  const [jobs, setJobs] = useState([]);
  const [orphans, setOrphans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [showNewJob, setShowNewJob] = useState(autoNewJob === true);
  const [adoptingOrphan, setAdoptingOrphan] = useState(null);
  const [showOrphanActions, setShowOrphanActions] = useState(null);

  // ── Deep link handler ──────────────────────────────────────────────────────
  // Reads ?cal=...&job=... on mount, waits for calEvents to load, then auto-opens
  const [pendingDeepJobId, setPendingDeepJobId] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const job = p.get('job');
    if (job) {
      setPendingDeepJobId(job);
      // Clean URL so back-button / refresh don't re-trigger
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!pendingDeepJobId || !calEvents.length) return;
    const target = calEvents.find(e => e.id === pendingDeepJobId);
    if (target) {
      openEvent(target);
      setPendingDeepJobId(null);
    }
  }, [pendingDeepJobId, calEvents]); // openEvent intentionally omitted — not memoized
  // ──────────────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // ========== GOOGLE CALENDAR FETCH ==========
  const fetchCalendarEvents = useCallback(async () => {
    if (!accessToken) return;
    setCalLoading(true);
    const timeMin = new Date(weekDates[0]);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(weekDates[6]);
    timeMax.setHours(23, 59, 59, 999);
    const allEvents = [];

    await Promise.all(USER_CALENDARS.map(async (cal) => {
      try {
        // Shared service (services/calendarApi.js)
        const items = await gcalFetchEvents(accessToken, cal.id, timeMin, timeMax);
        items.forEach(event => {
          if (event.status === 'cancelled') return;
          if (event.visibility === 'private') return; // hidden from JUC-E
          const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date + 'T00:00:00') : null;
          const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date + 'T23:59:59') : null;
          if (!start) return;
          allEvents.push({
            id: event.id, calendarId: cal.id, calendarName: cal.name, calendarType: cal.type,
            summary: event.summary || '(no title)', location: event.location || '',
            description: event.description || '', htmlLink: event.htmlLink || '',
            start, end, isAllDay: !event.start?.dateTime,
            color: CALENDAR_COLORS[cal.name] || '#6b7280',
            visibility: event.visibility || 'default',
          });
        });
      } catch (e) { console.error(`Error fetching ${cal.name}:`, e); }
    }));

    allEvents.sort((a, b) => a.start - b.start);

    // Also fetch Supabase assignments for hybrid coverage
    try {
      const { data: assignments } = await supabase
        .from('job_assignments')
        .select('*, job:jobs(*), tech:techs(*)')
        .gte('scheduled_for', weekDates[0].toISOString())
        .lte('scheduled_for', new Date(weekDates[6].getTime() + 24*60*60*1000).toISOString())
        .or('is_complete.is.null,is_complete.eq.false');

      if (assignments?.length) {
        const gcalIds = new Set(allEvents.map(e => e.id));
        assignments.forEach(a => {
          if (a.calendar_event_id && gcalIds.has(a.calendar_event_id)) return;
          const techName = a.tech?.name || 'Unknown';
          const start = new Date(a.scheduled_for);
          const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
          allEvents.push({
            id: `juce-${a.id}`, calendarId: 'juce-internal', calendarName: techName, calendarType: 'tech',
            summary: a.job?.customer_name || 'Unknown', location: a.job?.customer_address || '',
            description: a.job?.issue || '', htmlLink: '', start, end, isAllDay: false,
            color: CALENDAR_COLORS[techName] || '#6b7280',
            _juceJobId: a.job_id, _juceAssignment: true,
          });
        });
        allEvents.sort((a, b) => a.start - b.start);
      }
    } catch (e) { console.warn('Supabase assignment fetch failed:', e); }

    setCalEvents(allEvents);
    setCalLoading(false);
  }, [accessToken, weekDates]);

  useEffect(() => { fetchCalendarEvents(); }, [fetchCalendarEvents]);

  // ========== CALENDAR HELPERS ==========
  const toggleCalendar = (name) => {
    setHiddenCalendars(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      localStorage.setItem(`juce-cal-hidden-${userEmail}`, JSON.stringify([...next]));
      return next;
    });
  };

  const soloCalendar = (name) => {
    const allCals = USER_CALENDARS.filter(c => c.type !== 'completed').map(c => c.name);
    const isSolo = hiddenCalendars.size === allCals.length - 1 && !hiddenCalendars.has(name);
    if (isSolo) {
      setHiddenCalendars(new Set());
      localStorage.setItem(`juce-cal-hidden-${userEmail}`, '[]');
    } else {
      const hidden = new Set(allCals.filter(n => n !== name));
      setHiddenCalendars(hidden);
      localStorage.setItem(`juce-cal-hidden-${userEmail}`, JSON.stringify([...hidden]));
    }
  };

  const visibleEvents = calEvents.filter(e => !hiddenCalendars.has(e.calendarName));
  const getEventsForDay = (dayIndex) => {
    const date = weekDates[dayIndex];
    return visibleEvents.filter(e => {
      const eDate = new Date(e.start);
      return eDate.getFullYear() === date.getFullYear() && eDate.getMonth() === date.getMonth() && eDate.getDate() === date.getDate();
    });
  };
  const isToday = (date) => date.getTime() === today.getTime();

  // Smart event opener
  const [eventPreview, setEventPreview] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showWorkToDo, setShowWorkToDo] = useState(autoWorkToDo === true);

  const openEvent = async (event) => {
    if (event._juceJobId) { setSelectedJobId(event._juceJobId); return; }
    setEventLoading(true);
    try {
      const assignment = await assignmentsApi.getByCalendarEventId(event.id);
      if (assignment?.job_id) { setSelectedJobId(assignment.job_id); setEventLoading(false); return; }
      const summary = (event.summary || '').toLowerCase();
      if (summary.length > 3) {
        const { data: matchedJobs } = await supabase
          .from('jobs').select('id, customer_name, issue')
          .or(`customer_name.ilike.%${summary.slice(0, 30)}%,issue.ilike.%${summary.slice(0, 30)}%`)
          .limit(1);
        if (matchedJobs?.length > 0) { setSelectedJobId(matchedJobs[0].id); setEventLoading(false); return; }
      }
    } catch (e) { console.warn('Event match error:', e); }
    // No matching job → open the finish sheet directly (same flow as Work To Do Today).
    setEventPreview(event);
    setShowCompleteModal(true);
    setEventLoading(false);
  };

  // ========== TASK DATA LOAD ==========
  const loadTaskData = useCallback(async () => {
    setIsLoading(true);
    try {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
      let startDate, endDate;
      if (taskTab === 'today') { startDate = now.toISOString(); endDate = tomorrow.toISOString(); }
      else if (taskTab === 'tomorrow') { startDate = tomorrow.toISOString(); endDate = new Date(tomorrow.getTime() + 86400000).toISOString(); }
      else { startDate = now.toISOString(); endDate = weekEnd.toISOString(); }

      const allAssigned = await assignmentsApi.getAllSchedule(startDate, endDate);
      const newJobs = taskTab === 'today' ? await queries.getATCQueue() : [];
      setJobs([...allAssigned, ...newJobs.map(j => ({ ...j, _isQueue: true }))]);

      if (accessToken) {
        try {
          await syncIgnoredOrphansFromSupabase(); // pull cross-device ignores first
          const scan = await scanForOrphans(accessToken); setOrphans(scan.orphans || []);
        }
        catch (e) { console.warn('Orphan scan error:', e); }
      }
    } catch (e) { console.error('Load error:', e); }
    finally { setIsLoading(false); }
  }, [taskTab, accessToken]);

  useEffect(() => { if (mainTab === 'tasks') loadTaskData(); }, [loadTaskData, mainTab]);

  // ========== SEARCH ==========
  const runSearch = useCallback(async (query) => {
    if (!query || query.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    const q = query.toLowerCase();
    const results = { calendarEvents: [], jobs: [] };
    results.calendarEvents = calEvents.filter(e =>
      e.summary.toLowerCase().includes(q) || e.location.toLowerCase().includes(q) ||
      e.calendarName.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
    if (accessToken && results.calendarEvents.length < 5) {
      try {
        const searchMin = new Date(); searchMin.setDate(searchMin.getDate() - 30);
        const searchMax = new Date(); searchMax.setDate(searchMax.getDate() + 60);
        const searchPromises = USER_CALENDARS.map(async (cal) => {
          try {
            const items = await gcalFetchEvents(accessToken, cal.id, searchMin, searchMax, { q: query, maxResults: 50 });
            return items.filter(e => e.status !== 'cancelled').map(event => ({
              id: event.id, calendarId: cal.id, calendarName: cal.name, calendarType: cal.type,
              summary: event.summary || '(no title)', location: event.location || '',
              htmlLink: event.htmlLink || '',
              start: event.start?.dateTime ? new Date(event.start.dateTime) : null,
              end: event.end?.dateTime ? new Date(event.end.dateTime) : null,
              isAllDay: !event.start?.dateTime, color: CALENDAR_COLORS[cal.name] || '#6b7280',
            }));
          } catch { return []; }
        });
        const apiResults = (await Promise.all(searchPromises)).flat();
        const existing = new Set(results.calendarEvents.map(e => e.id));
        apiResults.forEach(e => { if (!existing.has(e.id)) results.calendarEvents.push(e); });
      } catch {}
    }
    try { results.jobs = await jobsApi.search(query) || []; }
    catch { results.jobs = jobs.filter(j => (j.customer_name || '').toLowerCase().includes(q) || (j.issue || '').toLowerCase().includes(q)); }
    results.calendarEvents.sort((a, b) => (a.start || 0) - (b.start || 0));
    setSearchResults(results);
    setSearchLoading(false);
  }, [calEvents, accessToken, jobs]);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);

  const { PullIndicator } = usePullToRefresh(mainTab === 'calendar' ? fetchCalendarEvents : loadTaskData);

  // Task tab helpers
  const scheduledJobs = jobs.filter(j => {
    if (!j._isQueue && j.scheduled_for) {
      // was j.tech_name — a restricted tech stopped seeing their own jobs the
      // moment an assignment was written to assigned_to instead.
      const who = assigneeOf(j);
      if (isRestricted && who && who.toLowerCase() !== userName?.toLowerCase()) return false;
      return true;
    }
    return false;
  });
  const queueJobs = isRestricted ? [] : jobs.filter(j => j._isQueue);
  const sortedScheduled = [...scheduledJobs].sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
  const groupByDay = (items) => {
    const groups = {};
    items.forEach(j => {
      const date = new Date(j.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!groups[date]) groups[date] = [];
      groups[date].push(j);
    });
    return groups;
  };
  const dayGroups = taskTab === 'week' ? groupByDay(sortedScheduled) : null;

  const handleAdoptOrphan = (orphan) => { setAdoptingOrphan(orphan); setShowNewJob(true); };
  const handleIgnoreOrphan = async (orphan) => { await ignoreOrphan(orphan.event.id); setOrphans(prev => prev.filter(o => o.event.id !== orphan.event.id)); };
  const handleIgnoreAllOrphans = async () => {
    const ids = orphans.map(o => o.event.id);
    await ignoreAllOrphans(ids);
    setOrphans([]);
  };

  const makeJuceJob = async (event) => {
    try {
      const deepLink = `${APP_BASE}/?cal=${encodeURIComponent(event.calendarId)}&job=${encodeURIComponent(event.id)}`;
      const currentDesc = event.description || '';
      const stripped = currentDesc.replace(/\n*📱 Open in (JUC-E|Overwatch):.*$/s, '').trimEnd();
      const newDesc = (stripped ? stripped + '\n\n' : '') + `📱 Open in Overwatch: ${deepLink}`;

      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc })
        }
      );

      setEventPreview(null);
      setOrphans(prev => prev.filter(o => o.event?.id !== event.id));
      fetchCalendarEvents();
    } catch (e) {
      console.error('makeJuceJob failed:', e);
      alert('Failed: ' + e.message);
    }
  };
  const formatTime = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); };

  const STATUS_TAGS = [
    { label: 'SCHEDULED',       emoji: '📅', color: '#3b82f6', dark: '#0f2544' },
    { label: 'CONFIRMED',       emoji: '✅', color: '#22c55e', dark: '#052e16' },
    { label: 'BILLED',          emoji: '💵', color: '#a78bfa', dark: '#1e1040' },
    { label: 'RETURN NEEDED',   emoji: '🔄', color: '#f59e0b', dark: '#2d1a00' },
    { label: 'ESTIMATE NEEDED', emoji: '📋', color: '#00c8e8', dark: '#001a20' },
    { label: 'COMPLETED',       emoji: '🏁', color: '#94a3b8', dark: '#1e293b' },
  ];

  const applyStatusTag = async (event, tag) => {
    const currentSummary = event.summary || '';
    // Strip any existing tag prefix like [WHATEVER]
    const stripped = currentSummary.replace(/^\[[^\]]+\]\s*/, '');
    const newSummary = `[${tag.label}] ${stripped}`;
    try {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: newSummary })
        }
      );
      fetchCalendarEvents();
    } catch(e) { console.error('Tag failed:', e); }
  };

  const OrphanActions = ({ orphan, onClose }) => {
    const [working, setWorking] = useState(false);

    const syncAndMakeJob = async () => {
      setWorking(true);
      await makeJuceJob(orphan.event);
      setOrphans(prev => prev.filter(o => o.event.id !== orphan.event.id));
      onClose();
    };

    const addToUnassigned = async () => {
      setWorking(true);
      try {
        const existing = JSON.parse(localStorage.getItem('juce_unassigned') || '[]');
        existing.unshift({
          id: Date.now(),
          created_at: new Date().toISOString(),
          title: orphan.event.summary || '(no title)',
          calendarName: orphan.calendarName,
          date: orphan.event.start?.dateTime || orphan.event.start?.date || '',
          location: orphan.event.location || '',
          description: orphan.event.description || '',
          sourceEventId: orphan.event.id,
          sourceCalendarId: orphan.event.calendarId,
        });
        localStorage.setItem('juce_unassigned', JSON.stringify(existing));
        setOrphans(prev => prev.filter(o => o.event.id !== orphan.event.id));
        onClose();
      } catch(e) { console.error(e); setWorking(false); }
    };

    const needsBilled = async () => {
      setWorking(true);
      await applyStatusTag(orphan.event, { label: 'NEEDS BILLING', emoji: '💵', color: '#a78bfa' });
      setOrphans(prev => prev.filter(o => o.event.id !== orphan.event.id));
      onClose();
    };

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '500px', padding: '20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>

          {/* Event info */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>{orphan.event.summary}</div>
            <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>
              {orphan.calendarName}
              {orphan.event.start?.dateTime && ` · ${new Date(orphan.event.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
              {orphan.event.start?.dateTime && ` @ ${new Date(orphan.event.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              {orphan.event.location && ` · 📍 ${orphan.event.location}`}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Sync & Make JUC-E Job */}
            <button onClick={syncAndMakeJob} disabled={working} style={{
              background: 'linear-gradient(135deg, #1e3a5f, #0f2040)',
              border: '2px solid #3b82f6', borderRadius: 12,
              padding: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left'
            }}>
              <span style={{ fontSize: 24 }}>🔗</span>
              <div>
                <div style={{ color: '#3b82f6', fontSize: 14, fontWeight: 700 }}>Sync & Make JUC-E Job</div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Pulls calendar data in, stamps deep link, enables end-of-job workflow</div>
              </div>
            </button>

            {/* Add to Unassigned */}
            <button onClick={addToUnassigned} disabled={working} style={{
              background: '#2d1a00', border: '2px solid #f59e0b',
              borderRadius: 12, padding: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left'
            }}>
              <span style={{ fontSize: 24 }}>📥</span>
              <div>
                <div style={{ color: '#f59e0b', fontSize: 14, fontWeight: 700 }}>Add to Unassigned</div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Holds it for review — not a task yet, not ignored</div>
              </div>
            </button>

            {/* Needs to be Billed */}
            <button onClick={needsBilled} disabled={working} style={{
              background: '#1e1040', border: '2px solid #a78bfa',
              borderRadius: 12, padding: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left'
            }}>
              <span style={{ fontSize: 24 }}>💵</span>
              <div>
                <div style={{ color: '#a78bfa', fontSize: 14, fontWeight: 700 }}>Needs to be Billed</div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Tags as NEEDS BILLING, removes from orphan list</div>
              </div>
            </button>

            {/* Hide */}
            <button onClick={() => { handleIgnoreOrphan(orphan); onClose(); }} disabled={working} style={{
              background: 'none', border: '1px solid #334155',
              borderRadius: 10, padding: '12px', cursor: 'pointer', color: '#94a3b8', fontSize: 13
            }}>🙈 Hide from JUC-E</button>
          </div>

          <button onClick={onClose} style={{ width: '100%', background: 'none', border: 'none', color: '#94a3b8', padding: '12px 0 0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    );
  };

  // ========== TECH FILTER PILLS (shared) ==========
  const renderTechFilters = () => {
    const allCals = USER_CALENDARS.filter(c => c.type !== 'completed');
    return (
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}>
        <button onClick={() => { setHiddenCalendars(new Set()); localStorage.setItem(`juce-cal-hidden-${userEmail}`, '[]'); }}
          style={{
            padding: '8px 20px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: hiddenCalendars.size === 0 ? '#3b82f6' : '#1e293b',
            color: hiddenCalendars.size === 0 ? '#fff' : '#94a3b8', whiteSpace: 'nowrap'
          }}>All</button>
        {allCals.map(cal => {
          const isSolo = hiddenCalendars.size === allCals.length - 1 && !hiddenCalendars.has(cal.name);
          const color = CALENDAR_COLORS[cal.name] || '#6b7280';
          return (
            <button key={cal.name} onClick={() => soloCalendar(cal.name)}
              style={{
                padding: '8px 20px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: isSolo ? color : 'transparent',
                color: isSolo ? '#fff' : '#94a3b8',
                border: `1px solid ${isSolo ? 'transparent' : '#334155'}`, whiteSpace: 'nowrap'
              }}>{cal.name}</button>
          );
        })}
      </div>
    );
  };

  // ========== VIEW TOGGLE ==========
  const renderViewToggle = () => (
    <div style={{ display: 'flex', gap: 0, background: '#1e293b', borderRadius: 20, overflow: 'hidden' }}>
      <button onClick={() => setCalViewMode('week')} style={{
        background: calViewMode === 'week' ? '#3b82f6' : 'transparent',
        color: calViewMode === 'week' ? '#fff' : '#64748b',
        border: 'none', padding: '7px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderRadius: 20
      }}>Week</button>
      <button onClick={() => setCalViewMode('day')} style={{
        background: calViewMode === 'day' ? '#3b82f6' : 'transparent',
        color: calViewMode === 'day' ? '#fff' : '#64748b',
        border: 'none', padding: '7px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderRadius: 20
      }}>Day</button>
    </div>
  );

  // ========== WEEK VIEW (Screen 2 mockup) ==========
  const renderWeekView = () => {
    const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return (
      <div>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '50px repeat(7, 1fr)', gap: 0, marginBottom: 0, borderBottom: '1px solid #1e293b' }}>
          <div />
          {weekDates.map((d, i) => (
            <div key={i} onClick={() => setSelectedDay(i)}
              style={{ textAlign: 'center', padding: '8px 0', cursor: 'pointer' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', letterSpacing: '0.5px' }}>{DAY_NAMES[i]}</div>
              <div style={{
                fontSize: 16, fontWeight: 700,
                color: isToday(d) ? '#fff' : '#94a3b8',
                background: isToday(d) ? '#3b82f6' : 'transparent',
                borderRadius: 8, padding: '2px 8px', display: 'inline-block'
              }}>{d.getDate()}</div>
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div style={{ position: 'relative', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
          {HOURS.map(h => (
            <div key={h} style={{
              display: 'grid', gridTemplateColumns: '50px repeat(7, 1fr)', gap: 0,
              height: 50, borderBottom: '1px solid #1e293b10'
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', paddingRight: 8, marginTop: -7, fontWeight: 500 }}>
                {formatHour(h)}
              </div>
              {weekDates.map((_, di) => (
                <div key={di} style={{ borderLeft: '1px solid #1e293b30' }} />
              ))}
            </div>
          ))}

          {/* Event blocks — colored border cards */}
          {weekDates.map((date, dayIdx) => {
            const dayEvents = getEventsForDay(dayIdx).filter(e => !e.isAllDay);
            return dayEvents.map(e => {
              const startHour = e.start.getHours() + e.start.getMinutes() / 60;
              const endHour = e.end ? e.end.getHours() + e.end.getMinutes() / 60 : startHour + 2;
              const top = (startHour - 6) * 50;
              const height = Math.max((endHour - startHour) * 50, 30);
              const colWidth = `calc((100% - 50px) / 7)`;
              const left = `calc(50px + ${dayIdx} * ${colWidth} + 3px)`;
              const color = e.color || '#6b7280';

              // Derive type label
              const typeLabel = e._juceAssignment ? (e.description?.split('\n')[0]?.replace('Issue: ', '') || 'Job') :
                e.calendarName === 'Installations' ? 'Install' :
                e.calendarName === 'Service Queue' ? 'Service' :
                e.calendarName === 'Sales & Accounting' ? 'Sales' :
                e.summary?.toLowerCase().includes('install') ? 'Install' :
                e.summary?.toLowerCase().includes('service') ? 'Service' :
                '';

              // Multi-day detection
              const isMultiDay = e.end && (e.end.getDate() !== e.start.getDate() || e.end.getMonth() !== e.start.getMonth());

              return (
                <div key={`${dayIdx}-${e.id}`} onClick={() => openEvent(e)} style={{
                  position: 'absolute', top, left,
                  width: `calc(${colWidth} - 6px)`, height,
                  background: '#1a2332',
                  border: `2px solid ${color}`,
                  borderRadius: 8, padding: '6px 8px',
                  cursor: 'pointer', overflow: 'hidden', zIndex: 2,
                  display: 'flex', flexDirection: 'column', gap: 2
                }}>
                  {/* Tech color label */}
                  {height > 40 && (
                    <div style={{ color, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {e.calendarName}
                    </div>
                  )}
                  {/* Customer name */}
                  <div style={{
                    color: '#e2e8f0', fontSize: height > 60 ? 13 : 11,
                    fontWeight: 700, lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: height < 60 ? 'nowrap' : 'normal'
                  }}>
                    {e.summary}
                  </div>
                  {/* Type label */}
                  {height > 60 && typeLabel && (
                    <div style={{ color: '#94a3b8', fontSize: 10 }}>
                      {typeLabel}{isMultiDay ? ' • Multi-day' : ''}
                    </div>
                  )}
                </div>
              );
            });
          })}
        </div>
      </div>
    );
  };

  // ========== DAY VIEW (Screen 5 mockup) ==========
  const renderDayView = () => {
    const dayEvents = getEventsForDay(selectedDay);
    const allDay = dayEvents.filter(e => e.isAllDay);
    const timed = dayEvents.filter(e => !e.isAllDay).sort((a, b) => a.start - b.start);

    const timelineHours = Array.from({ length: 12 }, (_, i) => i + 7);
    const eventsByHour = {};
    timed.forEach(e => {
      const h = e.start.getHours();
      if (!eventsByHour[h]) eventsByHour[h] = [];
      eventsByHour[h].push(e);
    });

    const isUrgent = (e) => {
      const s = (e.summary || '').toLowerCase() + (e.description || '').toLowerCase();
      return s.includes('urgent') || s.includes('emergency') || s.includes('asap');
    };

    return (
      <div>
        {/* All day events */}
        {allDay.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {allDay.map(e => (
              <div key={e.id} onClick={() => openEvent(e)} style={{
                padding: '10px 14px', marginBottom: 4, borderRadius: 10, fontSize: 13,
                background: '#1e293b', borderLeft: `4px solid ${e.color}`, cursor: 'pointer', color: '#e2e8f0'
              }}>
                <span style={{ fontWeight: 600 }}>{e.summary}</span>
                <span style={{ color: '#cbd5e1', marginLeft: 8, fontSize: 11 }}>All Day · {e.calendarName}</span>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div style={{ position: 'relative' }}>
          {timelineHours.map(h => {
            const hourEvents = eventsByHour[h] || [];
            const hasEvents = hourEvents.length > 0;

            return (
              <div key={h} style={{ display: 'flex', alignItems: 'flex-start', minHeight: hasEvents ? 'auto' : 52 }}>
                {/* Time label */}
                <div style={{
                  width: 80, flexShrink: 0, paddingTop: hasEvents ? 18 : 14,
                  color: '#94a3b8', fontSize: 14, fontWeight: 500, textAlign: 'right', paddingRight: 16
                }}>
                  {h === 12 ? '12:00 PM' : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
                </div>

                {/* Dashed timeline + events */}
                <div style={{ flex: 1, borderLeft: '2px dashed #334155', paddingLeft: 0, minHeight: hasEvents ? 'auto' : 52, paddingBottom: hasEvents ? 14 : 0 }}>
                  {hourEvents.map(e => {
                    const color = e.color || '#6b7280';
                    const startTime = e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    const endTime = e.end ? e.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

                    const typeLabel = e._juceAssignment ? 'Job' :
                      e.calendarName === 'Installations' ? 'Install' :
                      e.calendarName === 'Service Queue' ? 'Service Call' :
                      e.calendarName === 'Sales & Accounting' ? 'Sales Meeting' :
                      e.summary?.toLowerCase().includes('install') ? 'Install' :
                      e.summary?.toLowerCase().includes('service') ? 'Service Call' :
                      'Event';

                    return (
                      <div key={e.id} onClick={() => openEvent(e)} style={{
                        background: '#1a2332', borderRadius: 14, padding: '16px 18px',
                        marginTop: 8, marginLeft: 14, cursor: 'pointer',
                        borderLeft: `4px solid ${color}`,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
                      }}>
                        {/* Customer name + urgent badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{e.summary}</span>
                          {isUrgent(e) && (
                            <span style={{
                              background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700,
                              padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase'
                            }}>URGENT</span>
                          )}
                        </div>
                        {/* Type + time range */}
                        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                          {typeLabel} • {startTime}{endTime ? ` – ${endTime}` : ''}
                        </div>
                        {/* Tech pill */}
                        <span style={{
                          display: 'inline-block', background: color, color: '#fff',
                          padding: '4px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600
                        }}>
                          {e.calendarName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {timed.length === 0 && !allDay.length && (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>No events this day</div>
        )}
      </div>
    );
  };

  // ========== MAIN RENDER ==========
  return (
    <div style={{ padding: '0' }}>
      <PullIndicator />

      {/* Inbox — tasks & notes */}
      {isOperator && (
        <div style={{ padding: '8px 12px 0' }}>
          <InboxBar userEmail={userEmail} onRefresh={fetchCalendarEvents} />
        </div>
      )}

      {/* Main tabs */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: '49px', background: '#0f1729', zIndex: 50
      }}>
        {(isOperator ? [
          { key: 'calendar', label: '📅 Calendar' },
          { key: 'tasks', label: '📋 Tasks 🚧' },
        ] : [
          { key: 'calendar', label: '📅 Calendar' },
          { key: 'tasks', label: '📋 My Day 🚧' },
        ]).map(t => (
          <button key={t.key} onClick={() => {
            setMainTab(t.key);
          }} style={{
            flex: 1, padding: '12px', background: 'none', border: 'none',
            color: mainTab === t.key ? '#00c8e8' : '#64748b',
            fontSize: '14px', fontWeight: mainTab === t.key ? '700' : '400', cursor: 'pointer',
            borderBottom: mainTab === t.key ? '2px solid #00c8e8' : '2px solid transparent'
          }}>{t.label}</button>
        ))}
      </div>

      {/* ===== CALENDAR TAB ===== */}
      {mainTab === 'calendar' && (
        <div style={{ padding: '12px' }}>

          {/* Unscheduled work warning */}
          {(() => {
            const unscheduled = (() => { try { return JSON.parse(localStorage.getItem('juce_things_to_do') || '[]'); } catch { return []; } })();
            if (unscheduled.length === 0) return null;
            const byTech = {};
            const unassigned = unscheduled.filter(i => !i.assignedTo);
            unscheduled.filter(i => i.assignedTo).forEach(i => { byTech[i.assignedTo] = (byTech[i.assignedTo] || 0) + 1; });
            return (
              <div style={{ background: '#1a1200', border: '1px solid #f59e0b40', borderRadius: 10, padding: '8px 12px', marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 800 }}>⚠ UNSCHEDULED</span>
                {unassigned.length > 0 && <span style={{ background: '#f59e0b20', borderRadius: 5, padding: '2px 7px', color: '#f59e0b', fontSize: 10, fontWeight: 700 }}>{unassigned.length} unassigned</span>}
                {Object.entries(byTech).map(([tech, count]) => (
                  <span key={tech} style={{ background: '#f59e0b15', borderRadius: 5, padding: '2px 7px', color: '#f59e0b', fontSize: 10, fontWeight: 700 }}>{tech}: {count}</span>
                ))}
              </div>
            );
          })()}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => window.location.href = '/work'} style={{
              flex: 2, background: 'linear-gradient(135deg, #1e3a2f, #0f2820)',
              border: '1px solid #16a34a', borderRadius: 12,
              padding: '14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
            }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#22c55e', fontSize: 14, fontWeight: 700 }}>📋 Work To Do Now</div>
                <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2, opacity: 0.7 }}>Today + past due</div>
              </div>
              <span style={{ color: '#22c55e', fontSize: 20 }}>›</span>
            </button>
            <button onClick={() => { setAdoptingOrphan(null); setShowNewJob(true); }} style={{
              flex: 1, background: '#1e2d4a', border: '1px solid #3b82f6',
              borderRadius: 12, padding: '14px 12px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4
            }}>
              <span style={{ fontSize: 22, color: '#3b82f6' }}>＋</span>
              <span style={{ color: '#3b82f6', fontSize: 11, fontWeight: 700 }}>New Job / Task</span>
            </button>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Search events, jobs, customers..."
              style={{
                width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
                color: '#e2e8f0', padding: '10px 14px', paddingRight: searchQuery ? '36px' : '14px',
                fontSize: '14px', outline: 'none', boxSizing: 'border-box'
              }} />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#cbd5e1', fontSize: '18px', cursor: 'pointer'
              }}>✕</button>
            )}
          </div>

          {/* Search results */}
          {searchResults ? (
            <div>
              {searchLoading && <div style={{ textAlign: 'center', padding: 20, color: '#cbd5e1', fontSize: 13 }}>Searching...</div>}
              {!searchLoading && searchResults.calendarEvents.length === 0 && searchResults.jobs.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 13 }}>No results for "{searchQuery}"</div>
              )}
              {searchResults.calendarEvents.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>📅 Calendar Events ({searchResults.calendarEvents.length})</div>
                  {searchResults.calendarEvents.map(e => (
                    <div key={`${e.calendarId}-${e.id}`} onClick={() => openEvent(e)} style={{
                      background: '#1e293b', borderRadius: 8, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', borderLeft: `3px solid ${e.color}`
                    }}>
                      <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{e.summary}</div>
                      <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: e.color }}>{e.calendarName}</span>
                        {e.start && <span>{e.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
                        {e.start && !e.isAllDay && <span>{e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searchResults.jobs.length > 0 && (
                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>📋 Tasks ({searchResults.jobs.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {searchResults.jobs.map(j => <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {calViewMode === 'day' ? (
                <>
                  {/* Day view header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '4px 0' }}>
                    <button onClick={() => {
                      if (selectedDay === 0) { setWeekOffset(w => w - 1); setSelectedDay(6); }
                      else setSelectedDay(d => d - 1);
                    }} style={{ background: '#1e293b', border: 'none', borderRadius: '50%', width: 38, height: 38, color: '#e2e8f0', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 700 }}>
                        {weekDates[selectedDay]?.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: 13 }}>
                        Week {Math.ceil(((weekDates[selectedDay] - new Date(weekDates[selectedDay].getFullYear(), 0, 1)) / 86400000 + 1) / 7)} of {weekDates[selectedDay]?.getFullYear()}
                      </div>
                    </div>

                    <button onClick={() => {
                      if (selectedDay === 6) { setWeekOffset(w => w + 1); setSelectedDay(0); }
                      else setSelectedDay(d => d + 1);
                    }} style={{ background: '#1e293b', border: 'none', borderRadius: '50%', width: 38, height: 38, color: '#e2e8f0', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                  </div>

                  {/* Tech filters + view toggle */}
                  {renderTechFilters()}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    {renderViewToggle()}
                  </div>
                </>
              ) : (
                <>
                  {/* Week view header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: '#1e293b', border: 'none', borderRadius: '50%', width: 34, height: 34, color: '#e2e8f0', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                      <button onClick={() => { setWeekOffset(0); setSelectedDay(today.getDay() === 0 ? 6 : today.getDay() - 1); }}
                        style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Today</button>
                      <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: '#1e293b', border: 'none', borderRadius: '50%', width: 34, height: 34, color: '#e2e8f0', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                      <span style={{ fontSize: 17, color: '#e2e8f0', fontWeight: 700, marginLeft: 8 }}>
                        {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    {renderViewToggle()}
                  </div>

                  {/* Tech filters */}
                  {renderTechFilters()}
                </>
              )}

              {calLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#cbd5e1', fontSize: 13 }}>Loading calendars...</div>
              ) : (
                calViewMode === 'week' ? renderWeekView() : renderDayView()
              )}
            </>
          )}
        </div>
      )}

      {/* ===== TASKS TAB ===== */}
      {mainTab === 'tasks' && (
        <>
          <div style={{
            margin: '10px 12px 0', padding: '10px 14px', borderRadius: 10,
            background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.12) 0 12px, rgba(26,18,0,0.9) 12px 24px)',
            border: '1px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>🚧</span>
            <div>
              <div style={{ color: '#f59e0b', fontWeight: 800, fontSize: 13 }}>Under Construction</div>
              <div style={{ color: '#fbbf24', fontSize: 11, opacity: 0.85 }}>Scheduling from tasks is still being built — use the Board to schedule for now.</div>
            </div>
          </div>
          <div style={{
            display: 'flex', gap: '0', borderBottom: '1px solid #1e293b',
            position: 'sticky', top: '94px', background: '#0f1729', zIndex: 49
          }}>
            {['today', 'tomorrow', 'week'].map(t => (
              <button key={t} onClick={() => setTaskTab(t)} style={{
                flex: 1, padding: '10px', background: 'none', border: 'none',
                color: taskTab === t ? '#00c8e8' : '#64748b',
                fontSize: '13px', fontWeight: taskTab === t ? '700' : '400', cursor: 'pointer', textTransform: 'capitalize',
                borderBottom: taskTab === t ? '2px solid #00c8e8' : '2px solid transparent'
              }}>
                {t === 'today' ? `Today (${sortedScheduled.filter(j => { const d = new Date(j.scheduled_for); return d.toDateString() === new Date().toDateString(); }).length})` : t === 'tomorrow' ? 'Tomorrow' : 'This Week'}
              </button>
            ))}
          </div>
          <div style={{ padding: '12px' }}>
            {/* New job/task button */}
            <button onClick={() => { setAdoptingOrphan(null); setShowNewJob(true); }} style={{
              width: '100%', marginBottom: 12,
              background: '#1e2d4a', border: '1px solid #3b82f6',
              borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
            }}>
              <span style={{ fontSize: 22, color: '#3b82f6' }}>＋</span>
              <span style={{ color: '#3b82f6', fontSize: 14, fontWeight: 700 }}>New Job / Task</span>
            </button>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#cbd5e1' }}>Loading...</div>
            ) : (
              <>
                {!isRestricted && orphans.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ color: '#f59e0b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>⚠️ Unmatched Calendar Events ({orphans.length})</div>
                      <button
                        onClick={handleIgnoreAllOrphans}
                        style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#cbd5e1', fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                      >Dismiss All</button>
                    </div>
                    {orphans.map(o => (
                      <div key={o.event.id} onClick={() => setShowOrphanActions(o)} style={{
                        background: '#f59e0b15', border: '1px solid #f59e0b30', borderRadius: '10px', padding: '10px 12px', marginBottom: '6px', cursor: 'pointer'
                      }}>
                        <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: '600' }}>{o.event.summary}</div>
                        <div style={{ color: '#cbd5e1', fontSize: '11px' }}>{o.calendarName} · {new Date(o.event.start?.dateTime || o.event.start?.date).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                )}

                {taskTab === 'week' ? (
                  Object.keys(dayGroups || {}).length > 0 ? (
                    Object.entries(dayGroups).map(([date, items]) => (
                      <div key={date} style={{ marginBottom: '16px' }}>
                        <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', marginBottom: '6px', textTransform: 'uppercase' }}>{date}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {items.map(j => <JobCard key={j.assignment_id || j.id} job={j} showTime onClick={() => setSelectedJobId(j.job_id || j.id)} />)}
                        </div>
                      </div>
                    ))
                  ) : <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>No jobs scheduled this week</div>
                ) : (
                  <>
                    {sortedScheduled.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                        {sortedScheduled.map(j => (
                          <div key={j.assignment_id || j.id} onClick={() => setSelectedJobId(j.job_id || j.id)} style={{
                            background: '#1a2332', borderRadius: '14px', padding: '16px 18px', cursor: 'pointer',
                            borderLeft: `4px solid ${CALENDAR_COLORS[assigneeOf(j)] || '#00c8e8'}`,
                            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ color: '#00c8e8', fontSize: '16px', fontWeight: '700' }}>
                                {j.scheduled_for ? formatTime(j.scheduled_for) : 'TBD'}
                              </span>
                              <span style={{ background: '#0f172940', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>
                                {j.job_type === 'service_call' ? '🔧 Service' : j.job_type === 'install' ? '🏗️ Install' : j.job_type || '📋'}
                              </span>
                            </div>
                            <div style={{ color: '#e2e8f0', fontSize: '17px', fontWeight: '700', marginBottom: '4px' }}>
                              {j.customer_name || 'Unknown Customer'}
                            </div>
                            {j.customer_address && (
                              <div onClick={(e) => { e.stopPropagation(); window.open(`https://maps.google.com/?q=${encodeURIComponent(j.customer_address)}`); }}
                                style={{ color: '#3b82f6', fontSize: '13px', marginBottom: '4px', textDecoration: 'underline' }}>
                                📍 {j.customer_address}
                              </div>
                            )}
                            {j.customer_phone && (
                              <div onClick={(e) => { e.stopPropagation(); window.open(`tel:${j.customer_phone}`); }}
                                style={{ color: '#22c55e', fontSize: '13px', marginBottom: '4px' }}>📞 {j.customer_phone}</div>
                            )}
                            {j.issue && (
                              <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.4', marginTop: '4px' }}>
                                {j.issue.length > 80 ? j.issue.slice(0, 80) + '...' : j.issue}
                              </div>
                            )}
                            {!isRestricted && assigneeOf(j) && (
                              <span style={{
                                display: 'inline-block', marginTop: '8px',
                                background: CALENDAR_COLORS[assigneeOf(j)] || '#475569',
                                color: '#fff', padding: '3px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600
                              }}>{assigneeOf(j)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                        {taskTab === 'today' ? 'Nothing scheduled today' : 'Nothing scheduled tomorrow'}
                      </div>
                    )}
                  </>
                )}

                {taskTab === 'today' && queueJobs.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>🆕 Needs Attention ({queueJobs.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {queueJobs.map(j => <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* FAB */}
      <button onClick={() => { setAdoptingOrphan(null); setShowNewJob(true); }} style={{
        position: 'fixed', bottom: '24px', right: '16px', zIndex: 90,
        width: '56px', height: '56px', borderRadius: '50%',
        background: '#3b82f6', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '28px', color: '#fff', boxShadow: '0 4px 15px rgba(59,130,246,0.4)'
      }}>+</button>

      {selectedJobId && (
        <JobDetail jobId={selectedJobId} onClose={() => setSelectedJobId(null)} onUpdate={mainTab === 'tasks' ? loadTaskData : fetchCalendarEvents} accessToken={accessToken} userEmail={userEmail} userRole={isOperator ? 'operator' : 'tech'} />
      )}

      {eventLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#00c8e8', fontSize: 14 }}>Matching to job...</div>
        </div>
      )}

      {/* Event preview — no matching job (fallback actions; shown only when the finish sheet is closed) */}
      {eventPreview && !showCompleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '20px' }}
          onClick={() => setEventPreview(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1e293b', borderRadius: '16px 16px 0 0', padding: '20px', width: '100%', maxWidth: 420,
            borderTop: `4px solid ${eventPreview.color}`, marginBottom: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>{eventPreview.summary}</div>
                <div style={{ color: eventPreview.color, fontSize: 12, marginTop: 2 }}>{eventPreview.calendarName}</div>
              </div>
              <button onClick={() => setEventPreview(null)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            {eventPreview.start && (
              <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                📅 {eventPreview.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                {!eventPreview.isAllDay && ` · ${eventPreview.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                {eventPreview.end && !eventPreview.isAllDay && ` – ${eventPreview.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              </div>
            )}
            {eventPreview.location && <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>📍 {eventPreview.location}</div>}
            {eventPreview.description && (
              <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 12, maxHeight: 80, overflow: 'auto', lineHeight: 1.4 }}>
                {eventPreview.description.slice(0, 300)}
              </div>
            )}
            <div style={{ background: '#0f1729', borderRadius: 10, padding: '10px 14px', marginBottom: 16, border: '1px solid #334155' }}>
              <div style={{ color: '#f59e0b', fontSize: 12, fontWeight: 600 }}>⚠️ No matching JUC-E job found</div>
              <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 4 }}>This event isn't linked to a task yet.</div>
            </div>

            {/* Make it a JUC-E job — primary action */}
            <button onClick={() => makeJuceJob(eventPreview)} style={{
              width: '100%', marginBottom: 10,
              background: 'linear-gradient(135deg, #1e3a5f, #0f2040)',
              border: '2px solid #3b82f6', borderRadius: 12,
              padding: '14px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
            }}>
              <span style={{ fontSize: 20 }}>🔗</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#3b82f6', fontSize: 14, fontWeight: 700 }}>Make This a JUC-E Job</div>
                <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>Creates job record + stamps deep link for end-of-job workflow</div>
              </div>
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {STATUS_TAGS.map(tag => (
                <button key={tag.label} onClick={() => { applyStatusTag(eventPreview, tag); setEventPreview(null); }} style={{
                  background: tag.dark, border: `1px solid ${tag.color}40`,
                  borderRadius: 10, padding: '10px 8px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span style={{ fontSize: 16 }}>{tag.emoji}</span>
                  <span style={{ color: tag.color, fontSize: 11, fontWeight: 700 }}>{tag.label}</span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => {
                setShowCompleteModal(true);
              }} style={{ flex: 1, background: '#22c55e', color: '#000', border: 'none', borderRadius: 10, padding: '14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>✅ Complete Job</button>
              <button onClick={() => {
                if (eventPreview.htmlLink) window.open(eventPreview.htmlLink, '_blank');
                setEventPreview(null);
              }} style={{ flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 10, padding: '14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Open Calendar ↗</button>
            </div>
            {isOperator && (
              <button onClick={async () => {
                try {
                  const alreadyTagged = eventPreview.summary?.startsWith('[IGNORE]');
                  const newSummary = alreadyTagged ? eventPreview.summary : `[IGNORE] ${eventPreview.summary}`;
                  await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(eventPreview.calendarId)}/events/${eventPreview.id}`,
                    {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ visibility: 'private', summary: newSummary }),
                    }
                  );
                  setEventPreview(null);
                  fetchCalendarEvents();
                } catch (err) {
                  alert('Failed: ' + err.message);
                }
              }} style={{ width: '100%', marginTop: 8, background: 'none', border: '1px solid #47556960', borderRadius: 10, padding: '10px', fontSize: 12, color: '#cbd5e1', fontWeight: 600, cursor: 'pointer' }}>
                🙈 Mark Private — Hide from JUC-E
              </button>
            )}
          </div>
        </div>
      )}

      {showCompleteModal && eventPreview && (
        <JobFinishSheet
          event={{
            id: eventPreview.id,
            title: eventPreview.summary,
            calendarId: eventPreview.calendarId,
            start: eventPreview.start,
            end: eventPreview.end,
            description: eventPreview.description || '',
            location: eventPreview.location || '',
          }}
          accessToken={accessToken}
          userEmail={userEmail}
          userName={userName}
          mode="full"
          onFinished={() => {
            setShowCompleteModal(false);
            setEventPreview(null);
            fetchCalendarEvents();
          }}
          onCancel={() => { setShowCompleteModal(false); setEventPreview(null); }}
        />
      )}

      {/* Work To Do now navigates to /work instead of showing modal */}

      {showNewJob && (
        <NewJobModal
          onClose={() => { setShowNewJob(false); setAdoptingOrphan(null); if (autoNewJob && onJobCreated) onJobCreated(); }}
          onCreated={() => { fetchCalendarEvents(); if (onJobCreated) onJobCreated(); }}
          userEmail={userEmail}
          accessToken={accessToken}
          prefill={adoptingOrphan ? {
            customerName: adoptingOrphan.event.summary?.replace(/^\[.*?\]\s*[-–—]?\s*/, '').trim() || adoptingOrphan.event.summary || '',
            address: adoptingOrphan.event.location || '',
            issue: adoptingOrphan.event.description || adoptingOrphan.event.summary || '',
            scheduleDate: adoptingOrphan.event.start?.dateTime
              ? new Date(adoptingOrphan.event.start.dateTime).toISOString().split('T')[0]
              : adoptingOrphan.event.start?.date || '',
            scheduleTime: adoptingOrphan.event.start?.dateTime
              ? new Date(adoptingOrphan.event.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
              : '',
            techName: adoptingOrphan.calendarName || '',
            calendarId: adoptingOrphan.event.calendarId || '',
            sourceEventId: adoptingOrphan.event.id || '',
            isConnect: true,
          } : null}
        />
      )}
      {showOrphanActions && <OrphanActions orphan={showOrphanActions} onClose={() => setShowOrphanActions(null)} />}
    </div>
  );
}
