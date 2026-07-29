// ============================================
// BoardView — NakedPM v3
// ============================================
// v3 changes:
//   - Note gate removed — status moves fire immediately
//   - Duplicate/merge flow added
//   - Date stamps show original created_at, not today
//   - updated_at stamps only on actual updates (no created_at overwrite)
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, jobsApi, JOB_STATUS, STATUS_INFO, techsApi, customersApi, notesApi } from '../services/supabase.js';
import { stripIntakeTemplate } from '../utils/statusMachine.js';
import { ASSIGNEES, NAME_BY_EMAIL, assigneeOf, canonicalEmail } from '../utils/ownership.js';
import { LANES, CLEAR_LANE, isHeld } from '../utils/lanes.js';
import { notifyJobAssigned } from '../services/pushNotifications.js';
import { stalenessOf, ageLabel, STALE_COLOR, STALE_OPTIONS, getStaleDays, setStaleDays } from '../utils/staleness.js';
import { jobLink as boardJobLink, shortJobLink, assignmentMessage } from '../config/appBase.js';
import { missingLabel } from '../utils/completeness.js';
import { sendGmail, assignmentEmail } from '../services/gmailSend.js';
import { CALENDARS } from '../config/calendars.js';
import NewJobModal from '../components/NewJobModal.jsx';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';
import TicketSheet from '../components/TicketSheet.jsx';
import Spotlight from '../components/Spotlight.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// All statuses a job can be moved to. Order = the natural workflow,
// but every status is reachable from any status (move any ticket anywhere).
const ALL_STATUSES = [
  'new','needs_details','needs_parts','pending_materials','needs_estimate',
  'estimate_sent','won','lost','ready_to_schedule','scheduled','return_pending',
  'complete','to_bill','billed','blocked','dead','archived',
];

// "Suggested" next step per status — used only to pick the ONE quick-move verb
// shown on the card. The full move list is always every other status.
const SUGGESTED_NEXT = {
  new:               'ready_to_schedule',
  needs_details:     'ready_to_schedule',
  needs_parts:       'ready_to_schedule',
  pending_materials: 'ready_to_schedule',
  needs_estimate:    'estimate_sent',
  estimate_sent:     'won',
  won:               'ready_to_schedule',
  ready_to_schedule: 'scheduled',
  scheduled:         'complete',
  return_pending:    'scheduled',
  complete:          'to_bill',
  to_bill:           'billed',
  billed:            'archived',
  lost:              'archived',
  dead:              'archived',
};

// Every status can move to every OTHER status (no one-way lock).
const STATUS_VERBS = Object.fromEntries(
  ALL_STATUSES.map(s => [s, ALL_STATUSES.filter(t => t !== s)])
);

// Move-to targets shown as the 6 board lanes (not 15 raw statuses).
// Tapping a lane sends the card there. Estimates expands to its stages.
// Move targets are the SAME list as the columns — that is the entire point.
const LANE_MOVES = [...LANES, CLEAR_LANE].map(l => ({
  key: l.key,
  label: `${l.icon} ${l.label}`,
  color: l.color,
  target: l.target,
  statuses: l.statuses,
  schedule: l.needsScheduler,
}));

// Estimate sub-stages, revealed when Estimates is tapped.
const EST_STAGES = [
  { status:'needs_estimate', label:'Needed', color:'#f59e0b' },
  { status:'estimate_sent',  label:'Sent',   color:'#06b6d4' },
  { status:'won',            label:'Won',    color:'#22c55e' },
  { status:'lost',           label:'Lost',   color:'#6b7280' },
];

// Columns come from utils/lanes.js now. They used to be their own array that
// drifted from LANE_MOVES — same card, two vocabularies.
const COLUMNS = LANES.map(l => ({
  key: l.key,
  label: `${l.icon} ${l.label}`,
  color: l.color,
  statuses: l.statuses,
  virtual: l.virtual,
}));

const fmtMoney = n => n ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n) : '';

// Show original event date — not "today"
const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 0) return `in ${-days}d`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
};

