import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchMyHours, fetchJobHours, saveHours } from '../services/jobs';
import { localDay } from '../services/calendar';

// ============================================================================
// MyHours — the week's hours, entered in one pass.
//
// Its own screen because hours are batch work. Friday at six, for Monday
// through Friday. The finish sheet asks one question at the job; this asks the
// rest of them later, when the tech is sitting down and can actually remember.
//
// GROUPED BY THE DAY THE WORK HAPPENED, never the day it was typed. Those are
// different dates and the difference is the whole point of the screen — see
// saveHours in jobs.js.
//
// Blanks are FLAGGED, NOT BLOCKED. A tech who genuinely does not remember
// Tuesday should be able to file Monday, Wednesday and Thursday and come back.
// Refusing the save would mean four missing days instead of one.
// ============================================================================

// Monday-start week containing d.
function weekOf(d, offsetWeeks = 0) {
  const base = new Date(d);
  base.setHours(0, 0, 0, 0);
  const dow = (base.getDay() + 6) % 7;              // Mon=0 … Sun=6
  const mon = new Date(base);
  mon.setDate(base.getDate() - dow + offsetWeeks * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { from: mon, to: sun };
}

const RANGES = [
  { key: 'this', label: 'This week' },
  { key: 'last', label: 'Last week' },
  { key: 'custom', label: 'Custom' },
];

// Two modes, one screen.
//   tech + week  the tech filing their own hours
//   job          the office filling a gap on one card from Office Review
// Same rows, same save path, same two-date discipline. A second screen for the
// office would be a second thing to keep correct.
export default function MyHours({ tech, job, actor, onClose, onSaved }) {
  const jobMode = !!job;
  const [range, setRange] = useState('this');
  const [customFrom, setCustomFrom] = useState(() => localDay(weekOf(new Date(), -1).from));
  const [customTo, setCustomTo] = useState(() => localDay(new Date()));

  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});            // assignmentId → string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const window_ = useMemo(() => {
    if (range === 'this') return weekOf(new Date(), 0);
    if (range === 'last') return weekOf(new Date(), -1);
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59`);
    return { from, to };
  }, [range, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!jobMode && !tech?.id) return;
    setLoading(true); setErr(null); setMsg(null);
    try {
      const data = jobMode
        ? await fetchJobHours(job.id)
        : await fetchMyHours(
            tech.id, window_.from.toISOString(), window_.to.toISOString()
          );
      setRows(data);
      // Seed the boxes with what is already filed so an edit starts from the
      // real number rather than an empty box that looks like nothing was ever
      // entered.
      const seed = {};
      for (const r of data) if (r.hours != null) seed[r.assignmentId] = String(r.hours);
      setDraft(seed);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [tech, job, jobMode, window_]);

  useEffect(() => { load(); }, [load]);

  // Group by the work date.
  const days = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = localDay(new Date(r.workDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const totals = useMemo(() => {
    let entered = 0, blanks = 0;
    for (const r of rows) {
      const v = draft[r.assignmentId];
      if (v === undefined || String(v).trim() === '') blanks++;
      else entered += Number(v) || 0;
    }
    return { entered, blanks };
  }, [rows, draft]);

  const dirty = useMemo(
    () => rows.some(r => {
      const now = String(draft[r.assignmentId] ?? '').trim();
      const was = r.hours == null ? '' : String(r.hours);
      return !r.locked && now !== was;
    }),
    [rows, draft]
  );

  const save = async () => {
    setSaving(true); setErr(null); setMsg(null);
    const payload = rows.map(r => ({ ...r, hours: draft[r.assignmentId] ?? '' }));
    const res = await saveHours(payload, {
      actor,
      techName: tech?.name,
      techEmail: tech?.email,
    });
    setSaving(false);

    if (!res.ok) {
      setErr(
        res.failed.map(f => {
          const row = rows.find(r => r.assignmentId === f.assignmentId);
          return `${row?.customer || 'A job'}: ${f.reason}`;
        }).join(' · ')
      );
    }
    if (res.saved) {
      setMsg(
        `Saved ${res.saved} ${res.saved === 1 ? 'entry' : 'entries'}`
        + (totals.blanks ? ` · ${totals.blanks} still blank` : '')
      );
      await load();
      onSaved?.();
    } else if (res.ok) {
      setMsg('Nothing to save');
    }
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        <div style={S.head}>
          <div>
            <div style={S.title}>{jobMode ? 'Enter hours' : 'My Hours'}</div>
            <div style={S.sub}>
              {jobMode
                ? (job.customer?.name || job.customer_name || 'This job')
                : <>
                    {tech?.name || 'No tech'} ·{' '}
                    {window_.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' – '}
                    {window_.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </>}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {!jobMode && <div style={S.ranges}>
          {RANGES.map(r => (
            <button
              key={r.key}
              style={{ ...S.range, ...(range === r.key ? S.rangeOn : {}) }}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>}

        {!jobMode && range === 'custom' && (
          <div style={S.customRow}>
            <input type="date" style={S.date}
                   value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span style={S.toWord}>to</span>
            <input type="date" style={S.date}
                   value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}

        {err && <div style={S.err}>{err}</div>}
        {msg && <div style={S.ok}>{msg}</div>}

        <div style={S.body}>
          {loading ? (
            <div style={S.msg}>Loading…</div>
          ) : days.length === 0 ? (
            <div style={S.empty}>
              {jobMode ? 'No trips on this job yet.' : 'Nothing scheduled in this window.'}
              <div style={S.emptyHint}>
                Hours attach to a booked visit. If work happened without one,
                it needs to be scheduled before it can be billed.
              </div>
            </div>
          ) : (
            days.map(([dayKey, list]) => {
              const d = new Date(`${dayKey}T00:00:00`);
              const dayTotal = list.reduce(
                (n, r) => n + (Number(draft[r.assignmentId]) || 0), 0
              );
              return (
                <div key={dayKey} style={S.dayBlock}>
                  <div style={S.dayHead}>
                    <span>
                      {d.toLocaleDateString(undefined,
                        { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {dayTotal > 0 && <span style={S.dayTotal}>{dayTotal}h</span>}
                  </div>

                  {list.map(r => {
                    const val = draft[r.assignmentId] ?? '';
                    const blank = String(val).trim() === '';
                    return (
                      <div key={r.assignmentId} style={S.row}>
                        <div style={S.rowText}>
                          <div style={S.cust}>
                            {jobMode ? (r.techName || 'Unassigned') : r.customer}
                          </div>
                          <div style={S.meta}>
                            {r.booked ? `${r.booked}h booked` : 'no estimate'}
                            {!r.isComplete && ' · not closed out'}
                            {r.locked && ' · billed'}
                            {r.enteredBy && r.enteredBy !== actor
                              && ` · entered by ${r.enteredBy}`}
                          </div>
                        </div>

                        {r.locked ? (
                          <span style={S.lockedVal}>{r.hours}h</span>
                        ) : (
                          <input
                            type="number" step="0.25" min="0" max="24"
                            inputMode="decimal"
                            placeholder="—"
                            style={{ ...S.input, ...(blank ? S.inputBlank : {}) }}
                            value={val}
                            onChange={e => setDraft(
                              p => ({ ...p, [r.assignmentId]: e.target.value })
                            )}
                          />
                        )}
                        <span style={S.hrs}>{r.locked ? '' : 'hrs'}</span>
                        {blank && !r.locked && <span style={S.warn}>⚠</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div style={S.foot}>
          <div style={S.footSum}>
            {totals.entered}h entered
            {totals.blanks > 0 && (
              <span style={S.footBlank}>
                {' · '}{totals.blanks} blank
              </span>
            )}
          </div>
          <button
            style={{ ...S.save, ...(dirty && !saving ? {} : S.saveOff) }}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save all'}
          </button>
        </div>

        <div style={S.note}>
          {jobMode
            ? `Saved as the technician's hours, stamped as entered by you.`
            : 'Blanks are fine — save what you know and come back for the rest.'}
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,16,.72)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              zIndex: 60 },
  sheet: { background: '#0f1a2b', width: '100%', maxWidth: 560, maxHeight: '92vh',
           borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
           border: '1px solid #1e293b', borderBottom: 0 },

  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '18px 18px 12px' },
  title: { color: '#f1f5f9', fontSize: 19, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 12, marginTop: 3 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18,
       cursor: 'pointer', padding: 4 },

  ranges: { display: 'flex', gap: 6, padding: '0 18px 12px' },
  range: { background: '#111c2e', color: '#94a3b8', border: '1px solid #1e293b',
           borderRadius: 7, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' },
  rangeOn: { background: '#1e293b', color: '#f1f5f9', borderColor: '#334155' },

  customRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px 12px' },
  date: { background: '#0f1b2e', color: '#e2e8f0', border: '1px solid #1e293b',
          borderRadius: 7, padding: '6px 8px', fontSize: 12.5 },
  toWord: { color: '#64748b', fontSize: 12 },

  err: { background: '#7f1d1d', color: '#fecaca', fontSize: 12.5,
         padding: '8px 18px' },
  ok: { background: '#064e3b', color: '#a7f3d0', fontSize: 12.5,
        padding: '8px 18px' },

  body: { overflowY: 'auto', padding: '0 18px', flex: 1 },
  msg: { color: '#64748b', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  empty: { color: '#94a3b8', fontSize: 13.5, padding: '28px 0', textAlign: 'center' },
  emptyHint: { color: '#64748b', fontSize: 12, marginTop: 8, lineHeight: 1.5 },

  dayBlock: { marginBottom: 16 },
  dayHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
             color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: .3,
             textTransform: 'uppercase', padding: '10px 0 6px',
             borderBottom: '1px solid #1e293b' },
  dayTotal: { color: '#14b8a6', fontSize: 12, fontWeight: 700,
              textTransform: 'none', letterSpacing: 0 },

  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0',
         borderBottom: '1px solid #131f33' },
  rowText: { flex: 1, minWidth: 0 },
  cust: { color: '#e2e8f0', fontSize: 14, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { color: '#64748b', fontSize: 11.5, marginTop: 2 },

  input: { width: 72, background: '#0f1b2e', color: '#e2e8f0',
           border: '1px solid #1e293b', borderRadius: 7,
           padding: '8px 10px', fontSize: 15, textAlign: 'right' },
  inputBlank: { borderColor: '#78350f' },
  lockedVal: { color: '#64748b', fontSize: 14, width: 72, textAlign: 'right' },
  hrs: { color: '#475569', fontSize: 11.5, width: 22 },
  warn: { color: '#f59e0b', fontSize: 13 },

  foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '14px 18px 8px', borderTop: '1px solid #1e293b' },
  footSum: { color: '#94a3b8', fontSize: 13 },
  footBlank: { color: '#f59e0b' },
  save: { background: '#14b8a6', color: '#03201c', border: 0, borderRadius: 8,
          padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' },
  saveOff: { background: '#1e293b', color: '#475569', cursor: 'default' },

  note: { color: '#475569', fontSize: 11.5, padding: '0 18px 18px',
          textAlign: 'center' },
};
