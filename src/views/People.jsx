// ============================================
// People — who owns what. One screen.
// ============================================
// WHAT THIS REPLACES AND WHY
//   OfficeHub had the interaction that actually worked: tabs across the top,
//   quick-select a person, schedule them. But it read ownership from
//   job_assignments (18 rows) via `_tech_name`, so it showed almost every job
//   as unassigned and every tech lane as empty. It was right about the shape
//   and wrong about the data, and nobody reported it — because nobody could
//   reach it. It was never linked from anywhere.
//
//   Meanwhile My Tasks (Workspace) had the correct ownership rule and a
//   separate design, which is why the team kept asking what the difference
//   was between My Tasks and the Board. There wasn't a good answer: My Tasks
//   is just People, filtered to you. So it's the same screen now.
//
// ONE VOCABULARY
//   Ownership   -> utils/ownership.js  (assigneeOf / emailsFor)
//   Lanes       -> utils/lanes.js      (the same five the board shows)
//   The ticket  -> components/TicketSheet.jsx
//   Scheduling  -> components/VisualSchedulerModal.jsx -> services/schedule.js
//   Nothing here defines its own version of any of those.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, jobsApi } from '../services/supabase.js';
import {
  ASSIGNEES, assigneeOf, canonicalEmail, emailsFor,
  NAME_BY_EMAIL, CLOSED_STATUSES,
} from '../utils/ownership.js';
import { LANES, laneOf } from '../utils/lanes.js';
import { stalenessOf, STALE_COLOR } from '../utils/staleness.js';
import { TECH_COLORS, getTechCalendarId } from '../config/calendars.js';
import TicketSheet from '../components/TicketSheet.jsx';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';

const C = {
  bg: '#0f1729', panel: '#16233a', raised: '#1b2b45', line: '#2a3b56',
  text: '#e9f1ff', muted: '#93a5bd', dim: '#64748b', cyan: '#00c8e8',
  amber: '#f59e0b', red: '#ef4444', green: '#22c55e',
};

// The task lanes are the person's own list — deliberately NOT the job lanes.
// A job's lane says where the WORK goes next; a task lane says what the PERSON
// is doing about it. Conflating them is what made My Tasks feel like a second,
// disagreeing board.
const TASK_LANES = [
  { key: 'todo',     label: 'To do',    color: C.cyan,  empty: 'Nothing queued. Add a note or pick up a job below.' },
  { key: 'doing',    label: 'Doing',    color: C.amber, empty: 'Nothing in progress.' },
  { key: 'watching', label: 'Watching', color: '#a855f7', empty: 'Not watching anything. Hand a job off and it lands here.' },
  { key: 'done',     label: 'Done',     color: C.dim,   empty: 'Nothing finished yet.' },
];

const fmtDay = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  : null;

