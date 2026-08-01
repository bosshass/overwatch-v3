import { useEffect, useState, useMemo } from 'react';
import { LANES, laneOf, hasHold } from '../utils/lanes';
import { needsOwner } from '../utils/ownership';
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
// ============================================================================

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
      if (needsOwner(j)) unowned++;
      if (hasHold(j)) held++;
    }
    return { byLane, unowned, held, total: jobs.length };
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
  empty: { color: '#94a3b8', fontSize: 13, background: '#111c2e', padding: 16,
           borderRadius: 10, lineHeight: 1.5, maxWidth: 620 },
};
