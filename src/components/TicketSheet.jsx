// ============================================
// TicketSheet — ONE ticket. One look. Everywhere.
// ============================================
// Opening a ticket looked different in three places because it WAS three
// components: JobDetail (with two internal branches of its own), the board's
// LANE_MOVES panel, and JobFinishSheet in the field. Same job, three layouts,
// three vocabularies for the same five destinations.
//
// Every ticket asks one question: WHERE DOES THIS GO NEXT?
// The only real difference is that some surfaces also capture hours.
//
//   board      → where next
//   my tasks   → where next
//   work today → where next + time in/out
//   billing    → where next + what's billable
//
// So: one panel, one lane picker (from utils/lanes.js), and optional sections.
// Adding a surface means passing a prop, not writing a fourth design.

import { useState } from 'react';
import { supabase } from '../services/supabase.js';
import { ASSIGNEES, assigneeOf, EMAIL_BY_NAME } from '../utils/ownership.js';
import { LANES, movesFor, laneOf, isHeld } from '../utils/lanes.js';
import { stripIntakeTemplate } from '../utils/statusMachine.js';
import NotesPanel from './NotesPanel.jsx';
import FieldVisits from './FieldVisits.jsx';

const C = {
  bg: '#0f1729', panel: '#16233a', raised: '#1b2b45', line: '#2a3b56',
  text: '#e9f1ff', muted: '#93a5bd', dim: '#64748b',
};

const Row = ({ label, children }) => children == null || children === '' ? null : (
  <div style={{ display: 'flex', gap: 12, padding: '7px 0', fontSize: 13 }}>
    <span style={{ color: C.muted, minWidth: 110, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, flex: 1, minWidth: 0 }}>{children}</span>
  </div>
);

