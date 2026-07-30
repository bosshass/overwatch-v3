import { useEffect, useState, useMemo } from 'react';
import { LANES, laneOf, hasHold } from '../utils/lanes';
import { isUnowned } from '../utils/ownership';
import { fetchBoard } from '../services/jobs';

// ============================================================================
// CommandCenter — what you land on. Replaces OpsHome.
//
// Rules it follows:
//   - Every number is a link. A count you cannot click is a number that rots.
//   - Counts come from laneOf(), the same function the board uses, so the
//     landing page and the board can never disagree. In v9 they did, because
//     Home counted with its own logic.
//   - No blame-coded language next to a person's name (9.11.11). "Nobody on it"
//     describes the job, not the human.
//
// 3.5.1 adds aging. This is the "estimate sat five days and nobody looked"
// problem, and it is deliberately measured from created_at — the age of the
// work, not the last time someone touched the row. Last-touch would need a
// join on job_history and would read as fresh every time someone opened the
// ticket and changed nothing. Age is the number that embarrasses correctly.
// ============================================================================

const DAY = 86400000;
const ageDays = j => (j.created_at ? Math.floor((Date.now() - new Date(j.created_at)) / DAY) : 0);

function Tile({ label, count, color, sub, onClick, urgent }) {
  return (
    <button onClick={onClick} style={{ ...S.tile, borderLeftColor: color }}>
      <div style={{ ...S.tileCount, color: urgent && count > 0 ? '#f87171' : '#f1f5f9' }}>
        {count}
      </div>
      <div style={S.tileLabel}>{label}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </button>
  );
}

export default function CommandCenter({ email, onNavigate }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetchBoard()
      .then(setJobs)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const byLane = Object.fromEntries(LANES.map(l => [l.key, 0]));
    let unowned = 0, held = 0;

    for (const j of jobs) {
      const k = laneOf(j, { hasTimeEntry: j.hasTimeEntry });
      if (k && byLane[k] !== undefined) byLane[k]++;
      if (isUnowned(j.assignments)) unowned++;
      if (hasHold(j)) held++;
    }
    // Aging looks only at work that is genuinely waiting on a person. A booked
    // job with a date next month is not stale, it is scheduled.
    const waiting = jobs.filter(j => {
      const k = laneOf(j, { hasTimeEntry: j.hasTimeEntry });
      return k !== 'scheduled';
    });
    const aged = waiting
      .map(j => ({ job: j, days: ageDays(j) }))
      .filter(x => x.days >= 7)
      .sort((a, b) => b.days - a.days);

    return {
      byLane, unowned, held, total: jobs.length,
      aged,
      over7: aged.length,
      over14: aged.filter(x => x.days >= 14).length,
      over30: aged.filter(x => x.days >= 30).length,
    };
  }, [jobs]);

  if (loading) return <div style={S.msg}>Loading…</div>;

  return (
    <div className="ow-full" style={S.wrap}>
      <div style={S.head}>
        <h1 style={S.h1}>Command Center</h1>
        <span style={S.who}>{email}</span>
      </div>

      {err && <div style={S.err}>{err}</div>}

      <div style={S.grid}>
        {LANES.map(l => (
          <Tile
            key={l.key}
            label={l.label}
            count={stats.byLane[l.key]}
            color={l.color}
            sub={l.means}
            urgent={l.key === 'needs_action'}
            onClick={() => onNavigate(`/board#${l.key}`)}
          />
        ))}
      </div>

      <div style={S.rowHead}>Worth a look</div>
      <div style={S.grid}>
        <Tile
          label="Nobody on it"
          count={stats.unowned}
          color="#f87171"
          sub="No tech assigned yet"
          urgent
          onClick={() => onNavigate('/board')}
        />
        <Tile
          label="On hold"
          count={stats.held}
          color="#d97706"
          sub="Tentative date, not booked"
          onClick={() => onNavigate('/board')}
        />
        <Tile
          label="All open work"
          count={stats.total}
          color="#64748b"
          sub="Everything not closed"
          onClick={() => onNavigate('/board')}
        />
      </div>

      {stats.over7 > 0 && (
        <>
          <div style={S.rowHead}>Sitting too long</div>
          <div style={S.grid}>
            <Tile label="7+ days" count={stats.over7} color="#d97706"
                  sub="Open, not scheduled" onClick={() => onNavigate('/board')} />
            <Tile label="14+ days" count={stats.over14} color="#ea580c"
                  sub="Two weeks waiting" urgent onClick={() => onNavigate('/board')} />
            <Tile label="30+ days" count={stats.over30} color="#dc2626"
                  sub="A month waiting" urgent onClick={() => onNavigate('/board')} />
          </div>

          <div style={S.oldest}>
            {stats.aged.slice(0, 6).map(({ job, days }) => (
              <button key={job.id} style={S.oldRow} onClick={() => onNavigate('/board')}>
                <span style={S.oldDays}>{days}d</span>
                <span style={S.oldName}>
                  {job.customer?.name || job.customer_name || 'No customer'}
                </span>
                <span style={S.oldIssue}>
                  {job.issue ? String(job.issue).slice(0, 60) : 'no description'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {stats.total === 0 && (
        <div style={S.empty}>
          Nothing on the board yet. The seeded test jobs live in Needs action —
          they have no priority or estimated hours, so the entry gate is holding
          them out of Open. That is the gate working, not a bug.
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 20, background: '#0b1220' },
  msg: { padding: 32, color: '#94a3b8' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 18, flexWrap: 'wrap', gap: 8 },
  h1: { color: '#f1f5f9', fontSize: 22, margin: 0, fontWeight: 700 },
  who: { color: '#64748b', fontSize: 12 },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '10px 14px',
         borderRadius: 8, marginBottom: 14, fontSize: 14 },
  grid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          marginBottom: 22 },
  rowHead: { color: '#64748b', fontSize: 12, textTransform: 'uppercase',
             letterSpacing: 0.6, marginBottom: 8 },
  tile: { background: '#111c2e', border: 0, borderLeft: '3px solid', borderRadius: 10,
          padding: '14px 14px', textAlign: 'left', cursor: 'pointer' },
  tileCount: { fontSize: 26, fontWeight: 800, lineHeight: 1 },
  tileLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: 600, marginTop: 6 },
  tileSub: { color: '#64748b', fontSize: 11, marginTop: 3, lineHeight: 1.3 },
  oldest: { marginBottom: 22 },
  oldRow: { display: 'flex', alignItems: 'baseline', gap: 10, width: '100%',
            textAlign: 'left', background: '#111c2e', border: 0,
            borderBottom: '1px solid #1e293b', padding: '10px 12px',
            cursor: 'pointer' },
  oldDays: { color: '#fbbf24', fontSize: 12, fontWeight: 800, minWidth: 34 },
  oldName: { color: '#e2e8f0', fontSize: 13, fontWeight: 600 },
  oldIssue: { color: '#64748b', fontSize: 12, overflow: 'hidden',
              whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  empty: { color: '#94a3b8', fontSize: 13, background: '#111c2e', padding: 16,
           borderRadius: 10, lineHeight: 1.5, maxWidth: 620 },
};
