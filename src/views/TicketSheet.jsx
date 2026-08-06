import { useState, useEffect } from 'react';
import { laneOf, laneLabel, hasHold, moveOptions, gateFailures, softWarnings } from '../utils/lanes';
import { techsOn, techLabel, isMultiTech } from '../utils/scheduledTechs';
import { fetchTimeEntries, moveTo, addNote, fetchNotes } from '../services/jobs';
import { supabase } from '../services/supabaseClient';

// ============================================================================
// TicketSheet — one panel, everything about a job.
//
// v9 had the ticket split across JobPanel, JobDrawer and two modals, each
// showing a different subset and disagreeing about which was authoritative.
// 9.10.0 unified them into TicketSheet; v3 keeps that and drops the rest.
//
// This is where priority and estimated_hours get set — which is what lets a
// card pass the Open entry gate. Without this screen the gate is a wall.
// ============================================================================

const PRIORITIES = ['low', 'normal', 'high', 'emergency'];

export default function TicketSheet({ job, actor, onClose, onChanged, onSchedule, onFinish, onReview }) {
  const [draft, setDraft] = useState(job);
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [history, setHistory] = useState([]);

  const refreshNotes = () =>
    fetchNotes(job.id).then(setHistory);

  useEffect(() => { setDraft(job); setDirty(false); }, [job]);
  useEffect(() => {
    fetchTimeEntries(job.id).then(setEntries).catch(() => {});
    fetchNotes(job.id).then(setHistory).catch(() => {});
  }, [job.id]);

  const set = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true); };

  const lane = laneOf(draft, { hasTimeEntry: entries.length > 0,
    nextScheduled: draft.next_scheduled || draft.first_scheduled || null });
  const techs = techsOn(draft.assignments);
  const warnings = softWarnings(draft);
  const openGate = gateFailures(draft, 'open');

  const save = async () => {
    setSaving(true); setErr(null);
    const patch = {
      priority: draft.priority || null,
      estimated_hours: draft.estimated_hours === '' ? null : Number(draft.estimated_hours),
      due_date: draft.due_date || null,
      issue: draft.issue || null,
      notes: draft.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setDirty(false);
    onChanged?.();
  };

  const move = async laneKey => {
    const res = await moveTo(draft, laneKey, { actor });
    if (!res.ok) { setErr(res.reason); return; }
    setErr(null);
    onChanged?.();
    onClose?.();
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        <div style={S.head}>
          <div>
            <div style={S.customer}>
              {draft.customer?.name || draft.customer_name || 'No customer'}
            </div>
            <div style={S.sub}>
              {draft.customer?.id}
              {draft.customer?.cs_number && ` · CS ${draft.customer.cs_number}`}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {/* The work, stated once and loudly, before any field editor. */}
        <div style={S.issueBox}>
          {draft.issue
            ? <div style={S.issueText}>{draft.issue}</div>
            : <div style={S.issueNone}>No description on this ticket yet</div>}
        </div>

        {draft.customer?.address && <div style={S.addr}>{draft.customer.address}</div>}
        {draft.customer?.phone && (
          <a href={`tel:${draft.customer.phone}`} style={S.phone}>{draft.customer.phone}</a>
        )}

        <div style={S.laneRow}>
          <span style={S.laneChip}>{laneLabel(lane)}</span>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {openGate.length > 0 && (
          <div style={S.gate}>
            Needs {openGate.join(' and ')} before this can go to Open.
          </div>
        )}

        {/* ── Fields ──────────────────────────────────────────────────── */}
        <label style={S.label}>Priority</label>
        <div style={S.chips}>
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => set('priority', p)}
              style={{ ...S.chip, ...(draft.priority === p ? S.chipOn : {}) }}
            >{p}</button>
          ))}
        </div>

        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Estimated hours</label>
            <input
              type="number" step="0.5" min="0"
              style={S.input}
              value={draft.estimated_hours ?? ''}
              onChange={e => set('estimated_hours', e.target.value)}
            />
          </div>
          <div style={S.col}>
            <label style={S.label}>
              Due date {warnings.includes('due_date') && <span style={S.warn}>· not set</span>}
            </label>
            <input
              type="date"
              style={S.input}
              value={draft.due_date || ''}
              onChange={e => set('due_date', e.target.value)}
            />
          </div>
        </div>

        <label style={S.label}>Issue</label>
        <textarea style={S.area} rows={2}
          value={draft.issue || ''} onChange={e => set('issue', e.target.value)} />

        <label style={S.label}>Internal notes</label>
        <textarea style={S.area} rows={2}
          placeholder="Pre-visit notes — access code, what to bring, heads up for the tech."
          value={draft.notes || ''} onChange={e => set('notes', e.target.value)} />

        {/* ── Note thread ───────────────────────────────────────────────── */}
        <div style={S.threadHead}>
          <span style={S.label}>Notes</span>
        </div>
        <div style={S.threadInput}>
          <textarea style={S.noteArea} rows={2}
            placeholder="Add a note — it locks with your name and timestamp."
            value={noteText} onChange={e => setNoteText(e.target.value)} />
          <button
            style={{ ...S.noteBtn, ...(noteText.trim() ? {} : S.noteBtnOff) }}
            disabled={noteSaving || !noteText.trim()}
            onClick={async () => {
              setNoteSaving(true);
              await addNote(draft, noteText, actor);
              setNoteText(''); refreshNotes(); setNoteSaving(false);
            }}
          >{noteSaving ? 'Saving…' : 'Add note'}</button>
        </div>
        <div style={S.thread}>
          {history.length === 0
            ? <div style={S.none}>No notes yet.</div>
            : history.map(n => (
                <div key={n.id} style={S.threadNote}>
                  <div style={S.threadMeta}>
                    <span>{(n.author_email||'system').split('@')[0]}</span>
                    <span style={S.threadTime}>
                      {new Date(n.created_at).toLocaleString(undefined,
                        { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                    </span>
                  </div>
                  <div style={S.threadBody}>{n.body}</div>
                </div>
              ))}
        </div>

        {dirty && (
          <button style={S.save} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}

        {/* ── Who's on it ─────────────────────────────────────────────── */}
        <div style={S.sectionHead}>Assigned</div>
        {techs.length === 0
          ? <div style={S.none}>Nobody on it yet</div>
          : (
            <div style={S.techList}>
              {draft.assignments.filter(a => a.event_state !== 'removed').map(a => (
                <div key={a.id} style={S.techRow}>
                  <span style={{ ...S.dot, background: a.tech?.color || '#64748b' }} />
                  <span style={S.techName}>{a.tech?.name}</span>
                  {a.estimated_hours != null && <span style={S.techHrs}>{a.estimated_hours}h</span>}
                  {a.day_number > 1 && <span style={S.day}>day {a.day_number}</span>}
                  {a.is_complete && <span style={S.done}>done</span>}
                </div>
              ))}
              {isMultiTech(draft.assignments) && (
                <div style={S.multi}>{techLabel(draft.assignments)}</div>
              )}
            </div>
          )}

        <div style={S.actionRow}>
          <button style={S.schedule} onClick={() => onSchedule(draft)}>
            {/* A finished job with people on it is not unscheduled work. Saying
                "Schedule this" there reads as if the visit never happened. */}
            {draft.status === 'good_to_go' || draft.status === 'return_pending'
              ? 'Schedule another visit'
              : techs.length ? 'Reschedule' : 'Schedule this'}
          </button>
          {techs.length > 0 && onFinish && (
            <button style={S.finish} onClick={() => onFinish(draft)}>
              Finish — how did it go?
            </button>
          )}
          {/* Review is a flag on the job, not a lane, so the way in is the
              card itself once a tech has dispositioned it. */}
          {onReview && draft.review_state === 'pending' && (
            <button style={S.review} onClick={() => onReview(draft)}>
              Office review
            </button>
          )}
        </div>

        {/* ── Time ────────────────────────────────────────────────────── */}
        <div style={S.sectionHead}>
          Time logged
          {entries.length > 0 && (
            <span style={S.totalHrs}>
              {(entries.reduce((n,t)=>n+(t.total_minutes||0),0)/60).toFixed(1)}h total
            </span>
          )}
        </div>
        {entries.length === 0
          ? <div style={S.none}>No time entries</div>
          : entries.map(t => (
              <div key={t.id} style={S.entry}>
                <span>{t.tech_name || t.tech_email}</span>
                <span style={S.entryDate}>
                  {new Date(t.event_start || t.created_at).toLocaleDateString(undefined,
                    { month: 'short', day: 'numeric' })}
                </span>
                <span style={S.entryHrs}>{((t.total_minutes || 0) / 60).toFixed(1)}h</span>
                {t.billed && <span style={S.billed}>billed</span>}
                {t.billable === false && <span style={S.nb}>not billable</span>}
              </div>
            ))}

        {/* ── Move ────────────────────────────────────────────────────── */}
        <div style={S.sectionHead}>Move to</div>
        <div style={S.moveGrid}>
          {moveOptions(draft, { hasTimeEntry: entries.length > 0 }).map(o => (
            <button
              key={o.key}
              disabled={!o.ok}
              title={o.ok ? '' : o.reason}
              style={{ ...S.moveBtn, ...(o.ok ? {} : S.moveOff) }}
              onClick={() => move(o.key)}
            >
              {o.label}
              {!o.ok && <span style={S.moveWhy}>{o.reason}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const S = {
  review: { background: '#78350f', color: '#fed7aa', border: 0, borderRadius: 8,
            padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },

  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
              display: 'flex', justifyContent: 'flex-end', zIndex: 50 },
  sheet: { background: '#111c2e', width: 'min(460px, 100%)', height: '100%',
           overflowY: 'auto', padding: 18 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  customer: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  addr: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
  issueBox: { background: '#0b1220', borderLeft: '3px solid #3b82f6',
              borderRadius: '4px 8px 8px 4px', padding: '11px 13px', marginTop: 12 },
  issueText: { color: '#f1f5f9', fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
  issueNone: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  phone: { color: '#38bdf8', fontSize: 13, textDecoration: 'none', display: 'block', marginTop: 2 },
  laneRow: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  laneChip: { background: '#1e293b', color: '#cbd5e1', fontSize: 11, fontWeight: 700,
              padding: '3px 9px', borderRadius: 12 },
  holdChip: { background: '#78350f', color: '#fde68a', fontSize: 11, fontWeight: 700,
              padding: '3px 9px', borderRadius: 12, display: 'flex', gap: 6, alignItems: 'center' },
  clearHold: { background: 'transparent', border: 0, color: '#fbbf24', fontSize: 10,
               textDecoration: 'underline', cursor: 'pointer' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  gate: { background: '#1e293b', color: '#fbbf24', padding: '8px 12px', borderRadius: 8,
          marginTop: 12, fontSize: 12 },
  label: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
           display: 'block', marginTop: 16, marginBottom: 6 },
  warn: { color: '#fbbf24', textTransform: 'none', letterSpacing: 0 },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { background: '#1e293b', color: '#94a3b8', border: 0, borderRadius: 14,
          padding: '5px 12px', fontSize: 12, cursor: 'pointer' },
  chipOn: { background: '#2563eb', color: '#fff' },
  row: { display: 'flex', gap: 10 },
  col: { flex: 1 },
  input: { width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
           borderRadius: 8, padding: '8px 10px', fontSize: 14 },
  area: { width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
          borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' },
  save: { width: '100%', marginTop: 14, background: '#2563eb', color: '#fff', border: 0,
          borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  totalHrs: { color: '#14b8a6', fontSize: 11, fontWeight: 700, marginLeft: 8 },
  threadHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginTop: 18, marginBottom: 6 },
  threadInput: { display: 'flex', flexDirection: 'column', gap: 6 },
  noteArea: { background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
              borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical',
              fontFamily: 'inherit' },
  noteBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 8,
             padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
             alignSelf: 'flex-end' },
  noteBtnOff: { opacity: .45, cursor: 'not-allowed' },
  thread: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 },
  threadNote: { background: '#0b1220', borderRadius: 8, padding: '8px 10px' },
  threadMeta: { display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 3 },
  threadTime: { color: '#475569', fontSize: 10 },
  threadBody: { color: '#e2e8f0', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap' },
  sectionHead: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                 marginTop: 24, marginBottom: 8, borderTop: '1px solid #1e293b', paddingTop: 14 },
  none: { color: '#475569', fontSize: 13 },
  techList: { display: 'flex', flexDirection: 'column', gap: 6 },
  techRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  techName: { flex: 1 },
  techHrs: { color: '#64748b', fontSize: 12 },
  day: { color: '#64748b', fontSize: 11 },
  done: { color: '#14b8a6', fontSize: 11, fontWeight: 700 },
  entryDate: { color: '#64748b', fontSize: 11, marginLeft: 'auto', marginRight: 8 },
  multi: { color: '#38bdf8', fontSize: 12, marginTop: 4 },
  schedule: { width: '100%', marginTop: 12, background: '#3b82f6', color: '#fff', border: 0,
              borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  actionRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  finish: { width: '100%', background: '#14b8a6', color: '#04201d', border: 0,
            borderRadius: 8, padding: '11px', fontSize: 14, fontWeight: 800,
            cursor: 'pointer' },
  entry: { display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: '#cbd5e1',
           padding: '5px 0' },
  entryHrs: { color: '#94a3b8', marginLeft: 'auto' },
  billed: { color: '#14b8a6', fontSize: 11 },
  nb: { color: '#f87171', fontSize: 11 },
  moveGrid: { display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' },
  moveBtn: { background: '#243350', color: '#e2e8f0', border: 0, borderRadius: 8,
             padding: '9px 8px', fontSize: 12, cursor: 'pointer', textAlign: 'left',
             display: 'flex', flexDirection: 'column', gap: 2 },
  moveOff: { opacity: .45, cursor: 'not-allowed' },
  moveWhy: { fontSize: 10, color: '#fca5a5' },
};