// ── UUID Linker ───────────────────────────────────────────────────────────────
function UUIDLinker({ job, onLinked }) {
  const [query, setQuery] = useState(job.customer_name || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState(job.customer_name || '');
  const [newPhone, setNewPhone] = useState(job.customer_phone || '');
  const [newAddr, setNewAddr] = useState(job.customer_address || '');
  const [err, setErr] = useState('');

  const search = async q => {
    setQuery(q);
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try { setResults(await customersApi.search(q)); } catch(e) { setErr(e.message); }
    setSearching(false);
  };

  const link = async customerId => {
    setSaving(true);
    try {
      const { error } = await supabase.from('jobs').update({ customer_id: customerId }).eq('id', job.id);
      if (error) throw error;
      onLinked(customerId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const createAndLink = async () => {
    if (!newName.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try {
      const c = await customersApi.createLoose({ name:newName, phone:newPhone, address:newAddr });
      await link(c.id);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  // THE BUG: this collapsed view showed "no customer UUID" unconditionally —
  // it never checked job.customer_id at all. Linking correctly wrote the id
  // to the database and updated state (the toast even said "Customer linked
  // ✓"), but the warning kept showing because nothing here looked at whether
  // a customer was actually attached. Every job with a customer looked
  // exactly like every job without one.
  if (!open) {
    if (job.customer_id) return null; // linked — nothing to warn about
    return (
      <button onClick={() => setOpen(true)}
        style={{ width:'100%', padding:'8px 12px', borderRadius:6, border:'1px solid #92400e', background:'#451a03', color:'#fb923c', fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', marginBottom:10 }}>
        ⚠ no customer UUID — tap to link
      </button>
    );
  }

  return (
    <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:12, border:'1px solid #334155' }} onClick={e => e.stopPropagation()}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>link customer</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:14 }}>✕</button>
      </div>
      {!createMode ? (
        <>
          <input value={query} onChange={e => search(e.target.value)} placeholder="search by name, phone, CMS…"
            style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:13, boxSizing:'border-box', marginBottom:6 }} />
          {searching && <div style={{ color:'#94a3b8', fontSize:11, padding:'4px 0' }}>searching…</div>}
          {results.map(c => (
            <button key={c.id} onClick={() => link(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, color:'#fff', fontSize:12, cursor:'pointer', marginBottom:4 }}>
              <div style={{ fontWeight:600 }}>{c.name}</div>
              <div style={{ fontSize:11, color:'#cbd5e1' }}>{[c.phone, c.address?.split(',')[0], c.cms_account_id].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
          <button onClick={() => setCreateMode(true)}
            style={{ width:'100%', marginTop:6, padding:'7px 0', borderRadius:6, border:'1px dashed #475569', background:'transparent', color:'#cbd5e1', fontSize:12, cursor:'pointer' }}>
            + create new customer
          </button>
        </>
      ) : (
        <>
          {[['Name *',newName,setNewName],['Phone',newPhone,setNewPhone],['Address',newAddr,setNewAddr]].map(([label,val,set])=>(
            <div key={label} style={{ marginBottom:6 }}>
              <div style={{ fontSize:11, color:'#cbd5e1', marginBottom:2 }}>{label}</div>
              <input value={val} onChange={e => set(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:12, boxSizing:'border-box' }} />
            </div>
          ))}
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <button onClick={() => setCreateMode(false)} style={{ flex:1, padding:8, borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#94a3b8', fontSize:12, cursor:'pointer' }}>back</button>
            <button onClick={createAndLink} disabled={saving||!newName.trim()} style={{ flex:2, padding:8, borderRadius:6, border:'none', background:'#22c55e', color:'#fff', fontWeight:600, fontSize:12, cursor:'pointer' }}>
              {saving ? 'saving…' : 'create & link'}
            </button>
          </div>
        </>
      )}
      {err && <div style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>{err}</div>}
    </div>
  );
}

// ── Merge/Duplicate finder ────────────────────────────────────────────────────
// Exported: merge must exist on EVERY ticket surface. When it lived only in
// the board's drawer, opening the duplicate from My Tasks or a /j/ link meant
// "no longer can merge" — the tool hadn't gone away, it just wasn't invited.
// allJobs is optional now; without it the tool loads its own candidates.
export function MergeTool({ job, allJobs = null, onMerge, accessToken, userEmail }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(job.customer_name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (allJobs || !open || loaded) return;
    supabase.from('jobs')
      .select('id, customer_name, status, issue, customer_phone, customer_address, cms_account_id, calendar_event_id')
      .not('status', 'in', '(dead,archived)')
      .order('updated_at', { ascending: false }).limit(400)
      .then(({ data }) => setLoaded(data || []));
  }, [allJobs, open, loaded]);

  const pool = allJobs || loaded || [];

  // Find jobs with similar customer name, excluding self
  const candidates = pool.filter(j =>
    j.id !== job.id &&
    j.status !== 'dead' &&
    j.status !== 'archived' &&
    j.customer_name &&
    (j.customer_name.toLowerCase().includes(query.toLowerCase()) ||
     query.toLowerCase().includes(j.customer_name.toLowerCase().split(' ')[0]))
  ).slice(0, 10);

  const merge = async (survivorId) => {
    if (!window.confirm('Merge THIS job into the other? Notes, issue/scope details, contact info, CMS/access codes, and the calendar link carry over to the survivor; this one is marked dead.')) return;
    setSaving(true);
    setErr('');
    try {
      const survivor = pool.find(j => j.id === survivorId) || {};
      const by = userEmail || 'board';

      // 1) Carry the dead job's notes onto the survivor with their ORIGINAL
      //    timestamps intact. Going through notesApi.addNote() here would
      //    stamp every single carried note with changed_at = now(), which is
      //    the actual root cause of the merged event log looking scrambled:
      //    months of the dead job's history all landing at the exact instant
      //    the merge button was clicked, out of any real chronological
      //    relationship to the survivor's own history. Inserting into
      //    job_history directly lets each note keep the date it really
      //    happened on.
      try {
        const deadNotes = await notesApi.getAllForJob(job.id);
        const { data: survivorRow } = await supabase.from('jobs').select('status').eq('id', survivorId).single();
        const survivorStatus = survivorRow?.status || null;

        const carryRows = deadNotes
          .filter(n => n.text?.trim())
          .map(n => ({
            job_id: survivorId,
            from_status: survivorStatus,
            to_status: survivorStatus,
            changed_by: n.created_by || by,
            notes: `↪ from merged job (${fmtDate(n.created_at)}): ${n.text}`,
            changed_at: n.created_at, // preserve the real date — the actual fix
          }));

        //    getAllForJob only reads job_history.notes + completion_notes — for
        //    a freshly-created job that's just the literal "Job created" string,
        //    NOT the real intake details, which live in the issue field. So we
        //    always surface the dead job's issue as its own note too, regardless
        //    of whether the survivor already has its own issue text — otherwise
        //    those details vanish with no trail at all.
        if (job.issue?.trim()) {
          carryRows.push({
            job_id: survivorId,
            from_status: survivorStatus,
            to_status: survivorStatus,
            changed_by: by,
            notes: `↪ merged job details (originally logged ${fmtDate(job.created_at)}):\n${job.issue.trim()}`,
            changed_at: job.created_at || new Date().toISOString(),
          });
        }

        // One clear marker, stamped at the ACTUAL merge time (now), so it's
        // obvious in the survivor's log exactly when a merge happened versus
        // the backdated notes carried in above it.
        carryRows.push({
          job_id: survivorId,
          from_status: survivorStatus,
          to_status: survivorStatus,
          changed_by: by,
          notes: `🔀 Merged in duplicate: ${job.customer_name || job.id} — its history is carried in above with original dates`,
        });

        if (carryRows.length) {
          await supabase.from('job_history').insert(carryRows);
        }
      } catch (e) { console.warn('merge: note carry failed', e); }

      // 2) Fill survivor gaps — issue, contact info, CMS/access details, and
      //    the calendar link. Issue only backfills if survivor's is empty
      //    (step 1 above already preserved the dead job's issue as a note
      //    either way, so nothing is lost if survivor's issue wins here).
      const upd = {};
      if (!survivor.issue && job.issue) upd.issue = job.issue;
      if (!survivor.customer_phone && job.customer_phone) upd.customer_phone = job.customer_phone;
      if (!survivor.customer_address && job.customer_address) upd.customer_address = job.customer_address;
      if (!survivor.customer_email && job.customer_email) upd.customer_email = job.customer_email;
      if (!survivor.cms_account_id && job.cms_account_id) upd.cms_account_id = job.cms_account_id;
      if (!survivor.gate_code && job.gate_code) upd.gate_code = job.gate_code;
      if (!survivor.panel_password && job.panel_password) upd.panel_password = job.panel_password;
      if (!survivor.calendar_event_id && job.calendar_event_id) {
        upd.calendar_event_id = job.calendar_event_id;
        if (job.calendar_id) upd.calendar_id = job.calendar_id;
      }
      if (Object.keys(upd).length) {
        upd.updated_by = by;
        await supabase.from('jobs').update(upd).eq('id', survivorId);
      }

      // 3) Move the dead job's calendar event to the Completed calendar (best-effort)
      if (accessToken && job.calendar_event_id && job.calendar_id) {
        try {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(job.calendar_id)}/events/${encodeURIComponent(job.calendar_event_id)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`,
            { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (e) { console.warn('merge: calendar move failed', e); }
      }

      // 4) Mark this job dead, pointing at the survivor
      const { error } = await supabase.from('jobs').update({
        status: 'dead',
        action_note: `Merged into job ${survivorId}`,
        updated_by: by,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;

      // Log the merge-out on the dead job's OWN event log too — action_note
      // above is a raw column, not part of job_history, so without this the
      // dead job's own audit trail never shows it was merged anywhere.
      try {
        await supabase.from('job_history').insert([{
          job_id: job.id,
          from_status: job.status,
          to_status: 'dead',
          changed_by: by,
          notes: `🔀 Merged into: ${survivor.customer_name || survivorId}`,
        }]);
      } catch (e) { console.warn('merge: dead-job event log failed', e); }

      onMerge(job.id, survivorId);
      setOpen(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width:'100%', padding:'7px 12px', borderRadius:6, border:'1px solid #334155', background:'transparent', color:'#cbd5e1', fontSize:11, cursor:'pointer', textAlign:'left', marginBottom:8 }}>
      🔁 mark as duplicate / merge
    </button>
  );

  return (
    <div style={{ background:'#0f172a', borderRadius:8, padding:12, marginBottom:12, border:'1px solid #334155' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>find duplicate to merge into</span>
        <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:14 }}>✕</button>
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search by customer name…"
        style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #334155', background:'#1e293b', color:'#fff', fontSize:13, boxSizing:'border-box', marginBottom:8 }} />
      {candidates.length === 0
        ? <div style={{ color:'#94a3b8', fontSize:12, padding:'8px 0' }}>no matches found</div>
        : candidates.map(c => {
          const si = STATUS_INFO[c.status] || {};
          return (
            <button key={c.id} onClick={() => merge(c.id)} disabled={saving}
              style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', background:'#1e293b', border:'0.5px solid #334155', borderRadius:6, color:'#fff', fontSize:12, cursor:'pointer', marginBottom:4 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:600 }}>{c.customer_name}</span>
                <span style={{ fontSize:11, color:si.color||'#64748b' }}>{si.label||c.status}</span>
              </div>
              <div style={{ fontSize:11, color:'#cbd5e1', marginTop:2 }}>
                {c.issue?.slice(0,60) || 'no issue'} · {fmtDate(c.created_at)}
              </div>
            </button>
          );
        })
      }
      {err && <div style={{ color:'#ef4444', fontSize:11, marginTop:6 }}>{err}</div>}
    </div>
  );
}

// ── Scheduler modal: VisualSchedulerModal (SchedulerModal.jsx deleted 9.9.25) ──

// ── Detail drawer ─────────────────────────────────────────────────────────────
// onWatch comes in as a prop — the function lives in BoardView proper, and
// calling it bare from in here was an out-of-scope reference that crashed the
// "Watch this" button. The build stayed green because Vite doesn't
// check undefined identifiers; that's what the lint gate is for now.
function DetailDrawer({ job, techs, accessToken, onStatusMove, onSchedule, onClose, moving, onUUIDLinked, allJobs, onMerge, onRenamed, userEmail, onWatch, onAssigned }) {
  // REBUILT 9.11.0 as a thin shell around TicketSheet. This drawer was the
  // third bespoke ticket layout (JobDetail had two more of its own). Opening
  // the same job from the board, from My Tasks and from a link now renders the
  // SAME component. Board-only tools (merge, UUID link, watch) ride in the
  // extras slot; nothing was lost, it just stopped being a separate design.
  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(3,8,16,0.75)', zIndex:900,
               display:'flex', justifyContent:'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'100%', maxWidth:560, background:'#0f1729', overflowY:'auto',
                 borderLeft:'1px solid #2a3b56' }}>
        <TicketSheet
          job={job}
          userEmail={userEmail}
          accessToken={accessToken}
          busy={moving}
          onClose={onClose}
          onOpenScheduler={() => onSchedule(job)}
          onSchedulePrimary={
            ['ready_to_schedule','return_pending','scheduled'].includes(job.status)
              ? () => onSchedule(job) : null
          }
          onMove={async (target, note) => { await onStatusMove(job.id, target, note); }}
          onAssigned={onAssigned}
          extras={
            <div style={{ marginTop: 14, display:'flex', flexDirection:'column', gap: 10 }}>
              <button onClick={() => onWatch?.(job)}
                style={{ background:'transparent', color:'#f59e0b', border:'1px solid #f59e0b55',
                         borderRadius:8, padding:'9px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                👁 Watch this
              </button>
              <UUIDLinker job={job} onLinked={onUUIDLinked} />
              <MergeTool job={job} allJobs={allJobs} onMerge={onMerge}
                accessToken={accessToken} userEmail={userEmail} />
            </div>
          }
        />
      </div>
    </div>
  );
}

function JobCard({ job, onSelect, onQuickMove, moving }) {
  const si = STATUS_INFO[job.status] || {};
  const isUrgent = job.priority === 'urgent';
  const isHigh = job.priority === 'high';
  const hasUUID = !!job.customer_id;
  const quickVerbs = SUGGESTED_NEXT[job.status] ? [SUGGESTED_NEXT[job.status]] : [];

  // 72h rule — see src/utils/staleness.js. A card nobody has touched in 3 days
  // gets an amber rail; a week gets red. The status chip used to be the loudest
  // thing on the card, but "New" tells you nothing you can act on. WHO owns it,
  // HOW LONG it's been sitting, and WHETHER IT'S ROTTING do.
  const stale = stalenessOf(job);
  const staleColor = STALE_COLOR[stale.level];
  const rail = isUrgent ? '#ef4444' : (staleColor || si.color || '#334155');

  return (
    <div onClick={() => onSelect(job)}
      style={{ position:'relative', background:'#1e293b', borderRadius:8, padding:13, paddingLeft:17, marginBottom:8, cursor:'pointer', overflow:'hidden', opacity:['dead','lost'].includes(job.status)?0.55:1 }}>
      <div className={stale.level === 'very_stale' ? 'ow-verystale' : stale.level === 'stale' ? 'ow-stale' : undefined}
        style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:rail }} />

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:5 }}>
        <div style={{ fontSize:16, fontWeight:600, color:'#fff', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{job.customer_name||'—'}</div>
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          {isUrgent && <span style={{ background:'#ef4444', color:'#fff', fontSize:11, fontWeight:700, padding:'2px 6px', borderRadius:4 }}>URGENT</span>}
          {isHigh && <span style={{ background:'#f59e0b', color:'#000', fontSize:11, fontWeight:700, padding:'2px 6px', borderRadius:4 }}>HIGH</span>}
          {!hasUUID && <span style={{ background:'#f59e0b', color:'#000', fontSize:11, fontWeight:800, padding:'2px 6px', borderRadius:4 }}>⚠️ NO CLIENT</span>}
        </div>
      </div>

      {!hasUUID && (
        <div style={{ background:'#78350f44', border:'1px solid #f59e0b', borderRadius:6, padding:'6px 9px', marginBottom:8 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#fbbf24' }}>Not linked to a customer</div>
          <div style={{ fontSize:12, color:'#fcd34d' }}>{missingLabel(job)}</div>
        </div>
      )}

      <div style={{ fontSize:14, color:'#cbd5e1', marginBottom:8, lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{stripIntakeTemplate(job.issue)||'no issue noted'}</div>

      {/* THE STICKY LINE — who owns it, when it hit the board, how stale it is.
          This never truncates and never collapses; it's the whole point of the card. */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
        {/* assigneeOf(), NOT job.tech_name. Assigning writes assigned_to; this
            line read tech_name, so every assignment made since migration 030
            left the card still reading "Unassigned". Two columns, one meaning,
            and the card was reading the wrong one. */}
        {(() => { const who = assigneeOf(job); return who
          ? <span style={{ fontSize:13, fontWeight:700, color:'#60a5fa', background:'#1e3a8a44', padding:'3px 8px', borderRadius:5 }}>{who}</span>
          : <span style={{ fontSize:13, fontWeight:700, color:'#fbbf24', background:'#78350f44', padding:'3px 8px', borderRadius:5 }}>Unassigned</span>; })()}
        <span style={{ fontSize:13, color:'#cbd5e1' }}>on board {ageLabel(job.created_at)}</span>
        {/* A pencilled-in hold. Amber, and deliberately NOT the same shape as a
            scheduled date — a hold is not a booking, and the day two crews turn
            up in one place is the day those two things looked alike. */}
        {job.tentative_date && isHeld(job) && (
          <span style={{ fontSize:12, fontWeight:700, color:'#f59e0b', background:'#78350f44',
                         padding:'3px 8px', borderRadius:5, whiteSpace:'nowrap' }}>
            ✏️ tent {new Date(job.tentative_date).toLocaleDateString('en-US', { month:'short', day:'numeric' })}
          </span>
        )}
        {staleColor && (
          <span className={stale.level === 'very_stale' ? 'ow-verystale' : 'ow-stale'}
            style={{ fontSize:12, fontWeight:700, color:staleColor, background:`${staleColor}22`, padding:'3px 8px', borderRadius:5, whiteSpace:'nowrap' }}>
            ⏱ {stale.label}
          </span>
        )}
      </div>

      {/* Status + money demoted to the quiet row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:12, fontWeight:600, color:si.color||'#94a3b8', background:`${si.color||'#334155'}18`, padding:'2px 7px', borderRadius:5, whiteSpace:'nowrap' }}>
            {si.icon} {si.label||job.status}
          </span>
          {job.estimate_amount>0 && <span style={{ fontSize:12, fontWeight:600, color:'#22c55e' }}>{fmtMoney(job.estimate_amount)}</span>}
        </div>
        {quickVerbs.length > 0 && (
          <button onClick={e => { e.stopPropagation(); onQuickMove(job, quickVerbs[0]); }} disabled={moving}
            title={`Move to ${STATUS_INFO[quickVerbs[0]]?.label||quickVerbs[0]}`}
            style={{ padding:'4px 9px', borderRadius:5, border:`1px solid ${STATUS_INFO[quickVerbs[0]]?.color||'#334155'}`, background:'transparent', color:STATUS_INFO[quickVerbs[0]]?.color||'#94a3b8', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
            move → {STATUS_INFO[quickVerbs[0]]?.label||quickVerbs[0]}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Column ─────────────────────────────────────────────────────────────────────
function AccordionColumn({ col, jobs, expanded, onToggle, onSelect, onQuickMove, moving }) {
  const totalEstimate = jobs.filter(j=>j.estimate_amount>0).reduce((s,j)=>s+j.estimate_amount,0);
  return (
    <div style={{ borderBottom: '1px solid #1e293b' }}>
      <div onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', cursor: 'pointer', background: expanded ? '#111f34' : 'transparent',
          borderLeft: `4px solid ${col.color}`,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#cbd5e1', fontSize: 12, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{col.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {totalEstimate > 0 && <span style={{ fontSize: 12, color: '#22c55e' }}>{fmtMoney(totalEstimate)}</span>}
          <span style={{ background: col.color, color: '#000', padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>{jobs.length}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '4px 12px 14px', background: '#0f172a' }}>
          {jobs.length === 0
            ? <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20, fontSize: 12 }}>empty</div>
            : jobs.map(j => <JobCard key={j.id} job={j} onSelect={onSelect} onQuickMove={onQuickMove} moving={moving} />)
          }
        </div>
      )}
    </div>
  );
}

function Column({ col, jobs, onSelect, onQuickMove, moving, activeCol, setActiveCol }) {
  const totalEstimate = jobs.filter(j=>j.estimate_amount>0).reduce((s,j)=>s+j.estimate_amount,0);
  return (
    <div style={{ flex:1, minWidth:260, maxWidth:340, display:'flex', flexDirection:'column' }}>
      <div onClick={() => setActiveCol(col.key)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'#0f172a', borderBottom:`3px solid ${col.color}`, borderRadius:'8px 8px 0 0', cursor:'pointer' }}>
        <span style={{ color:'#fff', fontWeight:600, fontSize:13 }}>{col.label}</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {totalEstimate>0 && <span style={{ fontSize:11, color:'#22c55e' }}>{fmtMoney(totalEstimate)}</span>}
          <span style={{ background:col.color, color:'#000', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700 }}>{jobs.length}</span>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:10, background:'#0f172a', borderRadius:'0 0 8px 8px' }}>
        {jobs.length===0
          ? <div style={{ color:'#94a3b8', textAlign:'center', padding:20, fontSize:12 }}>empty</div>
          : jobs.map(j => <JobCard key={j.id} job={j} onSelect={onSelect} onQuickMove={onQuickMove} moving={moving} />)
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
const STALE_PULSE_CSS = `
@keyframes ow-stale-pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
.ow-stale     { animation: ow-stale-pulse 2.4s ease-in-out infinite; }
.ow-verystale { animation: ow-stale-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .ow-stale, .ow-verystale { animation:none; } }`;

// Real steps against real elements — data-tour targets tagged above. Every
// operator lands here now, so this is the walkthrough that matters most.
const BOARD_SPOTLIGHT_STEPS = [
  { target: 'col-triage',    title: '📝 New / Notes',
    body: 'Not actionable yet — needs info, parts, or a decision before anyone can move it forward.' },
  { target: 'col-ready',     title: '✅ Ready to Schedule',
    body: 'Good to go. Someone just needs to put it on a calendar — that\'s the next lane over.' },
  { target: 'col-tentative', title: '✏️ Tentative',
    body: 'Pencilled in on the Tent calendar, nobody booked yet. Tapping a card here opens the scheduler, same as everywhere.' },
  { target: 'col-scheduled', title: '📅 Scheduled',
    body: 'A tech is booked and it\'s on their calendar. This can only get set by actually booking — never by hand.' },
  { target: 'board-assigned-filter', title: 'Filter by person',
    body: 'Tap a name to see just their open work, or "Nobody" to find things nobody has claimed yet.' },
  { target: 'board-search', title: 'Search',
    body: 'Customer name, issue text, or CMS number — whatever you remember about the job.' },
  { target: 'whos-stuck', title: "Who's stuck",
    body: 'Jumps to the home screen section showing who has the oldest work sitting with no movement.' },
  { target: 'my-tasks-link', title: 'My Tasks',
    body: 'Your own to-do list — separate from the board. Notes, hand-offs, and things you\'re personally tracking live here.' },
];

// TOUR_BUILD-style versioning, same pattern Tour.jsx already uses — bump this
// string and everyone sees the walkthrough again next time something here
// changes meaningfully.
const SPOTLIGHT_BUILD = '9.11.6';
const spotlightKey = (email) => `ow_board_spotlight_${SPOTLIGHT_BUILD}_${(email || '').toLowerCase()}`;

export default function BoardView({ accessToken, onBack, userEmail, userName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showSpotlight, setShowSpotlight] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(spotlightKey(userEmail))) setShowSpotlight(true);
    } catch { /* private browsing — just don't auto-show */ }
  }, [userEmail]);
  const closeSpotlight = () => {
    setShowSpotlight(false);
    try { localStorage.setItem(spotlightKey(userEmail), new Date().toISOString()); } catch {}
  };
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  // Refs so tapping a stat card (e.g. "returns") actually moves the board to
  // that column instead of just tinting a tab somewhere off-screen.
  const colRefs = useRef({});
  // The staleness wall — Sara's, not mine. Persisted per-person.
  const [staleDays, setStaleDaysState] = useState(() => {
    const d = getStaleDays();
    return d === null ? 'off' : String(d);
  });
  const changeStaleWall = (key) => { setStaleDays(key); setStaleDaysState(key); };
  const focusColumn = (key) => {
    setActiveCol(key);
    setExpandedCol(key);                       // mobile: open the accordion
    const el = colRefs.current[key];
    if (el) el.scrollIntoView({ behavior:'smooth', inline:'start', block:'nearest' });
  };
  const [schedulingJob, setSchedulingJob] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [activeCol, setActiveCol] = useState('triage');
  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState(null);
  const [toast, setToast] = useState('');
  const [stats, setStats] = useState({ total_open:0, needs_action:0, to_bill:0, returns_pending:0 });
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [expandedCol, setExpandedCol] = useState('triage'); // accordion: which section is open on mobile

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''), 2400); };

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const ACTIVE = ['new','needs_details','needs_parts','pending_materials','pending_decision','blocked','needs_estimate','estimate_sent','ready_to_schedule','return_pending','scheduled','complete','to_bill','won'];
      const { data, error } = await supabase.from('jobs').select('*').in('status', ACTIVE).order('created_at',{ascending:true}).limit(500);
      if (error) throw error;
      // last_note_at — the last time a human actually SAID something about this
      // job. This is what the staleness rule measures, NOT updated_at.
      const ids = (data || []).map(x => x.id);
      let lastNote = {};
      if (ids.length) {
        const { data: notes } = await supabase
          .from('job_history')
          .select('job_id, changed_at')
          .in('job_id', ids)
          .not('notes', 'is', null)
          .order('changed_at', { ascending: false });
        (notes || []).forEach(n => { if (!lastNote[n.job_id]) lastNote[n.job_id] = n.changed_at; });
      }
      setJobs((data || []).map(j => ({ ...j, last_note_at: lastNote[j.id] || null })));
      const j = data||[];
      setStats({
        total_open: j.length,
        needs_action: j.filter(x=>['new','needs_details','needs_parts','needs_estimate'].includes(x.status)).length,
        to_bill: j.filter(x=>['complete','to_bill'].includes(x.status)).length,
        returns_pending: j.filter(x=>x.status==='return_pending').length,
      });
    } catch(e) { console.error('loadJobs:', e); }
    setLoading(false);
  }, []);

  const loadTechs = useCallback(async () => {
    try {
      let list = await techsApi.getAll();
      // Fallback: if is_active filtering returned nothing, load every tech row
      if (!list || list.length === 0) {
        const { data } = await supabase.from('techs').select('*').order('name');
        list = data || [];
      }
      setTechs(list);
    } catch (e) {
      console.warn('techs:', e);
      try {
        const { data } = await supabase.from('techs').select('*').order('name');
        setTechs(data || []);
      } catch {}
    }
  }, []);

  useEffect(() => { loadJobs(); loadTechs(); }, [loadJobs, loadTechs]);

  // ── Deep link: /board?job=<jobs.id> ─────────────────────────────────────
  // ONE handler. There used to be two — one added for the 🔗 Link button and
  // an older one for the assign-by-SMS links — and they fought. The old one
  // called navigate('/board') to strip the ?job= param SYNCHRONOUSLY while its
  // own fetch was still in flight, which re-triggered both effects with no
  // param, and the card opened and then vanished. That was the "flash".
  //
  // Now: fire once, fetch the job directly by id (loadJobs only pulls ACTIVE
  // statuses capped at 500, so a link to a billed/dead/older job must not
  // depend on the list), open it, and only THEN clear the param.
  const deepJobId = new URLSearchParams(location.search).get('job');
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (!deepJobId || deepLinkDone.current) return;
    deepLinkDone.current = true;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', deepJobId).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        showToast('That job could not be found');
      } else {
        setSelectedJob(data);
      }
      // Strip the param only AFTER the card is open, so closing it and moving
      // around the board doesn't keep reopening the same job.
      navigate('/board', { replace: true });
    })();
    return () => { cancelled = true; };
  }, [deepJobId, navigate]);

  // Status move — no note required, never touches created_at
  const moveStatus = useCallback(async (jobId, newStatus, note = null) => {
    setMoving(true);
    try {
      // changeStatus writes the history row too, so the "why" typed into the
      // ticket sheet actually travels with the card instead of being dropped.
      await jobsApi.changeStatus(jobId, newStatus, userEmail || 'info@drhsecurityservices.com', note);
      setJobs(prev => prev.map(j => j.id===jobId ? {...j, status:newStatus} : j));
      setSelectedJob(prev => prev?.id===jobId ? {...prev, status:newStatus} : prev);
      showToast(`→ ${STATUS_INFO[newStatus]?.label||newStatus}`);
    } catch(e) { showToast(`Error: ${e.message}`); }
    setMoving(false);
  }, [userEmail]);

  const quickMove = useCallback(async (job, verb) => {
    await moveStatus(job.id, verb);
  }, [moveStatus]);

  const handleUUIDLinked = useCallback((customerId) => {
    if (!selectedJob) return;
    setJobs(prev => prev.map(j => j.id===selectedJob.id ? {...j, customer_id:customerId} : j));
    setSelectedJob(prev => prev ? {...prev, customer_id:customerId} : prev);
    showToast('Customer linked ✓');
  }, [selectedJob]);

  const handleMerge = useCallback((deadJobId, survivorId) => {
    setJobs(prev => prev.map(j => j.id===deadJobId ? {...j, status:'dead'} : j));
    setSelectedJob(null);
    showToast('Marked as duplicate ✓');
  }, []);

  // null = everyone. '__none__' = jobs with nobody on them, which is its own
  // kind of problem and worth being able to see on purpose.
  const assigneeMatch = (j) => {
    if (!assigneeFilter) return true;
    if (assigneeFilter === '__none__') return !assigneeOf(j);
    return assigneeOf(j) === assigneeFilter;
  };

  // Put a board card into MY Tasks → Watching without taking ownership. She is
  // not the assignee and the job does not move; she just stops having to
  // remember to come back and check on it.
  const watchInMyTasks = useCallback(async (job) => {
    try {
      const { error } = await supabase.from('notes').insert([{
        body: job.customer_name || 'Job',
        author_email: canonicalEmail(userEmail),
        job_id: job.id,
        lane: 'watching',
        status: 'open',
        last_seen_status: job.status,
      }]);
      // Unique index (migration 032) means a second watch on the same job is a
      // conflict, not a duplicate card. Say so rather than failing silently.
      if (error) { showToast(/duplicate|unique/i.test(error.message) ? 'Already in My Tasks' : 'Could not add'); return; }
      showToast('Watching in My Tasks ✓');
    } catch (e) { showToast('Could not add'); }
  }, [userEmail]);

  // The WRITE moved into TicketSheet (one control, every surface). This only
  // syncs the board's local copy so the card repaints without a full reload.
  const onAssigned = useCallback((jobId, email) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, assigned_to: email } : j));
    setSelectedJob(prev => prev && prev.id === jobId ? { ...prev, assigned_to: email } : prev);
    showToast(email ? `Assigned to ${NAME_BY_EMAIL[email] || email} \u2713` : 'Unassigned \u2713');
  }, []);

  const filtered = search
    ? jobs.filter(j => assigneeMatch(j) && (
        (j.customer_name||'').toLowerCase().includes(search.toLowerCase()) ||
        (j.issue||'').toLowerCase().includes(search.toLowerCase()) ||
        (j.cms_account_id||'').toLowerCase().includes(search.toLowerCase())
      ))
    : jobs.filter(assigneeMatch);

  // Oldest first, in every column. The board loaded newest-first, which meant
  // the thing that landed this morning sat above the job that has been rotting
  // for six weeks — so the work most likely to be forgotten was the work you
  // had to scroll to find. Flipping it puts the oldest card at the top of
  // every lane, where it is impossible to ignore.
  //
  // Sorted on created_at (when the job appeared), NOT last_note_at. A stale job
  // that somebody left a comment on yesterday is still a stale job; letting a
  // note push it down the column is exactly how it gets lost again. The
  // staleness pulse already flags neglect separately.
  const byOldest = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0);

  const buckets = COLUMNS.reduce((acc, col) => {
    if (col.virtual === 'tentative') {
      // Held but not yet booked. Sorted by the HELD DATE, soonest first —
      // a hold three days out matters more than one in six weeks.
      acc[col.key] = filtered
        .filter(isHeld)
        .sort((a, b) => new Date(a.tentative_date) - new Date(b.tentative_date));
      return acc;
    }
    // A job with a hold shows in Tentative, not in its status column, so it
    // isn't in two places at once.
    acc[col.key] = filtered
      .filter(j => col.statuses.includes(j.status))
      .filter(j => !isHeld(j))
      .sort(byOldest);
    return acc;
  }, {});

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#fff', display:'flex', flexDirection:'column' }}>
      <style>{STALE_PULSE_CSS}</style>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #1e293b' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onBack} style={{ background:'#1e293b', border:'none', color:'#94a3b8', padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:13 }}>← Home</button>
          {/* Straight to Who's stuck. "← Home" technically got you there, but
              it drops you at the top of the page and you have to scroll past
              the warnings to find the person you were thinking about. */}
          <button data-tour="whos-stuck" onClick={() => navigate('/?focus=people')}
            style={{ background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0', padding:'7px 14px',
                     borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            👥 Who's stuck
          </button>
          <button data-tour="my-tasks-link" onClick={() => navigate('/people')}
            style={{ background:'#1e293b', border:'1px solid #334155', color:'#e2e8f0', padding:'7px 14px',
                     borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            🗂️ My Tasks
          </button>
          {/* Real walkthrough — points at the actual buttons, not a picture of
              them. Separate from the shared "?" (which still opens the plain
              text guide) because "explain it" and "show me on the real
              screen" are different asks. */}
          <button onClick={() => setShowSpotlight(true)}
            style={{ background:'#00c8e822', border:'1px solid #00c8e8', color:'#00c8e8', padding:'7px 14px',
                     borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 }}>
            ▶ Show me around
          </button>
          <span style={{ fontWeight:700, fontSize:16 }}>📋 Board</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowNewJob(true)} style={{ background:'#22c55e', border:'none', color:'#fff', padding:'8px 16px', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:13 }}>+ New Job</button>
          <button onClick={loadJobs} disabled={loading} style={{ background:'#1e293b', border:'none', color:'#94a3b8', padding:'8px 14px', borderRadius:8, cursor:'pointer', fontSize:13 }}>{loading?'…':'↻'}</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, padding:'10px 16px', borderBottom:'1px solid #1e293b', flexWrap:'wrap', alignItems:'center' }}>
        {[
          { label:'open',     val:stats.total_open,       color:'#cbd5e1', col:null },
          { label:'new/notes',val:buckets.triage?.length||0,    color:'#ef4444', col:'triage' },
          { label:'returns',  val:stats.returns_pending,  color:'#ec4899', col:'ready' },
        ].map(s=>(
          <button key={s.label} onClick={() => s.col && focusColumn(s.col)}
            style={{ background: activeCol===s.col && s.col ? '#334155' : '#1e293b', padding:'6px 14px', borderRadius:8, border: activeCol===s.col && s.col ? `1px solid ${s.color}` : '1px solid transparent', cursor: s.col ? 'pointer' : 'default', textAlign:'left', fontFamily:'inherit' }}>
            <div style={{ fontSize:11, color:'#94a3b8', textTransform:'uppercase', letterSpacing:0.4 }}>{s.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.val}</div>
          </button>
        ))}
        <div data-tour="board-assigned-filter" style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'#94a3b8', textTransform:'uppercase', letterSpacing:0.4 }}>assigned</span>
          {[{ key:null, label:'All' },
            ...ASSIGNEES.map(a => ({ key:a.name, label:a.name })),
            { key:'__none__', label:'Nobody' }].map(o => (
            <button key={o.label} onClick={() => setAssigneeFilter(o.key)}
              style={{
                background: assigneeFilter === o.key ? '#00c8e8' : '#1e293b',
                color: assigneeFilter === o.key ? '#0f172a' : '#94a3b8',
                border:'none', borderRadius:20, padding:'5px 12px',
                fontSize:11, fontWeight:700, cursor:'pointer',
              }}>{o.label}</button>
          ))}
        </div>

        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, background:'#1e293b', borderRadius:8, padding:'6px 10px' }}>
            <span style={{ fontSize:11, color:'#94a3b8', textTransform:'uppercase', letterSpacing:0.4, whiteSpace:'nowrap' }}>flag silent after</span>
            <select value={staleDays} onChange={e => changeStaleWall(e.target.value)}
              style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:6, color:'#e2e8f0', fontSize:13, padding:'3px 6px', cursor:'pointer' }}>
              {STALE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <input data-tour="board-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search customer, issue, CMS…"
            style={{ padding:'6px 12px', borderRadius:8, border:'1px solid #1e293b', background:'#1e293b', color:'#fff', fontSize:13, width:200 }} />
        </div>
      </div>

      {!isMobile && (
        <div style={{ display:'flex', overflowX:'auto', borderBottom:'1px solid #1e293b' }}>
          {COLUMNS.map(col => (
            <button key={col.key} onClick={() => focusColumn(col.key)}
              style={{ padding:'10px 14px', background:'none', border:'none', whiteSpace:'nowrap', borderBottom:activeCol===col.key?`2px solid ${col.color}`:'2px solid transparent', color:activeCol===col.key?col.color:'#94a3b8', cursor:'pointer', fontSize:12, fontWeight:activeCol===col.key?700:400 }}>
              {col.label} <span style={{ background:'#1e293b', padding:'1px 6px', borderRadius:10, fontSize:10 }}>{buckets[col.key]?.length||0}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:14 }}>Loading from Supabase…</div>
      ) : isMobile ? (
        <div style={{ flex:1, overflowY:'auto', paddingBottom:84 }}>
          {COLUMNS.map(col => (
            <div key={col.key} data-tour={`col-${col.key}`} ref={el => { colRefs.current[col.key] = el; }}>
              <AccordionColumn
                col={col} jobs={buckets[col.key]||[]}
                expanded={expandedCol===col.key}
                onToggle={() => setExpandedCol(prev => prev===col.key ? null : col.key)}
                onSelect={setSelectedJob} onQuickMove={quickMove} moving={moving}
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', gap:12, padding:'14px 14px 84px', overflowX:'auto', overflowY:'hidden', scrollPaddingLeft:14 }}>
          {COLUMNS.map(col => (
            <div key={col.key} data-tour={`col-${col.key}`} ref={el => { colRefs.current[col.key] = el; }} style={{ display:'flex', minWidth:0 }}>
              <Column col={col} jobs={buckets[col.key]||[]} onSelect={setSelectedJob} onQuickMove={quickMove} moving={moving} activeCol={activeCol} setActiveCol={setActiveCol} />
            </div>
          ))}
        </div>
      )}

      {showSpotlight && (
        <Spotlight steps={BOARD_SPOTLIGHT_STEPS} onDone={closeSpotlight} onSkip={closeSpotlight} />
      )}

      {selectedJob && (
        <DetailDrawer
          job={selectedJob} techs={techs} accessToken={accessToken} moving={moving} userEmail={userEmail} onWatch={watchInMyTasks} onAssigned={onAssigned}
          allJobs={jobs}
          onStatusMove={(jobId, verb, note) => { moveStatus(jobId, verb, note); setSelectedJob(null); }}
          onSchedule={job => { setSelectedJob(null); setSchedulingJob(job); }}
          onClose={() => setSelectedJob(null)}
          onUUIDLinked={handleUUIDLinked}
          onMerge={handleMerge}
          onRenamed={(jobId, name) => {
            setJobs(prev => prev.map(j => j.id===jobId ? {...j, customer_name:name} : j));
            setSelectedJob(prev => prev?.id===jobId ? {...prev, customer_name:name} : prev);
          }}
        />
      )}

      {schedulingJob && (
        <VisualSchedulerModal job={schedulingJob} techs={techs} accessToken={accessToken} userEmail={userEmail}
          onScheduled={() => { setSchedulingJob(null); loadJobs(); showToast('Scheduled ✓'); }}
          onClose={() => setSchedulingJob(null)} />
      )}

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onCreated={() => { setShowNewJob(false); loadJobs(); showToast('Job created ✓'); }}
          onClose={() => setShowNewJob(false)} />
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'#1e293b', border:'1px solid #334155', color:'#fff', padding:'10px 20px', borderRadius:10, fontSize:13, fontWeight:500, zIndex:9999, boxShadow:'0 4px 24px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
