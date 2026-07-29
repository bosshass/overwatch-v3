import { useState, useEffect, useCallback } from 'react';
import { book } from '../services/jobs';
import { supabase } from '../services/supabaseClient';
import { calendarForBooking, CALENDARS } from '../config/calendars';
import { fetchEvents, byDay, dayRange, weekStart } from '../services/calendar';

// ============================================================================
// SchedulerModal — the ONLY route into the Scheduled lane.
//
// v9 had five schedulers (VisualScheduler, QuickSchedule, DayScheduler,
// TentativeScheduler, ReturnScheduler). 9.11.0 collapsed them to one. v3 ships
// with one and never grows a second.
//
// 3.0.2: it shows an actual calendar. Before this it was a bare date input, so
// you picked a day with no idea who was already out. Two weeks of real Google
// events; click a day to select it.
//
// Multi-tech is the default shape here, not a special mode. You pick people,
// plural. One person is just the common case of that.
//
// Hours default to the job's estimated_hours — never a silent 4h. In v9
// estimated_hours was null on all 400 jobs and the scheduler assumed 4h for
// every single one, which is why booked capacity never matched reality.
//
// If the calendar read fails we say so loudly. An empty grid reads as "nobody
// is booked", and that is the one wrong answer that causes a double-booking.
// ============================================================================

const DAYS_SHOWN = 14;

const CAL_LABEL = {
  [CALENDARS.TECH_SCHEDULED]: 'Tech calendar',
  [CALENDARS.MULTI_TECH]: 'Multi-tech calendar',
};