export default function People({ userEmail, userName, accessToken, onBack }) {
  const navigate = useNavigate();
  const { who } = useParams();

  // Default to the signed-in person, resolved through the login aliases so
  // JR on info@ lands on JR and not on whoever is first in the roster.
  const myName = NAME_BY_EMAIL[canonicalEmail(userEmail)] || userName || null;
  const [person, setPerson] = useState(() => {
    if (who && who.toLowerCase() === 'all') return 'all';
    const hit = ASSIGNEES.find(a => a.name.toLowerCase() === (who || '').toLowerCase());
    return hit ? hit.name : (myName || 'all');
  });

  const [tab, setTab] = useState('work');
  const [jobs, setJobs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openJob, setOpenJob] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [toast, setToast] = useState('');

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      // Everything open, once. Filtering by person happens in memory so
      // switching people is instant and the counts on every chip stay honest.
      const [{ data: j, error: je }, { data: n }] = await Promise.all([
        supabase.from('jobs')
          .select('id, customer_name, issue, status, assigned_to, tech_name, created_at, updated_at, scheduled_date, tentative_date, customer_address, customer_phone, job_type, estimate_amount, customer_id, calendar_event_id')
          .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
          .order('created_at', { ascending: true })
          .limit(2000),
        supabase.from('notes').select('*')
          .eq('status', 'open')
          .order('created_at', { ascending: true })
          .limit(1000),
      ]);
      if (je) throw je;
      setJobs(j || []);
      setNotes(n || []);
    } catch (e) { setErr(e.message || String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the URL honest so a person's view is linkable and the back button works.
  useEffect(() => {
    const slug = person === 'all' ? 'all' : person.toLowerCase();
    if ((who || '').toLowerCase() !== slug) navigate(`/people/${slug}`, { replace: true });
  }, [person, who, navigate]);

  const jobsFor = useCallback(
    (name) => name === 'all' ? jobs : jobs.filter(j => assigneeOf(j) === name),
    [jobs]);

  const notesFor = useCallback((name) => {
    if (name === 'all') return notes;
    const hit = ASSIGNEES.find(a => a.name === name);
    if (!hit) return [];
    const mine = new Set(emailsFor(hit.email));
    return notes.filter(n => mine.has((n.author_email || '').toLowerCase()));
  }, [notes]);

  const myJobs = useMemo(() => jobsFor(person), [jobsFor, person]);
  const myNotes = useMemo(() => notesFor(person), [notesFor, person]);
  const unowned = useMemo(() => jobs.filter(j => !assigneeOf(j)), [jobs]);

  // Their work, in the SAME five lanes the board uses.
  const byLane = useMemo(() => {
    const m = {};
    LANES.forEach(l => { m[l.key] = []; });
    myJobs.forEach(j => {
      const lane = laneOf(j);
      if (lane && m[lane.key]) m[lane.key].push(j);
    });
    return m;
  }, [myJobs]);

  const upcoming = useMemo(() => myJobs
    .filter(j => j.scheduled_date || j.tentative_date)
    .sort((a, b) => new Date(a.scheduled_date || a.tentative_date) - new Date(b.scheduled_date || b.tentative_date)),
    [myJobs]);

  const moveJob = async (job, target, note) => {
    await jobsApi.changeStatus(job.id, target, userEmail, note);
    setOpenJob(null);
    await load();
    say('Moved');
  };

  // ── chrome ────────────────────────────────────────────────────────────────
  const PersonChip = ({ name, count, color, active }) => (
    <button onClick={() => setPerson(name)}
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7,
        background: active ? `${color}22` : C.raised,
        border: `1px solid ${active ? color : C.line}`,
        borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
        color: active ? color : C.text, fontSize: 14,
        fontWeight: active ? 800 : 600, fontFamily: 'inherit',
      }}>
      {name === 'all' ? 'Everyone' : name}
      <span style={{
        background: active ? color : C.line, color: active ? '#08121f' : C.muted,
        borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 800,
      }}>{count}</span>
    </button>
  );

  const JobRow = ({ job }) => {
    const lane = laneOf(job);
    const stale = stalenessOf(job);
    const staleColor = STALE_COLOR[stale.level];
    const when = job.scheduled_date || job.tentative_date;
    return (
      <button onClick={() => setOpenJob(job)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', background: C.raised,
          border: `1px solid ${C.line}`, borderLeft: `3px solid ${staleColor || lane?.color || C.line}`,
          borderRadius: 10, padding: '11px 13px', marginBottom: 7, cursor: 'pointer',
          color: C.text, fontFamily: 'inherit',
        }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
          {job.customer_name || 'Unnamed'}
        </div>
        {job.issue && (
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.4, marginBottom: 6,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {job.issue}
          </div>
        )}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          {lane && (
            <span style={{ fontSize: 11, fontWeight: 700, color: lane.color,
                           background: `${lane.color}1f`, padding: '2px 7px', borderRadius: 5 }}>
              {lane.icon} {lane.label}
            </span>
          )}
          {when && (
            <span style={{ fontSize: 11.5, color: C.muted }}>{fmtDay(when)}</span>
          )}
          {staleColor && (
            <span style={{ fontSize: 11, fontWeight: 700, color: staleColor }}>
              {stale.label}
            </span>
          )}
        </div>
      </button>
    );
  };

  const Empty = ({ children }) => (
    <div style={{ color: C.dim, fontSize: 13, padding: '14px 2px', lineHeight: 1.5 }}>{children}</div>
  );

  const Section = ({ title, color, count, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.04em',
                       textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 11, color: C.dim, fontWeight: 700 }}>{count}</span>
      </div>
      {children}
    </div>
  );

  const TABS = [
    { key: 'work',     label: 'Work',     badge: myJobs.length },
    { key: 'tasks',    label: 'Tasks',    badge: myNotes.filter(n => n.lane !== 'done').length },
    { key: 'schedule', label: 'Schedule', badge: upcoming.length },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', color: C.text,
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
                  paddingBottom: 90 }}>

      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.line}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                    position: 'sticky', top: 0, background: C.bg, zIndex: 60 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.muted,
                                            fontSize: 20, cursor: 'pointer', padding: 0 }}>‹</button>
        )}
        <div style={{ flex: 1, fontSize: 19, fontWeight: 800 }}>People</div>
        <button onClick={load}
          style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
                   color: C.muted, fontSize: 12, padding: '6px 11px', cursor: 'pointer',
                   fontFamily: 'inherit' }}>Refresh</button>
      </div>

      {/* Person quick-select — the thing that worked in OfficeHub */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 16px',
                    borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 53,
                    background: C.bg, zIndex: 55, WebkitOverflowScrolling: 'touch' }}>
        <PersonChip name="all" count={jobs.length} color={C.cyan} active={person === 'all'} />
        {ASSIGNEES.map(a => (
          <PersonChip key={a.email} name={a.name}
            count={jobsFor(a.name).length}
            color={TECH_COLORS[a.name] || C.cyan}
            active={person === a.name} />
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`,
                    position: 'sticky', top: 110, background: C.bg, zIndex: 50 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: '12px 0', background: 'none', border: 'none',
                     color: tab === t.key ? C.cyan : C.dim, fontSize: 14,
                     fontWeight: tab === t.key ? 800 : 500, cursor: 'pointer',
                     position: 'relative', fontFamily: 'inherit',
                     borderBottom: `2px solid ${tab === t.key ? C.cyan : 'transparent'}` }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: C.muted }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {loading && <Empty>Loading…</Empty>}
        {err && <div style={{ color: '#fca5a5', fontSize: 13 }}>Couldn’t load: {err}</div>}

        {/* ── WORK ── their jobs, in the board's five lanes ── */}
        {!loading && tab === 'work' && (
          <>
            {myJobs.length === 0 && (
              <Empty>
                {person === 'all'
                  ? 'No open jobs.'
                  : `${person} has no open work. Pick a job from Unassigned below and assign it from the ticket.`}
              </Empty>
            )}
            {LANES.map(lane => byLane[lane.key]?.length ? (
              <Section key={lane.key} title={`${lane.icon} ${lane.label}`}
                color={lane.color} count={byLane[lane.key].length}>
                {byLane[lane.key].map(j => <JobRow key={j.id} job={j} />)}
              </Section>
            ) : null)}

            {/* Unassigned is everyone's problem, so it sits under every person. */}
            {unowned.length > 0 && (
              <Section title="Nobody owns this" color={C.red} count={unowned.length}>
                {unowned.slice(0, 12).map(j => <JobRow key={j.id} job={j} />)}
                {unowned.length > 12 && (
                  <button onClick={() => navigate('/board')}
                    style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
                             color: C.muted, fontSize: 12, padding: '8px 12px', cursor: 'pointer',
                             fontFamily: 'inherit' }}>
                    See all {unowned.length} on the board
                  </button>
                )}
              </Section>
            )}
          </>
        )}

        {/* ── TASKS ── the person's own list (was My Tasks) ── */}
        {!loading && tab === 'tasks' && (
          <>
            {TASK_LANES.map(tl => {
              const items = myNotes.filter(n => n.lane === tl.key);
              return (
                <Section key={tl.key} title={tl.label} color={tl.color} count={items.length}>
                  {items.length === 0 && <Empty>{tl.empty}</Empty>}
                  {items.map(n => {
                    const job = n.job_id ? jobs.find(j => j.id === n.job_id) : null;
                    return (
                      <button key={n.id}
                        onClick={() => job ? setOpenJob(job) : null}
                        style={{ display: 'block', width: '100%', textAlign: 'left',
                                 background: C.raised, border: `1px solid ${C.line}`,
                                 borderLeft: `3px solid ${tl.color}`, borderRadius: 10,
                                 padding: '11px 13px', marginBottom: 7,
                                 cursor: job ? 'pointer' : 'default',
                                 color: C.text, fontFamily: 'inherit' }}>
                        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{n.body}</div>
                        {job && (
                          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>
                            {job.customer_name} · {laneOf(job)?.label || job.status}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </Section>
              );
            })}
          </>
        )}

        {/* ── SCHEDULE ── what's booked, and a way to book more ── */}
        {!loading && tab === 'schedule' && (
          <>
            {upcoming.length === 0 && (
              <Empty>
                Nothing on {person === 'all' ? 'the' : `${person}’s`} calendar yet.
                Open a job from Work and choose Scheduled to book it.
              </Empty>
            )}
            {upcoming.map(j => (
              <div key={j.id} style={{ marginBottom: 7 }}>
                <JobRow job={j} />
                <button onClick={() => setScheduling(j)}
                  style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 8,
                           color: C.cyan, fontSize: 12, fontWeight: 700, padding: '6px 12px',
                           cursor: 'pointer', fontFamily: 'inherit', marginLeft: 2 }}>
                  {j.scheduled_date ? 'Reschedule' : 'Book this hold'}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* One ticket, same as the board and /j/ links */}
      {openJob && (
        <div onClick={() => setOpenJob(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.75)', zIndex: 900,
                   display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 540, background: C.bg, overflowY: 'auto',
                     borderLeft: `1px solid ${C.line}` }}>
            <TicketSheet
              job={openJob}
              userEmail={userEmail}
              accessToken={accessToken}
              onClose={() => setOpenJob(null)}
              onAssigned={() => load()}
              onOpenScheduler={() => { setScheduling(openJob); setOpenJob(null); }}
              onSchedulePrimary={
                ['ready_to_schedule', 'return_pending', 'scheduled'].includes(openJob.status)
                  ? () => { setScheduling(openJob); setOpenJob(null); } : null
              }
              onMove={(target, note) => moveJob(openJob, target, note)}
            />
          </div>
        </div>
      )}

      {scheduling && (
        <VisualSchedulerModal
          job={scheduling}
          /* VisualSchedulerModal filters on t.calendar_id and renders "No techs
             with a calendar configured" when nothing survives. The roster in
             ownership.js has no calendar on it — that lives in
             config/calendars.js — so every person was being filtered out.
             getTechCalendarId() is the one place that mapping exists. */
          techs={ASSIGNEES
            .map(a => ({
              id: a.email,
              name: a.name,
              email: a.email,
              calendar_id: getTechCalendarId(a.email),
              color: TECH_COLORS[a.name] || null,
            }))
            .filter(t => t.calendar_id)}
          accessToken={accessToken}
          userEmail={userEmail}
          onClose={() => setScheduling(null)}
          onScheduled={() => { setScheduling(null); load(); say('Scheduled'); }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)',
                      background: C.raised, border: `1px solid ${C.line}`, borderRadius: 999,
                      padding: '9px 18px', fontSize: 13, fontWeight: 700, zIndex: 1200 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
