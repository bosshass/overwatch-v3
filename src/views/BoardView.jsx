import { useEffect, useState, useMemo } from 'react';
import { LANES, laneOf, hasHold } from '../utils/lanes';
import { ownerLabel, isUnowned, isMultiTech, techsOn } from '../utils/ownership';
import { fetchBoard, moveTo } from '../services/jobs';
import TicketSheet from './TicketSheet';
import SchedulerModal from './SchedulerModal';

// ============================================================================
// BoardView — the six lanes. No second vocabulary; everything comes from
// lanes.js. A hold renders as a badge on a card that stays in its lane.
// ============================================================================

function Card({ job, onOpen }) {
  const techs = techsOn(job.assignments);
  const held = hasHold(job);

  return (
    <div style={S.card} onClick={() => onOpen(job)} role="button">
      <div style={S.cardTop}>
        <span style={S.customer}>
          {job.customer?.name || job.customer_name || 'No customer'}
        </span>
        {held && <span style={S.hold}>HOLD</span>}
      </div>

      {job.issue && job.issue !== 'Test' && <div style={S.issue}>{job.issue}</div>}

      <div style={S.meta}>
        <span style={isUnowned(job.assignments) ? S.unowned : S.owner}>
          {ownerLabel(job.assignments)}
          {isMultiTech(job.assignments) && ` (${techs.length})`}
        </span>
        {job.estimated_hours != null && <span style={S.hours}>{job.estimated_hours}h</span>}
        {job.priority && job.priority !== 'normal' && (
          <span style={S.pri}>{job.priority}</span>
        )}
        {job.due_date && <span style={S.due}>due {job.due_date}</span>}
      </div>
    </div>
  );
}

export default function BoardView({ actor }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [openJob, setOpenJob] = useState(null);
  const [schedJob, setSchedJob] = useState(null);

  const load = () =>
    fetchBoard()
      .then(setJobs)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const refresh = () => {
    setLoading(true);
    fetchBoard().then(setJobs).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };

  const byLane = useMemo(() => {
    const m = Object.fromEntries(LANES.map(l => [l.key, []]));
    for (const j of jobs) {
      const k = laneOf(j, { hasTimeEntry: j.hasTimeEntry });
      if (k && m[k]) m[k].push(j);
    }
    return m;
  }, [jobs]);

  if (loading) return <div style={S.msg}>Loading…</div>;

  return (
    <div className="ow-full" style={S.wrap}>
      {err && <div style={S.err} onClick={() => setErr(null)}>{err}</div>}
      <div style={S.lanes}>
        {LANES.map(lane => (
          <div key={lane.key} style={S.lane}>
            <div style={{ ...S.laneHead, borderTopColor: lane.color }}>
              <span style={S.laneLabel}>{lane.label}</span>
              <span style={{ ...S.count, background: lane.color }}>
                {byLane[lane.key].length}
              </span>
            </div>
            <div style={S.laneMeans}>{lane.means}</div>
            <div style={S.laneBody}>
              {byLane[lane.key].length === 0
                ? <div style={S.empty}>Nothing here</div>
                : byLane[lane.key].map(j => (
                    <Card key={j.id} job={j} onOpen={setOpenJob} />
                  ))}
            </div>
          </div>
        ))}
      </div>

      {openJob && (
        <TicketSheet
          job={jobs.find(j => j.id === openJob.id) || openJob}
          actor={actor}
          onClose={() => setOpenJob(null)}
          onChanged={refresh}
          onSchedule={j => { setOpenJob(null); setSchedJob(j); }}
        />
      )}

      {schedJob && (
        <SchedulerModal
          job={schedJob}
          actor={actor}
          onClose={() => setSchedJob(null)}
          onBooked={refresh}
        />
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 16, background: '#0b1220' },
  msg: { padding: 32, color: '#94a3b8' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '10px 14px',
         borderRadius: 8, marginBottom: 12, cursor: 'pointer', fontSize: 14 },
  lanes: { display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start' },
  lane: { flex: '0 0 280px', background: '#111c2e', borderRadius: 12, padding: 10 },
  laneHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderTop: '3px solid', paddingTop: 8, marginBottom: 2 },
  laneLabel: { color: '#e2e8f0', fontWeight: 600, fontSize: 14 },
  count: { color: '#0b1220', borderRadius: 10, padding: '1px 8px',
           fontSize: 12, fontWeight: 700 },
  laneMeans: { color: '#64748b', fontSize: 11, marginBottom: 10, lineHeight: 1.3 },
  laneBody: { display: 'flex', flexDirection: 'column', gap: 8 },
  empty: { color: '#475569', fontSize: 12, padding: '12px 4px' },
  card: { background: '#1a2740', borderRadius: 8, padding: 10 },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 6 },
  customer: { color: '#f1f5f9', fontWeight: 600, fontSize: 13 },
  hold: { background: '#d97706', color: '#1a1200', fontSize: 9, fontWeight: 800,
          padding: '2px 5px', borderRadius: 4, alignSelf: 'flex-start' },
  issue: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  meta: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 11 },
  owner: { color: '#38bdf8' },
  unowned: { color: '#f87171' },
  hours: { color: '#94a3b8' },
  due: { color: '#94a3b8' },
  pri: { color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700 },
  moveBtn: { marginTop: 8, width: '100%', background: '#243350', color: '#cbd5e1',
             border: 0, borderRadius: 6, padding: '6px', fontSize: 12, cursor: 'pointer' },
  moveList: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  moveOpt: { textAlign: 'left', background: '#2b3d5e', color: '#e2e8f0', border: 0,
             borderRadius: 6, padding: '6px 8px', fontSize: 12, cursor: 'pointer',
             display: 'flex', flexDirection: 'column', gap: 2 },
  moveOptOff: { opacity: 0.45, cursor: 'not-allowed' },
  why: { fontSize: 10, color: '#fca5a5' },
};
