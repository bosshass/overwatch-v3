import { useState } from 'react';
import { finishWork } from '../services/jobs';

// ============================================================================
// FinishSheet — the tech says what happened. Two outcomes, no third.
//
// This is the module v3 was missing entirely. Nothing in the app could create a
// time_entry, so:
//   · time_entries — the billing source of truth — was permanently empty
//   · every scheduled job whose date passed fell into Needs action forever
//     (lanes.js laneOf, the hasTimeEntry branch)
//   · markBilled / markNonBillable were unreachable with no rows to act on
//   · is_complete on assignments rendered a "done" badge nothing ever set
//
// WHAT THE TECH DECIDES: hours, what happened, and whether it is finished or
// needs another trip.
//
// WHAT THE TECH DOES NOT SEE: anything about billing. Per lanes.js decision 8,
// billable / non-billable is an Accounting call made later against the hours.
// Printing that field here would put a word on the tech's screen that exactly
// one other role can act on — v9's [NC] tag mistake.
//
// Hours are prefilled from the booked estimate and are a TOTAL, not a clock.
// No time in / time out: a tech reconstructing a clock at 6pm invents numbers,
// and the clock columns then look like measurements rather than guesses.
//
// Multi-tech: each tech finishes their own assignment. The job only reaches
// Good to go once every assignment is complete — one tech finishing a two-tech
// job does not mean the work is done.
// ============================================================================

const DISPOSITIONS = [
  { key: 'finished', label: 'Finished',          means: 'Work is complete. Accounting takes it from here.' },
  { key: 'return',   label: 'Needs another trip', means: 'Started but not done. Say why — it goes to Returns.' },
];

