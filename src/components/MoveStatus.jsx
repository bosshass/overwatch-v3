// ============================================
// MoveStatus — bidirectional status control
// ============================================
// Drops onto ANY card, on ANY screen (board, triage, calendar detail).
// Lets any role move a job to any appropriate status — FORWARD or BACKWARD —
// and requires a note when the move goes backward or bounces to another team,
// so the reason travels with the card in job_history.
//
// The data layer already supports this: jobsApi.changeStatus(id, status, by, note)
// is direction-agnostic and logs history. This is just the UI that exposes it.
//
// Example the business actually hits: billing opens a To Bill card, reads the
// thread, realizes it isn't billable yet, and moves it BACK to Ready to Schedule
// with "sent back — needs panel swap first." Shana sees it in her queue with
// that note on top.

import { useState } from 'react';
import { jobsApi, JOB_STATUS } from '../services/supabase.js';

// Curated move targets per current status. Only the transitions that make
// business sense are offered — but both directions are first-class.
// `back: true` marks a backward/bounce move, which forces a note.
const MOVES = {
  [JOB_STATUS.NEW]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.NEEDS_ESTIMATE,    label: 'Needs Estimate' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked' },
  ],
  [JOB_STATUS.NEEDS_ESTIMATE]: [
    { to: JOB_STATUS.ESTIMATE_SENT,     label: 'Estimate Sent' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.NEW,               label: 'Back to New', back: true },
  ],
  [JOB_STATUS.ESTIMATE_SENT]: [
    { to: JOB_STATUS.WON,               label: 'Won → Ready to Schedule' },
    { to: JOB_STATUS.LOST,              label: 'Lost', back: true },
    { to: JOB_STATUS.NEEDS_ESTIMATE,    label: 'Re-quote', back: true },
  ],
  [JOB_STATUS.WON]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
  ],
  [JOB_STATUS.NEEDS_PARTS]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Parts in → Ready to Schedule' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.PENDING_MATERIALS]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.BLOCKED]: [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Unblock → Ready to Schedule' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts' },
  ],
  [JOB_STATUS.READY_TO_SCHEDULE]: [
    { to: JOB_STATUS.SCHEDULED,         label: 'Scheduled' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts', back: true },
    { to: JOB_STATUS.BLOCKED,           label: 'Blocked', back: true },
  ],
  [JOB_STATUS.SCHEDULED]: [
    { to: JOB_STATUS.TO_BILL,           label: 'Done → To Bill' },
    { to: JOB_STATUS.RETURN_PENDING,    label: 'Needs Return' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Back to Scheduling', back: true },
  ],
  [JOB_STATUS.RETURN_PENDING]: [
    { to: JOB_STATUS.SCHEDULED,         label: 'Scheduled' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
  ],
  [JOB_STATUS.COMPLETE]: [
    { to: JOB_STATUS.TO_BILL,           label: 'To Bill' },
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Back to Scheduling', back: true },
  ],
  [JOB_STATUS.TO_BILL]: [
    { to: JOB_STATUS.BILLED,            label: 'Billed ✓' },
    // The bounce-back the billing team needs:
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Send back to Scheduling', back: true },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Send back — needs parts', back: true },
  ],
  [JOB_STATUS.BILLED]: [
    { to: JOB_STATUS.TO_BILL,           label: 'Reopen billing', back: true },
  ],
};

// Which swim lane each status lives in. The move buttons said things like
// "Ready to Schedule" and "To Bill" while the board showed Triage / Ready /
// Tentative / Scheduled / Estimates — so you had to translate between two
// vocabularies for the same thing. Every move now names the lane it lands in.
export const LANE_OF = {
  new:'Triage', needs_details:'Triage', needs_parts:'Triage',
  pending_materials:'Triage', pending_decision:'Triage', blocked:'Triage',
  ready_to_schedule:'Ready', return_pending:'Ready',
  scheduled:'Scheduled',
  needs_estimate:'Estimates', estimate_sent:'Estimates', won:'Estimates',
  complete:'Billing', to_bill:'Billing', billed:'Billing',
};

const LABEL = {
  new:'New', needs_details:'Needs Details', needs_parts:'Waiting on Parts',
  pending_decision:'Pending', pending_materials:'Waiting on Materials',
  ready_to_schedule:'Ready to Schedule', return_pending:'Return Pending',
  scheduled:'Scheduled', complete:'Complete', to_bill:'To Bill', billed:'Billed',
  needs_estimate:'Needs Estimate', estimate_sent:'Estimate Sent', won:'Won',
  lost:'Lost', blocked:'Blocked', dead:'Dead', archived:'Archived',
};

export default function MoveStatus({ job, userEmail, onMoved, onRequestSchedule }) {
  const [picking, setPicking]   = useState(null);   // the pending move target
  const [note, setNote]         = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  // FALLBACK. MOVES only covered nine statuses — needs_details,
  // pending_decision, lost, dead and archived had no entry, so this component
  // returned null and the ticket opened with NO way to change status at all.
  // Silently rendering nothing is the worst answer: the card looks broken and
  // the person assumes the app can't do it.
  //
  // Anything without a curated set now gets the common next steps, so every
  // ticket can always be moved.
  const FALLBACK = [
    { to: JOB_STATUS.READY_TO_SCHEDULE, label: 'Ready to Schedule' },
    { to: JOB_STATUS.NEEDS_PARTS,       label: 'Waiting on Parts' },
    { to: JOB_STATUS.NEEDS_ESTIMATE,    label: 'Needs Estimate' },
    { to: JOB_STATUS.TO_BILL,           label: 'Done → To Bill' },
    { to: JOB_STATUS.DEAD,              label: 'Dead / Cancel', back: true },
  ].filter(m => m.to && m.to !== job.status);

  const moves = (MOVES[job.status] && MOVES[job.status].length)
    ? MOVES[job.status]
    : FALLBACK;

  const commit = async (move) => {
    // SCHEDULED IS NOT A STATUS YOU CAN JUST SET.
    // Marking a job scheduled by hand produced exactly what we found in the
    // data: nine "scheduled" jobs, two with no date at all, three whose date
    // had passed, three with no calendar event. The status said the work was
    // booked; nothing was booked. So this move opens the scheduler instead —
    // pick a tech and a slot, or link the calendar event somebody already made.
    if (move.to === JOB_STATUS.SCHEDULED) {
      if (onRequestSchedule) { onRequestSchedule(); setPicking(null); return; }
      setErr('Use the Schedule button — a job can only become Scheduled by booking it.');
      return;
    }
    // Backward / bounce moves require a note so the reason travels with the card.
    if (move.back && !note.trim()) { setErr('A note is required to send this back.'); return; }
    setBusy(true); setErr('');
    try {
      await jobsApi.changeStatus(job.id, move.to, userEmail || 'unknown', note.trim() || null);
      setPicking(null); setNote('');
      onMoved?.(move.to);
    } catch (e) {
      setErr(e.message || 'Move failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', marginBottom: 2 }}>
        What's next for this ticket?
      </div>
      <div style={{ fontSize: 11, color: '#8497b0', marginBottom: 8 }}>
        Currently <b style={{ color: '#cbd5e1' }}>{LABEL[job.status] || job.status}</b> — pick where it goes.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {moves.map(m => (
          <button key={m.to}
            onClick={() => { setPicking(picking?.to === m.to ? null : m); setErr(''); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${m.back ? '#d9770655' : '#2a3f5c'}`,
              background: picking?.to === m.to ? (m.back ? '#d97706' : '#3b82f6') : (m.back ? '#d977060f' : '#0e1a2b'),
              color: picking?.to === m.to ? '#fff' : (m.back ? '#fcd34d' : '#8497b0'),
            }}>
            {m.back ? '↩ ' : ''}{m.label}
            {m.to === JOB_STATUS.SCHEDULED && <span style={{ opacity: 0.7, fontWeight: 500 }}> · books it</span>}
            {LANE_OF[m.to] && LANE_OF[m.to] !== LANE_OF[job.status] && m.to !== JOB_STATUS.SCHEDULED
              && <span style={{ opacity: 0.6, fontWeight: 500 }}> · {LANE_OF[m.to]}</span>}
          </button>
        ))}
      </div>

      {picking && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={picking.back ? 'Why is this going back? (required)' : 'Add a note (optional)'}
            rows={2}
            style={{
              width: '100%', background: '#0a121f', border: `1px solid ${picking.back ? '#d97706' : '#1e2f47'}`,
              borderRadius: 8, color: '#eaf1fb', fontSize: 13, padding: '8px 10px', resize: 'vertical',
              fontFamily: 'inherit',
            }} />
          {err && <div style={{ color: '#ff8a85', fontSize: 11, marginTop: 4 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => commit(picking)} disabled={busy}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: picking.back ? '#d97706' : '#3b82f6', color: '#fff', fontWeight: 800, fontSize: 13 }}>
              {busy ? 'Moving…' : `Move → ${LABEL[picking.to] || picking.to}`}
            </button>
            <button onClick={() => { setPicking(null); setNote(''); setErr(''); }} disabled={busy}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #2a3f5c', cursor: 'pointer',
                background: 'transparent', color: '#8497b0', fontWeight: 700, fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
