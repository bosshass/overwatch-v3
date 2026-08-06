import { useEffect, useState, useMemo } from 'react';
import { LANES, laneOf } from '../utils/lanes';
import { techLabel, isMultiTech, techsOn } from '../utils/scheduledTechs';
import { fetchBoard, laneCtx, blockerFor } from '../services/jobs';
import TicketSheet from './TicketSheet';
import SchedulerModal from './SchedulerModal';
import FinishSheet from './FinishSheet';
import OfficeReview from './OfficeReview';
import MyHours from './MyHours';
import AskSheet from './AskSheet';
import EstimateSheet from './EstimateSheet';
import MaterialsSheet from './MaterialsSheet';

// ============================================================================
// BoardView — the six lanes. No second vocabulary; everything comes from
// lanes.js. A hold renders as a badge on a card that stays in its lane.
// ============================================================================

// When is this actually happening? scheduled_for on the assignment carries the
// real start instant. jobs holds no dates — next_scheduled comes from
// the timestamp when there is one, the bare date when there is not.
function whenLabel(job) {
  const first = (job.assignments || []).filter(a => a.event_state !== 'removed')
    .map(a => a.scheduled_for)
    .filter(Boolean)
    .sort()[0];

  if (first) {
    const d = new Date(first);
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  if (job.next_scheduled) {
    return new Date(job.next_scheduled).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    }) + ' · no time set';
  }
  return null;
}

// ── The card ─────────────────────────────────────────────────────────────────
// FOUR ROWS, HARD MAXIMUM.
//
//   1  customer + DRH ID           right: age in this lane
//   2  the issue, one line
//   3  the blocker — ONE line, only when something is owed
//   4  tech · when · hours
//
// It had nineteen possible elements and five full-width coloured bars, each
// added the day something turned out to be invisible. They were all answering
// the same question, so a card showing three of them buried the one that
// mattered. blockerFor() picks exactly one.
//
// Priority is the LEFT EDGE, not a chip — it costs no vertical space.
// Colour is ownership, never severity: amber is on us, slate is on them.

const TONE = {
  broken: { fg: '#fca5a5', pip: '#ef4444' },
  person: { fg: '#c7d2fe', pip: '#818cf8' },
  us:     { fg: '#fcd34d', pip: '#d97706' },
  them:   { fg: '#93a6bd', pip: '#64748b' },
  done:   { fg: '#7fd8cd', pip: '#14b8a6' },
};

const EDGE = { emergency: '#ff6464', high: '#f3a51f' };

function ageLabel(job) {
  // How long it has sat where it is. The transition log has carried this since
  // 3.13 and nothing has ever shown it.
  const since = job.lane_since || job.updated_at;
  if (!since) return null;
  const d = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  return d < 1 ? null : `${d}d`;
}

function Card({ job, onOpen }) {
  const techs = techsOn(job.assignments);
  const when  = whenLabel(job);
  const blocker = blockerFor(job);
  const tone  = blocker ? TONE[blocker.tone] : null;
  const age   = ageLabel(job);
  const edge  = EDGE[job.priority] || 'transparent';

  return (
    <div
      style={{ ...S.card, borderLeftColor: edge }}
      onClick={() => onOpen(job)}
      role="button"
    >
      <div style={S.cardTop}>
        <span style={S.customer}>
          {job.customer?.name || job.customer_name || 'No customer'}
          {job.customer_id && <span style={S.drhId}>{job.customer_id}</span>}
        </span>
        {age && (
          <span style={{ ...S.age, ...(blocker?.stale ? S.ageHot : {}) }}>{age}</span>
        )}
      </div>

      {job.issue && job.issue !== 'Test' && <div style={S.issue}>{job.issue}</div>}

      {blocker && (
        <div style={{ ...S.blocker, color: tone.fg }}>
          <span style={{ ...S.pip, background: tone.pip }} />
          {blocker.label}
          {blocker.days != null && blocker.days > 0 && (
            <span style={S.blockerAge}>{blocker.days}d</span>
          )}
        </div>
      )}

      <div style={S.foot}>
        {techLabel(job.assignments) && (
          <span style={S.owner}>
            {techLabel(job.assignments)}
            {isMultiTech(job.assignments) && ` (${techs.length})`}
          </span>
        )}
        {when && <span>{when}</span>}
        {job.estimated_hours != null && <span>{job.estimated_hours}h</span>}
        {job.due_date && <span>due {job.due_date}</span>}
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
  const [finishJob, setFinishJob] = useState(null);

  // Review is per visit, not a lane — the way in is a card with a visit whose
  // is pending, not a separate status column on the board.
  const [reviewJob, setReviewJob] = useState(null);
  const [materialsJob, setMaterialsJob] = useState(null);
  const [hoursJob, setHoursJob] = useState(null);
  const [askJob, setAskJob] = useState(null);
  const [estId, setEstId] = useState(null);

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
      const k = laneOf(j, laneCtx(j));
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
          onFinish={j => { setOpenJob(null); setFinishJob(j); }}
          onReview={j => { setOpenJob(null); setReviewJob(j); }}
          onAsk={j => { setOpenJob(null); setAskJob(j); }}
          onEstimate={(j, id) => { if (id) { setOpenJob(null); setEstId(id); } }}
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

      {reviewJob && (
        <OfficeReview
          job={reviewJob}
          actor={actor}
          onClose={() => setReviewJob(null)}
          onDone={refresh}
          onEnterMaterials={j => { setReviewJob(null); setMaterialsJob(j); }}
          onEnterTime={j => { setReviewJob(null); setHoursJob(j); }}
        />
      )}

      {materialsJob && (
        <MaterialsSheet
          job={materialsJob}
          actor={actor}
          onClose={() => setMaterialsJob(null)}
          onSaved={refresh}
        />
      )}

      {estId && (
        <EstimateSheet
          estimateId={estId}
          actor={actor}
          onClose={() => setEstId(null)}
          onChanged={refresh}
        />
      )}

      {askJob && (
        <AskSheet
          job={askJob}
          actor={actor}
          onClose={() => setAskJob(null)}
          onDone={refresh}
        />
      )}

      {hoursJob && (
        <MyHours
          job={hoursJob}
          actor={actor}
          onClose={() => setHoursJob(null)}
          onSaved={refresh}
        />
      )}

      {finishJob && (
        <FinishSheet
          job={finishJob}
          actor={actor}
          onClose={() => setFinishJob(null)}
          onFinished={refresh}
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
  card: { background: '#11243a', borderRadius: 10, padding: '11px 12px',
          borderLeft: '3px solid transparent', marginBottom: 8, cursor: 'pointer' },
  cardTop: { display: 'flex', justifyContent: 'space-between',
             alignItems: 'baseline', gap: 8 },
  drhId: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#687f99',
           fontWeight: 400, marginLeft: 6 },
  age: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#687f99', flex: 'none' },
  ageHot: { color: '#f3a51f' },
  blocker: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 9,
             fontSize: 12, fontWeight: 600, lineHeight: 1.3 },
  pip: { width: 6, height: 6, borderRadius: '50%', flex: 'none' },
  blockerAge: { marginLeft: 'auto', color: '#687f99', fontSize: 11, fontWeight: 400 },
  foot: { display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 9,
          fontSize: 11.5, color: '#687f99' },
  customer: { color: '#f1f5f9', fontWeight: 600, fontSize: 13 },
  issue: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  owner: { color: '#38bdf8' },
};