export default function TicketSheet({
  job,
  userEmail,
  accessToken,
  onMove,            // (targetStatus, note) => Promise
  onOpenScheduler,   // (mode: 'hold' | 'book') => void
  onClose,
  onAssigned,        // (jobId, email|null) => void — let the parent refresh its list
  // Optional sections — the ONLY things that differ between surfaces.
  timeSection = null,     // Work To Do Today passes its time entry block here
  billingSection = null,  // Billing passes its unbilled-hours block here
  headerExtra = null,
  extras = null,          // surface-specific tools (merge, UUID link) — AFTER notes
  onSchedulePrimary = null, // renders the big "Open Scheduler" button when set
  busy = false,
}) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState('');
  // OWNERSHIP LIVES HERE NOW.
  // 9.11.0 rebuilt every ticket surface around this component but did not bring
  // the assign control with it — BoardView.assignTo survived as a function
  // nobody called. For fifteen versions there has been no way to assign a job
  // from any screen. It lives in the sheet itself (not passed in) so the board,
  // My Tasks and /j/ links cannot drift apart again.
  const [owner, setOwner] = useState(null);   // local echo after a write
  const [saving, setSaving] = useState(false);

  if (!job) return null;

  const here = laneOf(job);
  const moves = movesFor(job);
  // JobDetail always stripped the intake form's fixed header ("Name: Phone:
  // ... Scope of Work:") before showing the issue text — TicketSheet never
  // picked that up when it replaced JobDetail on every surface tonight, so
  // any job whose scope was never filled in past the template shows the raw
  // boilerplate verbatim. Same rule here: if nothing real was written after
  // "Scope of Work:", there is nothing to show, and the box doesn't render.
  const cleanIssue = stripIntakeTemplate(job.issue);

  // ONE rule for who owns this, from ownership.js. The board card used to read
  // job.tech_name directly, which is why assigning somebody left the card
  // reading "Unassigned" — the write went to assigned_to and the card was
  // looking at a different column.
  const ownerName = owner === '\u0000' ? null : (owner || assigneeOf(job));
  const ownerEmail = ownerName ? EMAIL_BY_NAME[ownerName.toLowerCase()] || null : null;

  // WRITES assigned_to (migration 030) — the real column. It does NOT touch
  // tech_name: that field means "who was physically on site", and overwriting
  // it to record an office assignment is how the two meanings got tangled.
  const assign = async (email) => {
    setErr(''); setSaving(true);
    try {
      const { error } = await supabase.from('jobs')
        .update({ assigned_to: email, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      if (error) throw error;
      setOwner(email ? (ASSIGNEES.find(a => a.email === email)?.name || email) : '\u0000');
      onAssigned?.(job.id, email);
    } catch (e) { setErr(e.message || 'Could not assign'); }
    finally { setSaving(false); }
  };

  const choose = async (lane) => {
    setErr('');
    // Tentative and Scheduled both need a DATE, so they hand off to the
    // scheduler rather than writing a status. A job cannot claim to be held or
    // booked without one — that is exactly how nine jobs ended up "scheduled"
    // with no date, no tech and no calendar event.
    if (lane.needsScheduler) {
      onOpenScheduler?.(lane.needsScheduler);
      return;
    }
    if (pending?.key !== lane.key) { setPending(lane); return; }
    try {
      await onMove?.(lane.target, note.trim() || null);
      setPending(null); setNote('');
    } catch (e) { setErr(e.message || 'Move failed'); }
  };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100%',
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.line}`,
                    position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {here && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: `${here.color}1f`, color: here.color, borderRadius: 20,
                            padding: '3px 10px', fontSize: 11, fontWeight: 800, marginBottom: 8 }}>
                {here.icon} {here.label}
              </div>
            )}
            <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15 }}>
              {job.customer_name || 'Unnamed'}
            </div>
            {isHeld(job) && (
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, marginTop: 5 }}>
                ✏️ Held {new Date(job.tentative_date).toLocaleDateString('en-US',
                  { weekday: 'short', month: 'short', day: 'numeric' })} — nobody booked
              </div>
            )}
          </div>
          {onClose && (
            <button onClick={onClose}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22,
                       cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
          )}
        </div>
        {headerExtra}
      </div>

      <div style={{ padding: '14px 18px 28px' }}>

        {/* ── Facts ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: '6px 14px', marginBottom: 14 }}>
          <Row label="Type">{job.job_type || 'service'}</Row>
          <Row label="Address">{job.customer_address}</Row>
          <Row label="Phone">{job.customer_phone}</Row>
          <Row label="Tech on site">{job.tech_name}</Row>{/* physical presence, NOT ownership — see the Assigned to block */}
          <Row label="Scheduled">{job.scheduled_date
            ? new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : null}</Row>
          <Row label="CMS">{job.cms_account_id}</Row>
        </div>

        {/* ── Owner — WHO IS DOING THIS. Above the issue, because an
             unowned ticket is the failure mode, not an unread one. ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
            <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                           letterSpacing: 0.6 }}>Assigned to</span>
            {ownerName
              ? <span style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa',
                               background: '#1e3a8a44', padding: '3px 10px', borderRadius: 6 }}>{ownerName}</span>
              : <span style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24',
                               background: '#78350f44', padding: '3px 10px', borderRadius: 6 }}>Unassigned</span>}
            {saving && <span style={{ fontSize: 11, color: C.dim }}>saving…</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {ASSIGNEES.map(a => {
              const on = a.email === ownerEmail;
              return (
                <button key={a.email} onClick={() => assign(a.email)} disabled={saving || busy}
                  style={{ background: on ? '#1d4ed8' : C.raised,
                           border: `1px solid ${on ? '#60a5fa' : C.line}`,
                           color: on ? '#fff' : C.text, borderRadius: 999,
                           padding: '7px 14px', fontSize: 13, fontWeight: 700,
                           cursor: 'pointer', fontFamily: 'inherit' }}>
                  {a.name}
                </button>
              );
            })}
            <button onClick={() => assign(null)} disabled={saving || busy || !ownerName}
              style={{ background: 'transparent', border: `1px dashed ${C.line}`,
                       color: C.muted, borderRadius: 999, padding: '7px 14px',
                       fontSize: 13, fontWeight: 700, cursor: ownerName ? 'pointer' : 'default',
                       opacity: ownerName ? 1 : 0.45, fontFamily: 'inherit' }}>
              Nobody
            </button>
          </div>
        </div>

        {/* ── Issue ── */}
        {cleanIssue && (
          <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                          letterSpacing: 0.6, marginBottom: 6 }}>Issue</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cleanIssue}</div>
          </div>
        )}

        {/* ── Time — only where hours are captured ── */}
        {timeSection && (
          <div style={{ marginBottom: 14 }}>{timeSection}</div>
        )}

        {/* ── Billing — only on the billing surface ── */}
        {billingSection && (
          <div style={{ marginBottom: 14 }}>{billingSection}</div>
        )}

        {/* Scheduler as a primary action for schedulable statuses */}
        {onSchedulePrimary && (
          <button onClick={() => onSchedulePrimary()}
            style={{ width: '100%', background: '#8b5cf6', border: 'none', borderRadius: 12,
                     color: '#fff', fontWeight: 800, fontSize: 14, padding: '13px 0',
                     cursor: 'pointer', marginBottom: 14 }}>
            {job.status === 'scheduled' ? '🔁 Reschedule (pick new tech + time)' : '📅 Open Scheduler (pick tech + time)'}
          </button>
        )}

        {/* ── WHERE NEXT — identical on every surface ── */}
        <div style={{ background: C.panel, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>Where does this go next?</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            {here ? <>Currently <b style={{ color: here.color }}>{here.label}</b>.</> : null} Pick one.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 7 }}>
            {moves.map(lane => {
              const armed = pending?.key === lane.key;
              return (
                <button key={lane.key} onClick={() => choose(lane)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
                           background: armed ? `${lane.color}22` : C.raised,
                           border: `1px solid ${armed ? lane.color : C.line}`,
                           borderRadius: 10, padding: '11px 13px', cursor: 'pointer',
                           color: C.text, fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 17 }}>{lane.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: lane.color }}>
                      {lane.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.35 }}>
                      {lane.needsScheduler
                        ? (lane.needsScheduler === 'hold' ? 'Opens the scheduler — pick a day to hold' : 'Opens the scheduler — pick tech + time')
                        : lane.means}
                    </span>
                  </span>
                  {armed && <span style={{ fontSize: 11, color: lane.color, fontWeight: 800 }}>confirm →</span>}
                </button>
              );
            })}
          </div>

          {pending && (
            <div style={{ marginTop: 11 }}>
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder={`Why is this moving to ${pending.label}? (optional)`}
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg,
                         border: `1px solid ${C.line}`, borderRadius: 9, color: C.text,
                         padding: '10px 12px', fontSize: 13, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => choose(pending)} disabled={busy}
                  style={{ flex: 1, background: pending.color, border: 'none', borderRadius: 9,
                           color: '#08121f', padding: '11px 0', fontSize: 13, fontWeight: 800,
                           cursor: 'pointer' }}>
                  {busy ? 'Moving…' : `Move to ${pending.label}`}
                </button>
                <button onClick={() => { setPending(null); setNote(''); }}
                  style={{ background: 'transparent', border: `1px solid ${C.line}`, borderRadius: 9,
                           color: C.muted, padding: '11px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {err && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 9 }}>{err}</div>}
        </div>

        {/* ── Field visits — the tech's actual logged time ── */}
        <FieldVisits job={job} />

        {/* ── Notes — same component, same place, every surface ── */}
        <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} />

        {/* ── Surface-specific tools (merge, UUID link) — deliberately LAST.
            They exist, they matter, and they are not the reason anyone opens
            a ticket. ── */}
        {extras}
      </div>
    </div>
  );
}
