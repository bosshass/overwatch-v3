import { useState } from 'react';
import { finishWork } from '../services/jobs';

// ============================================================================
// FinishSheet — "How did this go?"
//
// ONE question and a note. That is the whole screen.
//
// It used to ask for hours, disposition, notes and materials all at once, with
// hours as a hard gate. That is the wrong screen for a tech standing in a
// parking lot at the end of a job:
//
//   · Hours are entered in batch — often Friday, for the whole week. Forcing a
//     number here means an invented number, and invented numbers look exactly
//     like measured ones once they are in the table.
//   · Materials are remembered in the truck, not at the customer's door. They
//     are logged afterwards against the job.
//
// So both come off the required path. What is left is the one thing only the
// tech knows and only the tech can say: what happened. Anything missing shows
// up on the office review as a warning — visible and fixable, rather than
// blocking the card or being faked to get past a gate.
//
// The five dispositions map to statuses in services/jobs.js (DISPOSITION_TARGET).
// 'unable' and 'cancelled' move nothing: the trip failed, the work is still owed.
// ============================================================================

const DISPOSITIONS = [
  { key: 'finished',  label: 'Work Completed',      tint: '#14b8a6', glyph: '✓' },
  { key: 'return',    label: 'Return Visit',        tint: '#8b5cf6', glyph: '↻' },
  { key: 'estimate',  label: 'Estimate Needed',     tint: '#d97706', glyph: '▤' },
  { key: 'unable',    label: 'Unable to Complete',  tint: '#dc2626', glyph: '✕' },
  { key: 'cancelled', label: 'Cancelled / No Access', tint: '#64748b', glyph: '⊘' },
];

// The note asks for something slightly different depending on the outcome.
const PROMPT = {
  finished:  { label: 'What happened?',        ph: 'Replaced front reader. Back gate still intermittent.' },
  return:    { label: 'What happened?',        ph: 'Door closer is damaged and needs replacing. Will return once parts are in.' },
  estimate:  { label: 'Scope for the estimate', ph: 'Replace failing front door closer and add a badge reader at the rear entrance.' },
  unable:    { label: 'What happened?',        ph: 'Panel is behind a locked cage — nobody on site had the key.' },
  cancelled: { label: 'What happened?',        ph: 'Nobody on site at the scheduled time. Called the contact twice, no answer.' },
};

const WANTS_PARTS = new Set(['return', 'estimate']);
const NOTE_MAX = 500;

