import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchScheduleRange, fetchJob } from '../services/jobs';
import { fetchEvents, localDay, weekStart } from '../services/calendar';
import TicketSheet from './TicketSheet';
import SchedulerModal from './SchedulerModal';

// ============================================================================
// CalendarView — the whole schedule, one month at a time.
//
// Built on ASSIGNMENTS, not calendar events. One row per tech per day, so a
// two-tech job shows both people instead of one opaque block, and the colours
// are the tech colours from the techs table. Google events for the same range
// are shown as faint context underneath the day's jobs — that is where meetings
// and anything booked outside Overwatch lives.
//
// Six week rows, Monday-start, so the grid never reflows as you page months.
// A month that only needs five rows still gets six; a stable shape is worth more
// than a tight one when you are scanning the same position every day.
//
// Clicking a job opens the same TicketSheet as the board. There is no second
// ticket UI — that was v9's mistake and 9.11.0 spent a whole release undoing it.
// ============================================================================

const ROWS = 6;
const CELLS = ROWS * 7;

export default function CalendarView({ actor }) {
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [calNote, setCalNote] = useState(null);

  const [selected, setSelected] = useState(() => localDay(new Date()));
  const [openJob, setOpenJob] = useState(null);
  const [loadingJob, setLoadingJob] = useState(false);

  // fetchScheduleRange returns the job WITHOUT its assignments — it selects a
  // narrow set of job columns for the grid. Handing that to TicketSheet made a
  // finished job read "Nobody on it yet" and offer "Schedule this", because
  // techsOn([]) is empty. Always load the full job before opening the sheet.
  const open = async (jobId) => {
    setLoadingJob(true);
    try { setOpenJob(await fetchJob(jobId)); }
    catch (e) { setErr(e.message); }
    setLoadingJob(false);
  };
  const [schedJob, setSchedJob] = useState(null);

  // The grid starts on the Monday on or before the 1st, and always runs 42 days.
  const gridStart = useMemo(() => weekStart(monthAnchor), [monthAnchor]);

  const days = useMemo(() => {
    const out = [];
    const today = localDay(new Date());
    for (let i = 0; i < CELLS; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      out.push({
        key: localDay(d),
        dom: d.getDate(),
        inMonth: d.getMonth() === monthAnchor.getMonth(),
        isToday: localDay(d) === today,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return out;
  }, [gridStart, monthAnchor]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const from = new Date(gridStart);
    const to = new Date(gridStart);
    to.setDate(to.getDate() + CELLS);

    try {
      setRows(await fetchScheduleRange(from.toISOString(), to.toISOString()));
    } catch (e) {
      setErr(e.message);
    }

    const r = await fetchEvents({ from, to });
    setEvents(r.events);
    setCalNote(
      r.authExpired ? 'Google session expired — calendar events not shown.'
      : r.errors.length ? r.errors.join(' · ')
      : null
    );
    setLoading(false);
  }, [gridStart]);

  useEffect(() => { load(); }, [load]);

  // Group assignments and events by local day.
  const jobsByDay = useMemo(() => {
    const m = new Map();
    for (const a of rows) {
      if (!a.scheduled_for) continue;
      const k = localDay(new Date(a.scheduled_for));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return m;
  }, [rows]);

  const eventsByDay = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      if (!e.day) continue;
      if (!m.has(e.day)) m.set(e.day, []);
      m.get(e.day).push(e);
    }
    return m;
  }, [events]);

  const shiftMonth = n => setMonthAnchor(a => {
    const d = new Date(a);
    d.setMonth(d.getMonth() + n);
    return d;
  });

  const monthLabel = monthAnchor.toLocaleDateString(undefined, {
    month: 'long', year: 'numeric',
  });

  const dayJobs = jobsByDay.get(selected) || [];
  const dayEvents = eventsByDay.get(selected) || [];
  const selectedLabel = new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const hoursThisMonth = rows
    .filter(a => days.find(d => d.key === localDay(new Date(a.scheduled_for)))?.inMonth)
    .reduce((n, a) => n + (Number(a.estimated_hours) || 0), 0);

  const time = iso => new Date(iso).toLocaleTimeString(undefined,
    { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="ow-full" style={S.wrap}>
      <div style={S.head}>
        <div>
          <div style={S.month}>{monthLabel}</div>
          <div style={S.sub}>
            {loading ? 'Loading…' : `${rows.length} booked · ${hoursThisMonth}h this month`}
          </div>
        </div>
        <div style={S.nav}>
          <button style={S.navBtn} onClick={() => shiftMonth(-1)}>‹</button>
          <button style={S.navBtn} onClick={() => {
            const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
            setMonthAnchor(d);
            setSelected(localDay(new Date()));
          }}>today</button>
          <button style={S.navBtn} onClick={() => shiftMonth(1)}>›</button>
        </div>
      </div>

      {err && <div style={S.err} onClick={() => setErr(null)}>{err}</div>}
      {calNote && <div style={S.warn}>{calNote}</div>}

      <div style={S.dowRow}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={S.dowCell}>{d}</div>
        ))}
      </div>

      <div style={S.grid}>
        {days.map(d => {
          const js = jobsByDay.get(d.key) || [];
          const evs = eventsByDay.get(d.key) || [];
          const isSel = d.key === selected;
          return (
            <button
              key={d.key}
              onClick={() => setSelected(d.key)}
              style={{
                ...S.cell,
                ...(d.inMonth ? {} : S.cellOut),
                ...(d.isWeekend ? S.cellWeekend : {}),
                ...(d.isToday ? S.cellToday : {}),
                ...(isSel ? S.cellSel : {}),
              }}
            >
              <div style={S.cellTop}>
                <span style={{ ...S.dom, ...(d.isToday ? S.domToday : {}) }}>{d.dom}</span>
                {js.length > 2 && <span style={S.count}>{js.length}</span>}
              </div>

              {js.slice(0, 2).map(a => (
                <div key={a.id} style={S.pill}>
                  <span style={{ ...S.pillDot, background: a.tech?.color || '#64748b' }} />
                  <span style={S.pillText}>
                    {/* Tech first: a 3-tech job otherwise renders as three
                        identical customer names and reads like 3 jobs. */}
                    {a.tech?.name ? `${a.tech.name.split(' ')[0]} · ` : ''}
                    {a.job?.customer?.name || 'No customer'}
                  </span>
                </div>
              ))}
              {js.length > 2 && <div style={S.more}>+{js.length - 2} more</div>}

              {js.length === 0 && evs.length > 0 && (
                <div style={S.evOnly}>{evs.length} cal</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Selected day ─────────────────────────────────────────────────── */}
      <div style={S.dayHead}>{selectedLabel}</div>

      {dayJobs.length === 0 && dayEvents.length === 0 && (
        <div style={S.empty}>Nothing booked and nothing on the calendar.</div>
      )}

      {dayJobs.length > 0 && (
        <div style={S.dayList}>
          {dayJobs.map(a => {
            const j = a.job || {};
            const c = j.customer || {};
            return (
              <button key={a.id} style={S.dayRow} onClick={() => open(j.id)}>
                <span style={S.rowTime}>
                  {a.scheduled_for ? time(a.scheduled_for) : '—'}
                </span>
                <span style={{ ...S.rowDot, background: a.tech?.color || '#64748b' }} />
                <span style={S.rowMain}>
                  <span style={S.rowCust}>{c.name || 'No customer'}</span>
                  {j.issue && <span style={S.rowIssue}>{j.issue}</span>}
                </span>
                <span style={S.rowRight}>
                  <span style={S.rowTech}>{a.tech?.name || 'Unassigned'}</span>
                  {a.estimated_hours != null && (
                    <span style={S.rowHrs}>{a.estimated_hours}h</span>
                  )}
                  {a.is_complete && <span style={S.rowDone}>done</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {dayEvents.length > 0 && (
        <>
          <div style={S.evHead}>Also on the calendar</div>
          <div style={S.evList}>
            {dayEvents.map(e => (
              <div key={e.id} style={S.ev}>
                <span style={S.evTime}>
                  {e.allDay ? 'all day' : time(e.start)}
                </span>
                <span style={S.evTitle}>{e.title}</span>
                <span style={S.evCal}>{e.calendarName}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {loadingJob && <div style={S.loading}>Loading…</div>}

      {openJob && (
        <TicketSheet
          job={openJob}
          actor={actor}
          onClose={() => setOpenJob(null)}
          onChanged={() => { load(); open(openJob.id); }}
          onSchedule={j => { setOpenJob(null); setSchedJob(j); }}
        />
      )}

      {schedJob && (
        <SchedulerModal
          job={schedJob}
          actor={actor}
          onClose={() => setSchedJob(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 16, background: '#0b1220' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, flexWrap: 'wrap' },
  month: { color: '#f1f5f9', fontSize: 20, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 12, marginTop: 3 },
  nav: { display: 'flex', gap: 5 },
  navBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
            padding: '6px 12px', fontSize: 13, cursor: 'pointer' },

  err: { background: '#7f1d1d', color: '#fecaca', padding: '9px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13, cursor: 'pointer' },
  warn: { background: '#78350f', color: '#fed7aa', padding: '8px 12px', borderRadius: 8,
          marginTop: 12, fontSize: 12 },

  dowRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4,
            marginTop: 16, marginBottom: 5 },
  dowCell: { color: '#475569', fontSize: 10, textTransform: 'uppercase',
             letterSpacing: .5, textAlign: 'center' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  cell: { background: '#111c2e', border: '1px solid #1e293b', borderRadius: 8,
          padding: 5, minHeight: 78, display: 'flex', flexDirection: 'column',
          gap: 2, cursor: 'pointer', textAlign: 'left', overflow: 'hidden' },
  cellOut: { background: '#0d1520', opacity: .5 },
  cellWeekend: { background: '#0f1826' },
  cellToday: { borderColor: '#475569' },
  cellSel: { borderColor: '#3b82f6', background: '#132038' },
  cellTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  dom: { color: '#cbd5e1', fontSize: 12, fontWeight: 700 },
  domToday: { color: '#14b8a6' },
  count: { color: '#64748b', fontSize: 9 },

  pill: { display: 'flex', alignItems: 'center', gap: 3, background: '#1e3a5f',
          borderRadius: 4, padding: '2px 4px' },
  pillDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  pillText: { color: '#bfdbfe', fontSize: 9, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis' },
  more: { color: '#64748b', fontSize: 9 },
  evOnly: { color: '#334155', fontSize: 9 },

  dayHead: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, marginTop: 22,
             marginBottom: 9 },
  empty: { color: '#475569', fontSize: 12 },

  dayList: { display: 'flex', flexDirection: 'column', gap: 5 },
  dayRow: { display: 'flex', alignItems: 'center', gap: 9, background: '#111c2e',
            border: '1px solid #1e293b', borderRadius: 8, padding: '9px 11px',
            cursor: 'pointer', textAlign: 'left', width: '100%' },
  rowTime: { color: '#f1f5f9', fontSize: 12, fontWeight: 700, minWidth: 62,
             flexShrink: 0 },
  rowDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  rowMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  rowCust: { color: '#e2e8f0', fontSize: 13, fontWeight: 600 },
  rowIssue: { color: '#64748b', fontSize: 11, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis' },
  rowRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  rowTech: { color: '#94a3b8', fontSize: 11 },
  rowHrs: { color: '#64748b', fontSize: 11 },
  rowDone: { color: '#14b8a6', fontSize: 10, fontWeight: 700 },

  evHead: { color: '#64748b', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: .5, marginTop: 18, marginBottom: 7 },
  evList: { display: 'flex', flexDirection: 'column', gap: 3 },
  ev: { display: 'flex', gap: 9, alignItems: 'baseline', background: '#0f1929',
        borderRadius: 6, padding: '6px 10px' },
  evTime: { color: '#64748b', fontSize: 10, minWidth: 56, flexShrink: 0 },
  evTitle: { color: '#94a3b8', fontSize: 12, flex: 1 },
  evCal: { color: '#475569', fontSize: 9 },
  loading: { color: '#94a3b8', fontSize: 12, marginTop: 10 },
};