export default function SchedulerModal({ job, actor, onClose, onBooked }) {
  const [techs, setTechs] = useState([]);
  const [picked, setPicked] = useState({});     // { tech_id: { hours, day } }
  const [date, setDate] = useState(job.scheduled_date || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Calendar state
  const [anchor, setAnchor] = useState(
    () => weekStart(job.scheduled_date ? new Date(job.scheduled_date) : new Date())
  );
  const [events, setEvents] = useState([]);
  const [calLoading, setCalLoading] = useState(true);
  const [calError, setCalError] = useState(null);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    supabase.from('techs').select('*').eq('is_active', true)
      .order('display_order')
      .then(({ data }) => setTechs(data || []));
  }, []);

  // Pre-select whoever is already on it, so Reschedule isn't a blank slate.
  useEffect(() => {
    const pre = {};
    for (const a of job.assignments || []) {
      if (a.tech_id) pre[a.tech_id] = {
        hours: a.estimated_hours ?? job.estimated_hours ?? 2,
        day: a.day_number || 1,
      };
    }
    setPicked(pre);
  }, [job]);

  // ── Load the visible window from Google ──────────────────────────────────
  const loadCal = useCallback(async () => {
    setCalLoading(true);
    setCalError(null);
    setAuthExpired(false);

    const from = new Date(anchor);
    const to = new Date(anchor);
    to.setDate(to.getDate() + DAYS_SHOWN);

    const { events: evs, authExpired: dead, errors } = await fetchEvents({ from, to });
    setEvents(evs);
    setAuthExpired(dead);
    if (errors.length) setCalError(errors.join(' · '));
    setCalLoading(false);
  }, [anchor]);

  useEffect(() => { loadCal(); }, [loadCal]);

  const days = dayRange(anchor, DAYS_SHOWN);
  const grouped = byDay(events);

  const shiftWeeks = n => setAnchor(a => {
    const x = new Date(a);
    x.setDate(x.getDate() + n * 7);
    return x;
  });

  // ── Tech picking ─────────────────────────────────────────────────────────
  const toggle = t => setPicked(p => {
    const next = { ...p };
    if (next[t.id]) delete next[t.id];
    else next[t.id] = { hours: job.estimated_hours ?? 2, day: 1 };
    return next;
  });

  const setField = (id, k, v) =>
    setPicked(p => ({ ...p, [id]: { ...p[id], [k]: v } }));

  const chosen = Object.keys(picked);
  const totalHours = chosen.reduce((s, id) => s + (Number(picked[id].hours) || 0), 0);
  const dayCount = new Set(chosen.map(id => picked[id].day || 1));
  const destination = CAL_LABEL[calendarForBooking(chosen.length)] || 'calendar';

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await book(job, {
      techs: chosen.map(id => ({
        id,
        hours: Number(picked[id].hours) || null,
        day: Number(picked[id].day) || 1,
      })),
      date,
      actor,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    onBooked?.();
    onClose?.();
  };

  const rangeLabel = () => {
    const end = new Date(anchor);
    end.setDate(end.getDate() + DAYS_SHOWN - 1);
    const f = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${f(anchor)} – ${f(end)}`;
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.title}>Schedule</div>
            <div style={S.sub}>{job.customer?.name || job.customer_name}</div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {/* ── Calendar ─────────────────────────────────────────────────── */}
        <div style={S.calHead}>
          <span style={S.labelInline}>What&apos;s already booked</span>
          <div style={S.nav}>
            <button style={S.navBtn} onClick={() => shiftWeeks(-1)}>‹</button>
            <span style={S.range}>{rangeLabel()}</span>
            <button style={S.navBtn} onClick={() => shiftWeeks(1)}>›</button>
            <button style={S.navBtn} onClick={() => setAnchor(weekStart(new Date()))}>today</button>
          </div>
        </div>

        {authExpired && (
          <div style={S.warn}>
            Google session expired — the grid below is NOT showing real
            bookings. Reconnect before you schedule anything.
          </div>
        )}
        {calError && <div style={S.warn}>Calendar read problem — {calError}</div>}

        <div style={S.grid}>
          {days.map(d => {
            const list = grouped.get(d.key) || [];
            const selected = date === d.key;
            return (
              <button
                key={d.key}
                onClick={() => setDate(d.key)}
                style={{
                  ...S.day,
                  ...(d.isWeekend ? S.dayWeekend : {}),
                  ...(d.isToday ? S.dayToday : {}),
                  ...(selected ? S.daySelected : {}),
                }}
              >
                <div style={S.dayTop}>
                  <span style={S.dow}>{d.dow}</span>
                  <span style={S.dom}>{d.dom}</span>
                </div>

                {calLoading
                  ? <div style={S.dim}>…</div>
                  : list.length === 0
                    ? <div style={S.free}>free</div>
                    : list.slice(0, 3).map(e => (
                        <div
                          key={e.id}
                          title={`${e.title} — ${e.calendarName}`}
                          style={{ ...S.chip, ...(e.isHold ? S.chipHold : {}) }}
                        >
                          {e.title}
                        </div>
                      ))}

                {!calLoading && list.length > 3 && (
                  <div style={S.more}>+{list.length - 3} more</div>
                )}
              </button>
            );
          })}
        </div>

        <div style={S.legend}>
          Reading Tech, Multi-tech and Internal calendars. Orange = tentative
          hold. Internal time is included on purpose — it occupies the person
          even though it never bills.
        </div>

        <label style={S.label}>Date</label>
        <input type="date" style={S.input} value={date}
               onChange={e => setDate(e.target.value)} />

        <label style={S.label}>Who&apos;s going ({chosen.length})</label>
        <div style={S.techs}>
          {techs.map(t => {
            const on = Boolean(picked[t.id]);
            return (
              <div key={t.id} style={{ ...S.techCard, ...(on ? S.techCardOn : {}) }}>
                <button style={S.techBtn} onClick={() => toggle(t)}>
                  <span style={{ ...S.dot, background: t.color || '#64748b' }} />
                  <span style={S.techName}>{t.name}</span>
                  <span style={S.check}>{on ? '✓' : ''}</span>
                </button>

                {on && (
                  <div style={S.techFields}>
                    <span style={S.mini}>hrs</span>
                    <input type="number" step="0.5" min="0" style={S.miniInput}
                           value={picked[t.id].hours ?? ''}
                           onChange={e => setField(t.id, 'hours', e.target.value)} />
                    <span style={S.mini}>day</span>
                    <input type="number" min="1" style={S.miniInput}
                           value={picked[t.id].day ?? 1}
                           onChange={e => setField(t.id, 'day', e.target.value)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {chosen.length > 0 && (
          <div style={S.summary}>
            {chosen.length} tech{chosen.length > 1 ? 's' : ''} · {totalHours}h total
            {dayCount.size > 1 && ` · ${dayCount.size} days`}
            <div style={S.cal}>→ {destination}</div>
          </div>
        )}

        <button
          style={{ ...S.book, ...(!chosen.length || !date ? S.bookOff : {}) }}
          disabled={!chosen.length || !date || busy}
          onClick={submit}
        >
          {busy ? 'Booking…'
            : !date ? 'Pick a date'
            : !chosen.length ? 'Pick at least one tech'
            : `Book ${chosen.length} tech${chosen.length > 1 ? 's' : ''}`}
        </button>

        <div style={S.note}>
          Booking is the only way into Scheduled. The grid above is read-only —
          nothing writes to Google yet. Assignments are recorded in the
          database only.
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 60, padding: 16 },
  modal: { background: '#111c2e', borderRadius: 14, padding: 18,
           width: 'min(680px, 100%)', maxHeight: '90vh', overflowY: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  warn: { background: '#78350f', color: '#fed7aa', padding: '8px 12px', borderRadius: 8,
          marginTop: 10, fontSize: 12, lineHeight: 1.4 },

  calHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
             marginTop: 18, marginBottom: 8, gap: 10, flexWrap: 'wrap' },
  labelInline: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5 },
  nav: { display: 'flex', alignItems: 'center', gap: 6 },
  navBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
            padding: '3px 9px', fontSize: 12, cursor: 'pointer' },
  range: { color: '#94a3b8', fontSize: 12, minWidth: 108, textAlign: 'center' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  day: { background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8,
         padding: 6, minHeight: 74, display: 'flex', flexDirection: 'column',
         gap: 3, cursor: 'pointer', textAlign: 'left', overflow: 'hidden' },
  dayWeekend: { background: '#0a0f1a' },
  dayToday: { borderColor: '#475569' },
  daySelected: { borderColor: '#3b82f6', background: '#132038' },
  dayTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  dow: { color: '#475569', fontSize: 9, textTransform: 'uppercase' },
  dom: { color: '#cbd5e1', fontSize: 13, fontWeight: 700 },
  chip: { background: '#1e3a5f', color: '#bfdbfe', fontSize: 9, borderRadius: 4,
          padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis' },
  chipHold: { background: '#78350f', color: '#fed7aa' },
  free: { color: '#334155', fontSize: 9 },
  dim: { color: '#334155', fontSize: 11 },
  more: { color: '#64748b', fontSize: 9 },
  legend: { color: '#475569', fontSize: 10, marginTop: 8, lineHeight: 1.45 },

  label: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
           display: 'block', marginTop: 18, marginBottom: 6 },
  input: { width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
           borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  techs: { display: 'flex', flexDirection: 'column', gap: 6 },
  techCard: { background: '#0b1220', borderRadius: 8, border: '1px solid #1e293b' },
  techCardOn: { borderColor: '#3b82f6' },
  techBtn: { width: '100%', display: 'flex', alignItems: 'center', gap: 9,
             background: 'transparent', border: 0, padding: '10px 12px', cursor: 'pointer' },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  techName: { color: '#e2e8f0', fontSize: 14, flex: 1, textAlign: 'left' },
  check: { color: '#3b82f6', fontWeight: 800 },
  techFields: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 10px' },
  mini: { color: '#64748b', fontSize: 11 },
  miniInput: { width: 58, background: '#111c2e', color: '#e2e8f0', border: '1px solid #1e293b',
               borderRadius: 6, padding: '4px 7px', fontSize: 13 },
  summary: { marginTop: 14, color: '#94a3b8', fontSize: 13, background: '#0b1220',
             padding: '10px 12px', borderRadius: 8 },
  cal: { color: '#64748b', fontSize: 11, marginTop: 3 },
  book: { width: '100%', marginTop: 16, background: '#3b82f6', color: '#fff', border: 0,
          borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  bookOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
  note: { color: '#475569', fontSize: 11, marginTop: 12, lineHeight: 1.4 },
};