export default function FinishSheet({ job, actor, onClose, onFinished }) {
  const assignments = job.assignments || [];

  const mine = assignments.find(
    a => a.tech?.email && actor && a.tech.email.toLowerCase() === String(actor).toLowerCase()
  );
  const [assignmentId, setAssignmentId] = useState((mine || assignments[0])?.id || null);
  const active = assignments.find(a => a.id === assignmentId) || null;

  const [disposition, setDisposition] = useState(null);
  const [notes, setNotes]   = useState('');
  const [hours, setHours]   = useState('');
  const [parts, setParts]   = useState([]);
  const [partsOpen, setPartsOpen] = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState(null);

  const prompt   = PROMPT[disposition] || PROMPT.finished;
  const canParts = WANTS_PARTS.has(disposition);
  const ready    = !!disposition && notes.trim().length > 0;

  const addPart    = () => setParts(p => [...p, { description: '', qty: 1 }]);
  const setPart    = (i, k, v) => setParts(p => p.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const removePart = i => setParts(p => p.filter((_, n) => n !== i));

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await finishWork(job, {
      assignmentId,
      techName: active?.tech?.name,
      techEmail: active?.tech?.email,
      hours,
      notes,
      partsRequested: canParts && partsOpen ? parts : [],
      disposition,
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
          <div style={S.head}><button style={S.back} onClick={onClose}>←</button></div>
          <div style={S.empty}>
            Nobody is assigned to this job, so there is no visit to close out.
            Book it through the scheduler first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <button style={S.back} onClick={onClose}>←</button>
        </div>

        <div style={S.title}>How did this go?</div>
        <div style={S.sub}>Finish the job with a quick disposition.</div>

        {err && <div style={S.err}>{err}</div>}

        {/* Only shown when more than one person could be logging */}
        {assignments.length > 1 && (
          <>
            <label style={S.label}>Logging for</label>
            <div style={S.whoRow}>
              {assignments.map(a => {
                const on = a.id === assignmentId;
                return (
                  <button key={a.id} onClick={() => setAssignmentId(a.id)}
                          style={{ ...S.who, ...(on ? S.whoOn : {}) }}>
                    <span style={{ ...S.dot, background: a.tech?.color || '#64748b' }} />
                    {a.tech?.name || 'Tech record missing'}
                    {a.day_number > 1 && <span style={S.tag}>day {a.day_number}</span>}
                    {a.is_complete && <span style={S.tagDone}>done</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {active?.is_complete && (
          <div style={S.warn}>
            This assignment is already closed out. Logging again records a second
            visit — use it for a genuine return trip, not a correction.
          </div>
        )}

        <div style={S.dispList}>
          {DISPOSITIONS.map(d => {
            const on = d.key === disposition;
            return (
              <button key={d.key} onClick={() => setDisposition(d.key)}
                      style={{ ...S.disp, ...(on ? { borderColor: d.tint, background: '#132038' } : {}) }}>
                <span style={{ ...S.glyph, background: d.tint }}>{d.glyph}</span>
                <span style={S.dispLabel}>{d.label}</span>
                <span style={{ ...S.radio, ...(on ? { borderColor: d.tint, background: d.tint, color: '#04201d' } : {}) }}>
                  {on ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>

        {disposition && (
          <>
            <label style={S.label}>
              {prompt.label} <span style={S.req}>*</span>
            </label>
            <textarea
              style={S.textarea} rows={4} maxLength={NOTE_MAX}
              placeholder={prompt.ph}
              value={notes} onChange={e => setNotes(e.target.value)}
            />
            <div style={S.count}>{notes.length}/{NOTE_MAX}</div>

            {canParts && (
              <div style={S.partsBox}>
                <button style={S.partsHead}
                        onClick={() => { setPartsOpen(o => !o); if (!partsOpen && !parts.length) addPart(); }}>
                  <span style={S.partsTitle}>Need parts ordered?</span>
                  <span style={S.optional}>optional</span>
                  <span style={S.chev}>{partsOpen ? '⌃' : '⌄'}</span>
                </button>

                {partsOpen && (
                  <div style={S.partsBody}>
                    {parts.map((p, i) => (
                      <div key={i} style={S.partRow}>
                        <input
                          style={S.partDesc} placeholder="Door closer arm"
                          value={p.description}
                          onChange={e => setPart(i, 'description', e.target.value)}
                        />
                        <input
                          style={S.partQty} type="number" min="1" value={p.qty}
                          onChange={e => setPart(i, 'qty', e.target.value)}
                        />
                        <button style={S.partX} onClick={() => removePart(i)}>✕</button>
                      </div>
                    ))}
                    <button style={S.addPart} onClick={addPart}>＋ Add part</button>
                  </div>
                )}
              </div>
            )}

            <label style={S.label}>Hours worked <span style={S.optionalInline}>optional</span></label>
            <div style={S.hoursRow}>
              <input
                type="number" step="0.25" min="0" style={S.hoursInput}
                placeholder="—" value={hours} onChange={e => setHours(e.target.value)}
              />
              <div style={S.quick}>
                {[1, 2, 4, 8].map(n => (
                  <button key={n} style={S.quickBtn} onClick={() => setHours(String(n))}>{n}h</button>
                ))}
              </div>
            </div>
            <div style={S.hint}>Leave it blank if you log your hours later in the week.</div>
          </>
        )}

        <div style={S.info}>
          Warnings don't block review. Time and materials can be entered later.
        </div>

        <button
          style={{ ...S.go, ...(!ready ? S.goOff : {}) }}
          disabled={busy || !ready}
          onClick={submit}
        >
          {busy ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 70, padding: 16 },
  modal: { background: '#0a1526', borderRadius: 16, padding: '14px 18px 20px',
           width: 'min(480px, 100%)', maxHeight: '92vh', overflowY: 'auto' },

  head: { display: 'flex', justifyContent: 'flex-start' },
  back: { background: 'transparent', border: 0, color: '#94a3b8', fontSize: 22,
          cursor: 'pointer', padding: 0, lineHeight: 1 },

  title: { color: '#f1f5f9', fontSize: 26, fontWeight: 800, textAlign: 'center', marginTop: 10 },
  sub:   { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 20 },

  err:  { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
          marginBottom: 12, fontSize: 13 },
  warn: { background: '#78350f', color: '#fed7aa', padding: '8px 12px', borderRadius: 8,
          marginBottom: 12, fontSize: 12, lineHeight: 1.4 },
  empty: { color: '#94a3b8', fontSize: 13, marginTop: 14, lineHeight: 1.5 },

  label: { color: '#94a3b8', fontSize: 13, fontWeight: 600, display: 'block',
           marginTop: 18, marginBottom: 8 },
  req: { color: '#ef4444' },
  optionalInline: { color: '#475569', fontSize: 11, fontWeight: 400 },

  whoRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  who: { display: 'flex', alignItems: 'center', gap: 6, background: '#0f1b2e',
         border: '1px solid #1e293b', borderRadius: 8, padding: '7px 10px',
         color: '#cbd5e1', fontSize: 13, cursor: 'pointer' },
  whoOn: { borderColor: '#3b82f6', background: '#132038' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tag: { color: '#64748b', fontSize: 10 },
  tagDone: { color: '#14b8a6', fontSize: 10 },

  dispList: { display: 'flex', flexDirection: 'column', gap: 10 },
  disp: { display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
          background: '#0f1b2e', border: '1px solid #1e293b', borderRadius: 12,
          padding: '14px 16px', cursor: 'pointer' },
  glyph: { width: 34, height: 34, borderRadius: 17, display: 'flex',
           alignItems: 'center', justifyContent: 'center', color: '#04201d',
           fontSize: 16, fontWeight: 800, flexShrink: 0 },
  dispLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: 600, flex: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, border: '2px solid #334155',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           fontSize: 12, fontWeight: 800, flexShrink: 0 },

  textarea: { width: '100%', background: '#0f1b2e', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 10, padding: '12px',
              fontSize: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 },
  count: { color: '#475569', fontSize: 11, textAlign: 'right', marginTop: 4 },

  partsBox: { marginTop: 14, background: '#0f1b2e', border: '1px solid #1e293b',
              borderRadius: 12, overflow: 'hidden' },
  partsHead: { width: '100%', display: 'flex', alignItems: 'center', gap: 8,
               background: 'transparent', border: 0, padding: '13px 14px',
               cursor: 'pointer' },
  partsTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  optional: { color: '#475569', fontSize: 11, flex: 1, textAlign: 'left' },
  chev: { color: '#64748b', fontSize: 13 },
  partsBody: { padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
  partRow: { display: 'flex', gap: 8, alignItems: 'center' },
  partDesc: { flex: 1, background: '#0a1526', color: '#e2e8f0', border: '1px solid #1e293b',
              borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  partQty: { width: 62, background: '#0a1526', color: '#e2e8f0', border: '1px solid #1e293b',
             borderRadius: 8, padding: '9px 8px', fontSize: 14, textAlign: 'center' },
  partX: { background: 'transparent', border: 0, color: '#475569', fontSize: 14, cursor: 'pointer' },
  addPart: { background: 'transparent', border: 0, color: '#3b82f6', fontSize: 14,
             textAlign: 'left', padding: '4px 0', cursor: 'pointer' },

  hoursRow: { display: 'flex', gap: 8, alignItems: 'center' },
  hoursInput: { width: 96, background: '#0f1b2e', color: '#e2e8f0',
                border: '1px solid #1e293b', borderRadius: 8, padding: '9px 10px',
                fontSize: 18, fontWeight: 700 },
  quick: { display: 'flex', gap: 4 },
  quickBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
              padding: '7px 10px', fontSize: 12, cursor: 'pointer' },
  hint: { color: '#475569', fontSize: 11, marginTop: 5 },

  info: { color: '#64748b', fontSize: 12, marginTop: 20, lineHeight: 1.5 },
  go: { width: '100%', marginTop: 12, background: '#2563eb', color: '#fff', border: 0,
        borderRadius: 12, padding: '15px', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  goOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
};