export default function FinishSheet({ job, actor, onClose, onFinished }) {
  const assignments = job.assignments || [];

  // Default to whoever matches the signed-in person, else the only assignment.
  const mine = assignments.find(
    a => a.tech?.email && actor && a.tech.email.toLowerCase() === String(actor).toLowerCase()
  );
  const [assignmentId, setAssignmentId] = useState(
    (mine || assignments[0])?.id || null
  );

  const active = assignments.find(a => a.id === assignmentId) || null;

  const [hours, setHours] = useState(
    String(active?.estimated_hours ?? job.estimated_hours ?? '')
  );
  const [disposition, setDisposition] = useState('finished');
  const [notes, setNotes] = useState('');
  const [materials, setMaterials] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pickAssignment = id => {
    setAssignmentId(id);
    const a = assignments.find(x => x.id === id);
    setHours(String(a?.estimated_hours ?? job.estimated_hours ?? ''));
  };

  const others = assignments.filter(a => a.id !== assignmentId);
  const othersDone = others.filter(a => a.is_complete).length;
  const willComplete = disposition === 'finished' && othersDone === others.length;

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await finishWork(job, {
      assignmentId,
      techName: active?.tech?.name,
      techEmail: active?.tech?.email,
      hours,
      notes,
      materials,
      disposition,
      returnReason,
      actor,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    onFinished?.(res);
    onClose?.();
  };

  if (!assignments.length) {
    return (
      <div style={S.backdrop} onClick={onClose}>
        <div style={S.modal} onClick={e => e.stopPropagation()}>
          <div style={S.head}>
            <div style={S.title}>Finish</div>
            <button style={S.x} onClick={onClose}>✕</button>
          </div>
          <div style={S.empty}>
            Nobody is assigned to this job, so there are no hours to log against
            anyone. Book it through the scheduler first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.title}>Finish</div>
            <div style={S.sub}>{job.customer?.name || job.customer_name}</div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {/* Who is logging — only shown when it could be more than one person */}
        {assignments.length > 1 && (
          <>
            <label style={S.label}>Logging for</label>
            <div style={S.whoRow}>
              {assignments.map(a => {
                const on = a.id === assignmentId;
                return (
                  <button
                    key={a.id}
                    onClick={() => pickAssignment(a.id)}
                    style={{ ...S.who, ...(on ? S.whoOn : {}) }}
                  >
                    <span style={{ ...S.dot, background: a.tech?.color || '#64748b' }} />
                    {a.tech?.name || 'Unassigned'}
                    {a.day_number > 1 && <span style={S.dayTag}>day {a.day_number}</span>}
                    {a.is_complete && <span style={S.doneTag}>done</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {active?.is_complete && (
          <div style={S.warn}>
            This assignment is already marked complete. Logging again adds a
            second time entry — use it for a genuine second visit, not a
            correction.
          </div>
        )}

        <label style={S.label}>Hours worked</label>
        <div style={S.hoursRow}>
          <input
            type="number" step="0.25" min="0" style={S.hoursInput}
            value={hours} onChange={e => setHours(e.target.value)}
          />
          <div style={S.quick}>
            {[1, 2, 4, 8].map(h => (
              <button key={h} style={S.quickBtn} onClick={() => setHours(String(h))}>
                {h}h
              </button>
            ))}
          </div>
        </div>
        <div style={S.hint}>
          {active?.estimated_hours != null
            ? `Booked at ${active.estimated_hours}h — change it to what actually happened.`
            : 'No booked estimate on this assignment.'}
        </div>

        <label style={S.label}>How did it go</label>
        <div style={S.dispRow}>
          {DISPOSITIONS.map(d => {
            const on = d.key === disposition;
            return (
              <button
                key={d.key}
                onClick={() => setDisposition(d.key)}
                style={{ ...S.disp, ...(on ? S.dispOn : {}) }}
              >
                <span style={S.dispLabel}>{d.label}</span>
                <span style={S.dispMeans}>{d.means}</span>
              </button>
            );
          })}
        </div>

        {disposition === 'return' && (
          <>
            <label style={S.label}>Why another trip</label>
            <input
              style={S.input}
              placeholder="waiting on a part, customer not home, needs a second person…"
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
            />
          </>
        )}

        <label style={S.label}>What you did</label>
        <textarea
          style={S.textarea} rows={3}
          placeholder="Replaced panel battery, tested all zones, walked the customer through the app."
          value={notes} onChange={e => setNotes(e.target.value)}
        />

        <label style={S.label}>Materials used (optional)</label>
        <input
          style={S.input}
          placeholder="1x 12V 7Ah battery, 50ft 22/4"
          value={materials} onChange={e => setMaterials(e.target.value)}
        />

        <div style={S.outcome}>
          {disposition === 'return'
            ? '→ Returns. The card stays live and says why.'
            : willComplete
              ? '→ Good to go. Field work is done; Accounting takes it from here.'
              : `→ Stays Scheduled. ${others.length - othersDone} other tech${
                  others.length - othersDone === 1 ? '' : 's'
                } still to finish.`}
        </div>

        <button
          style={{ ...S.go, ...(!Number(hours) ? S.goOff : {}) }}
          disabled={busy || !Number(hours)}
          onClick={submit}
        >
          {busy ? 'Saving…' : !Number(hours) ? 'Enter hours' : `Log ${hours}h`}
        </button>

        <div style={S.note}>
          These hours are what Accounting bills from. Whether they get charged is
          decided later, in Accounting — not here.
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 70, padding: 16 },
  modal: { background: '#111c2e', borderRadius: 14, padding: 18,
           width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  warn: { background: '#78350f', color: '#fed7aa', padding: '8px 12px', borderRadius: 8,
          marginTop: 12, fontSize: 12, lineHeight: 1.4 },
  empty: { color: '#94a3b8', fontSize: 13, marginTop: 14, lineHeight: 1.5 },

  label: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
           display: 'block', marginTop: 18, marginBottom: 6 },

  whoRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  who: { display: 'flex', alignItems: 'center', gap: 6, background: '#0b1220',
         border: '1px solid #1e293b', borderRadius: 8, padding: '7px 10px',
         color: '#cbd5e1', fontSize: 13, cursor: 'pointer' },
  whoOn: { borderColor: '#3b82f6', background: '#132038' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dayTag: { color: '#64748b', fontSize: 10 },
  doneTag: { color: '#14b8a6', fontSize: 10 },

  hoursRow: { display: 'flex', gap: 8, alignItems: 'center' },
  hoursInput: { width: 96, background: '#0b1220', color: '#e2e8f0',
                border: '1px solid #1e293b', borderRadius: 8, padding: '9px 10px',
                fontSize: 18, fontWeight: 700 },
  quick: { display: 'flex', gap: 4 },
  quickBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
              padding: '7px 10px', fontSize: 12, cursor: 'pointer' },
  hint: { color: '#475569', fontSize: 10, marginTop: 5 },

  dispRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  disp: { textAlign: 'left', background: '#0b1220', border: '1px solid #1e293b',
          borderRadius: 8, padding: '9px 11px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', gap: 2 },
  dispOn: { borderColor: '#3b82f6', background: '#132038' },
  dispLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  dispMeans: { color: '#64748b', fontSize: 11 },

  input: { width: '100%', background: '#0b1220', color: '#e2e8f0',
           border: '1px solid #1e293b', borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  textarea: { width: '100%', background: '#0b1220', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 8, padding: '9px 10px',
              fontSize: 14, resize: 'vertical', fontFamily: 'inherit' },

  outcome: { marginTop: 16, background: '#0b1220', borderRadius: 8,
             padding: '10px 12px', color: '#94a3b8', fontSize: 12, lineHeight: 1.4 },
  go: { width: '100%', marginTop: 12, background: '#14b8a6', color: '#04201d', border: 0,
        borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  goOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
  note: { color: '#475569', fontSize: 11, marginTop: 12, lineHeight: 1.4 },
};
