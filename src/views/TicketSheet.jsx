import { useState, useEffect } from 'react';
import { laneOf, laneLabel, moveOptions } from '../utils/lanes';
import { techLabel, isMultiTech, techsOn } from '../utils/scheduledTechs';
import {
  fetchTimeEntries, moveTo, addNote, fetchTimeline,
  blockerFor, dispositionsFor, reviewStates, openQuestions,
} from '../services/jobs';
import { supabase } from '../services/supabaseClient';

// ============================================================================
// TicketSheet — the job, and what to do about it.
//
// It used to be one scroll: fields, a note box, the note thread, assigned
// techs, time entries, six lane buttons and three actions, all at equal
// weight. Opening a card that had just come back from a tech told you the lane
// and nothing else — which is why "I have no idea I'm supposed to do anything"
// was the right complaint.
//
// Now, in order:
//   1  customer, the issue, status pill with age
//   2  THE BLOCKER — what is owed, how long, and the button that clears it
//   3  scheduled / tech / priority, three-up, read-only
//   4  Overview · Activity · Estimate
//   5  next step in plain words, then one primary action
//
// The blocker comes from blockerFor(), the same derivation the board card
// reads, so the two surfaces cannot tell different stories.
// ============================================================================

const TONE = {
  broken: { fg: '#fca5a5', edge: '#ef4444', bg: '#2a0f12' },
  person: { fg: '#c7d2fe', edge: '#818cf8', bg: '#1a1f3d' },
  us:     { fg: '#fcd34d', edge: '#d97706', bg: '#2a1a06' },
  them:   { fg: '#cbd5e1', edge: '#64748b', bg: '#16243a' },
  done:   { fg: '#7fd8cd', edge: '#14b8a6', bg: '#122a2c' },
};

const ACTION_LABEL = {
  schedule: 'Schedule', ask: 'Open the ask', visit: 'Open the visit',
  review: 'Office review', estimate: 'Open estimate', parts: 'Parts', billing: 'Billing',
};

const KIND_ICON = {
  disposition: { ch: '\u25a4', c: '#d97706' },
  review:      { ch: '\u2713', c: '#14b8a6' },
  move:        { ch: '\u2192', c: '#4F8CFF' },
  note:        { ch: '\u270e', c: '#64748b' },
  field:       { ch: '\u270e', c: '#64748b' },
  hours:       { ch: '\u25f7', c: '#4F8CFF' },
  materials:   { ch: '\u25a6', c: '#8b5cf6' },
  parts:       { ch: '\u25a3', c: '#8b5cf6' },
};

const LANE_WORD = {
  ready_to_schedule: 'Ready to schedule', new: 'New', scheduled: 'Scheduled',
  return_pending: 'Return pending', estimate_sent: 'Estimate sent',
  good_to_go: 'Good to go', closed: 'Closed',
};

const PRI_TINT = { emergency: { color: '#ff6464' }, high: { color: '#f3a51f' } };

const daysSince = iso =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

export default function TicketSheet({
  job, actor, onClose, onChanged, onSchedule, onFinish, onReview, onAsk, onEstimate,
}) {
  const [draft, setDraft]       = useState(job);
  const [entries, setEntries]   = useState([]);
  const [history, setHistory]   = useState([]);
  const [facts, setFacts]       = useState({ awaitingReview: [], openAsks: [], lastEntry: null });
  const [tab, setTab]           = useState('overview');
  const [editing, setEditing]   = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [saving, setSaving]     = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [showMoves, setShowMoves]   = useState(false);
  const [err, setErr]           = useState(null);

  useEffect(() => { setDraft(job); setDirty(false); setEditing(false); }, [job]);

  useEffect(() => {
    fetchTimeEntries(job.id).then(setEntries).catch(() => {});
    fetchTimeline(job.id).then(setHistory).catch(() => {});
    // The blocker needs the same facts the board gathers. Fetch them for this
    // one job rather than trusting whatever the caller happened to pass in.
    (async () => {
      const ids = (job.assignments || []).map(a => a.id).filter(Boolean);
      const [dispos, reviews, asks, est, parts] = await Promise.all([
        dispositionsFor(ids),
        reviewStates(ids),
        openQuestions([job.id]),
        supabase.from('estimates')
          .select('id, status, estimate_number, created_at, sent_at')
          .eq('job_id', job.id).in('status', ['draft', 'sent'])
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('parts_orders')
          .select('ordered_at, arrived_at, requested_at').eq('job_id', job.id),
      ]);

      const awaiting = [];
      for (const id of ids) {
        const d = dispos[id]; if (!d) continue;
        const r = reviews[id];
        if (r && new Date(r.at) >= new Date(d.at)) {
          if (r.state === 'changes') awaiting.push({ assignmentId: id, state: 'changes', ...d });
        } else awaiting.push({ assignmentId: id, state: 'pending', ...d });
      }
      const latest = Object.values(dispos).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      setFacts({
        awaitingReview: awaiting,
        openAsks: asks[job.id] || [],
        lastEntry: latest || null,
        estimate: est.data && est.data[0] ? est.data[0] : null,
        parts: parts.data || [],
      });
    })();
  }, [job.id]);

  const set = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true); };

  const lane = laneOf(draft, {
    hasTimeEntry: entries.length > 0,
    nextScheduled: draft.next_scheduled || draft.first_scheduled || null,
  });

  const blocker = blockerFor({ ...draft, ...facts });
  const tone = blocker ? TONE[blocker.tone] : null;
  const laneAge = daysSince(draft.lane_since || draft.updated_at);
  const when = draft.next_scheduled || draft.first_scheduled;

  const runAction = () => {
    switch (blocker && blocker.action) {
      case 'schedule': return onSchedule && onSchedule(draft);
      case 'review':   return onReview && onReview(draft);
      case 'ask':      return onAsk && onAsk(draft);
      case 'estimate': return onEstimate && onEstimate(draft, blocker.estimateId);
      case 'visit':    return onFinish && onFinish(draft);
      default:         return null;
    }
  };

  const save = async () => {
    setSaving(true); setErr(null);
    const { error } = await supabase.from('jobs').update({
      priority: draft.priority || null,
      estimated_hours: draft.estimated_hours === '' ? null : Number(draft.estimated_hours),
      due_date: draft.due_date || null,
      issue: draft.issue || null,
      notes: draft.notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setDirty(false); setEditing(false);
    onChanged && onChanged();
  };

  const move = async laneKey => {
    const res = await moveTo(draft, laneKey, { actor });
    if (!res.ok) { setErr(res.reason); return; }
    setErr(null);
    onChanged && onChanged();
    onClose && onClose();
  };

  const postNote = async () => {
    const body = noteText.trim(); if (!body) return;
    setNoteSaving(true);
    const res = await addNote(draft, body, actor);
    setNoteSaving(false);
    if (res && res.ok === false) { setErr(res.reason); return; }
    setNoteText('');
    fetchTimeline(job.id).then(setHistory);
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        {/* ── 1. Who and what ─────────────────────────────────────────── */}
        <div style={S.head}>
          <div style={S.headText}>
            <div style={S.customer}>
              {(draft.customer && draft.customer.name) || draft.customer_name || 'No customer'}
            </div>
            <div style={S.issueLine}>{draft.issue || 'No issue recorded'}</div>
            <div style={S.pill}>
              {LANE_WORD[draft.status] || laneLabel(lane)}
              {laneAge > 0 && <span style={S.pillAge}>&middot; {laneAge}d</span>}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>&#10005;</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {/* ── 2. The blocker, and the way out of it ───────────────────── */}
        {blocker && (
          <button
            style={{ ...S.banner, background: tone.bg, borderColor: tone.edge }}
            onClick={runAction}
            disabled={!blocker.action}
          >
            <span style={{ ...S.bIco, borderColor: tone.edge, color: tone.edge }}>&#9719;</span>
            <span style={S.bText}>
              <span style={{ ...S.bTitle, color: tone.fg }}>{blocker.label}</span>
              {blocker.detail && <span style={S.bDetail}>{blocker.detail}</span>}
            </span>
            {blocker.days != null && blocker.days > 0 && (
              <span style={{ ...S.bChip, ...(blocker.stale ? S.bChipHot : {}) }}>
                {blocker.days}d
              </span>
            )}
            {blocker.action && <span style={{ ...S.bChev, color: tone.edge }}>&#8250;</span>}
          </button>
        )}

        {/* ── 3. The three facts you check without reading ────────────── */}
        <div style={S.facts}>
          <div style={S.fact}>
            <div style={S.fLabel}>Scheduled</div>
            <div style={S.fVal}>
              {when ? new Date(when).toLocaleDateString(undefined,
                { weekday: 'short', month: 'short', day: 'numeric' }) : '\u2014'}
            </div>
            {when && (
              <div style={S.fSub}>
                {new Date(when).toLocaleTimeString(undefined,
                  { hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
          </div>
          <div style={S.fact}>
            <div style={S.fLabel}>Tech</div>
            <div style={S.fVal}>{techLabel(draft.assignments) || '\u2014'}</div>
            {isMultiTech(draft.assignments) && (
              <div style={S.fSub}>{techsOn(draft.assignments).length} on site</div>
            )}
          </div>
          <div style={{ ...S.fact, borderRight: 0 }}>
            <div style={S.fLabel}>Priority</div>
            <div style={{ ...S.fVal, ...(PRI_TINT[draft.priority] || {}) }}>
              {draft.priority || 'normal'}
            </div>
            {draft.estimated_hours != null && (
              <div style={S.fSub}>{draft.estimated_hours}h estimated</div>
            )}
          </div>
        </div>

        {/* ── 4. Tabs ─────────────────────────────────────────────────── */}
        <div style={S.tabs}>
          {['overview', 'activity', 'estimate'].map(t => (
            <button key={t}
              style={{ ...S.tab, ...(tab === t ? S.tabOn : {}) }}
              onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div style={S.body}>
          {tab === 'overview' && (
            <Overview
              draft={draft} set={set} editing={editing} setEditing={setEditing}
              dirty={dirty} saving={saving} save={save}
              noteText={noteText} setNoteText={setNoteText}
              noteSaving={noteSaving} postNote={postNote}
            />
          )}
          {tab === 'activity' && <Activity rows={history} entries={entries} />}
          {tab === 'estimate' && (
            <EstimateTab
              est={facts.estimate}
              onOpen={() => onEstimate && onEstimate(draft, facts.estimate && facts.estimate.id)}
            />
          )}
        </div>

        {/* ── 5. Next step, then the one action ───────────────────────── */}
        {blocker && blocker.next && (
          <div style={S.next}>
            <span style={S.nextLabel}>Next step</span>
            <span style={S.nextBody}>{blocker.next}</span>
          </div>
        )}

        <div style={S.foot}>
          {blocker && blocker.action && (
            <button style={S.primary} onClick={runAction}>
              {ACTION_LABEL[blocker.action]}
            </button>
          )}
          {!blocker && onSchedule && (
            <button style={S.primary} onClick={() => onSchedule(draft)}>Schedule</button>
          )}

          <div style={S.secondRow}>
            {onFinish && <button style={S.secondary} onClick={() => onFinish(draft)}>Finish</button>}
            {onAsk && <button style={S.secondary} onClick={() => onAsk(draft)}>Ask someone</button>}
            <button style={S.secondary} onClick={() => setShowMoves(v => !v)}>
              Move {showMoves ? '\u25b4' : '\u25be'}
            </button>
          </div>

          {/* Lane moves are demoted. Moving a card by hand is the exception,
              not the way work normally travels. */}
          {showMoves && (
            <div style={S.moves}>
              {moveOptions(draft, { hasTimeEntry: entries.length > 0 }).map(o => (
                <button key={o.key}
                  style={{ ...S.move, ...(o.ok ? {} : S.moveOff) }}
                  disabled={!o.ok}
                  title={o.ok ? '' : o.reason}
                  onClick={() => move(o.key)}>
                  {o.label}
                  {!o.ok && o.reason && <span style={S.moveWhy}>{o.reason}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
// Read-only until you ask to edit. Every field used to sit in an open input,
// which reads as "this is a form, fill it in" on a record that is mostly
// settled — and on a phone makes a stray keystroke look like a decision.
function Overview({ draft, set, editing, setEditing, dirty, saving, save,
                    noteText, setNoteText, noteSaving, postNote }) {
  const c = draft.customer || {};
  const address = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');

  return (
    <>
      <div style={S.block}>
        <div style={S.blockHead}>
          <span>Job summary</span>
          <button style={S.pencil} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : '\u270e Edit'}
          </button>
        </div>

        {!editing ? (
          <>
            <div style={S.summary}>{draft.issue || 'Nothing recorded.'}</div>
            {draft.notes && <div style={S.internal}>{draft.notes}</div>}
            <div style={S.roRow}>
              <span style={S.roK}>Estimated hours</span>
              <span style={S.roV}>{draft.estimated_hours != null ? draft.estimated_hours : '\u2014'}</span>
            </div>
            <div style={S.roRow}>
              <span style={S.roK}>Due date</span>
              <span style={S.roV}>{draft.due_date || 'not set'}</span>
            </div>
          </>
        ) : (
          <>
            <label style={S.label}>Priority</label>
            <div style={S.chips}>
              {['low', 'normal', 'high', 'emergency'].map(p => (
                <button key={p}
                  style={{ ...S.chip, ...(draft.priority === p ? S.chipOn : {}) }}
                  onClick={() => set('priority', p)}>{p}</button>
              ))}
            </div>
            <div style={S.two}>
              <div>
                <label style={S.label}>Estimated hours</label>
                <input type="number" step="0.5" style={S.input}
                  value={draft.estimated_hours != null ? draft.estimated_hours : ''}
                  onChange={e => set('estimated_hours', e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Due date</label>
                <input type="date" style={S.input}
                  value={draft.due_date || ''}
                  onChange={e => set('due_date', e.target.value)} />
              </div>
            </div>
            <label style={S.label}>Issue</label>
            <textarea style={S.area} rows={3} value={draft.issue || ''}
              onChange={e => set('issue', e.target.value)} />
            <label style={S.label}>Internal notes</label>
            <textarea style={S.area} rows={2} value={draft.notes || ''}
              placeholder="Access code, what to bring, heads up for the tech."
              onChange={e => set('notes', e.target.value)} />
            {dirty && (
              <button style={S.save} disabled={saving} onClick={save}>
                {saving ? 'Saving\u2026' : 'Save changes'}
              </button>
            )}
          </>
        )}
      </div>

      {address && (
        <div style={S.block}>
          <div style={S.blockHead}><span>Site</span></div>
          <div style={S.summary}>{c.name}</div>
          <div style={S.addr}>{address}</div>
        </div>
      )}

      <div style={S.block}>
        <div style={S.blockHead}><span>Add a note</span></div>
        <textarea style={S.area} rows={2}
          placeholder="It locks with your name and a timestamp."
          value={noteText} onChange={e => setNoteText(e.target.value)} />
        <button style={{ ...S.save, ...(noteText.trim() ? {} : S.saveOff) }}
          disabled={!noteText.trim() || noteSaving} onClick={postNote}>
          {noteSaving ? 'Saving\u2026' : 'Add note'}
        </button>
      </div>
    </>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────
// Typed entries, not undifferentiated text. A disposition, a status move and
// somebody's note are different things and should not read the same.
function Activity({ rows, entries }) {
  if (!rows.length && !entries.length) {
    return <div style={S.none}>Nothing recorded yet.</div>;
  }
  return (
    <>
      {entries.length > 0 && (
        <div style={S.block}>
          <div style={S.blockHead}>
            <span>Time logged</span>
            <span style={S.total}>
              {(entries.reduce((n, e) => n + (e.total_minutes || 0), 0) / 60).toFixed(2)}h
            </span>
          </div>
          {entries.map(e => (
            <div key={e.id} style={S.timeRow}>
              <span>{e.tech_name || '\u2014'}</span>
              <span style={S.timeWhen}>
                {e.event_start
                  ? new Date(e.event_start).toLocaleDateString(undefined,
                      { month: 'short', day: 'numeric' })
                  : '\u2014'}
              </span>
              <span>{((e.total_minutes || 0) / 60).toFixed(2)}h</span>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div style={S.block}>
          {rows.map(r => {
            const ico = KIND_ICON[r.kind] || KIND_ICON.note;
            const lines = String(r.body || '').split('\n');
            const rest = lines.slice(1).join('\n').trim();
            return (
              <div key={r.id} style={S.act}>
                <span style={{ ...S.actIco, borderColor: ico.c, color: ico.c }}>{ico.ch}</span>
                <span style={S.actText}>
                  <span style={S.actTitle}>
                    {r.kind === 'move' && r.to
                      ? `${LANE_WORD[r.from] || r.from || 'Created'} \u2192 ${LANE_WORD[r.to] || r.to}`
                      : lines[0]}
                  </span>
                  {r.kind !== 'move' && rest && <span style={S.actBody}>{rest}</span>}
                  <span style={S.actWho}>{String(r.who || 'system').split('@')[0]}</span>
                </span>
                <span style={S.actAge}>
                  {new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Estimate ─────────────────────────────────────────────────────────────────
// Draft -> Sent -> Won / Lost. The dollar value is deliberately absent: it
// never appears on a technician-facing surface or in job history.
function EstimateTab({ est, onOpen }) {
  if (!est) {
    return (
      <div style={S.none}>
        No estimate on this job.
        <div style={S.noneHint}>
          One is created when a tech dispositions &ldquo;Estimate needed&rdquo;.
        </div>
      </div>
    );
  }
  const steps = ['draft', 'sent', 'won', 'lost'];
  const at = steps.indexOf(est.status);
  return (
    <div style={S.block}>
      <div style={S.stepper}>
        {steps.map((s, i) => (
          <div key={s} style={S.step}>
            <span style={{ ...S.stepDot, ...(i === at ? S.stepOn : {}) }} />
            <span style={{ ...S.stepWord, ...(i === at ? S.stepWordOn : {}) }}>{s}</span>
          </div>
        ))}
      </div>
      {est.estimate_number && (
        <div style={S.roRow}>
          <span style={S.roK}>Estimate number</span>
          <span style={S.roV}>{est.estimate_number}</span>
        </div>
      )}
      <div style={S.roRow}>
        <span style={S.roK}>Created</span>
        <span style={S.roV}>{new Date(est.created_at).toLocaleDateString()}</span>
      </div>
      {est.sent_at && (
        <div style={S.roRow}>
          <span style={S.roK}>Sent</span>
          <span style={S.roV}>{new Date(est.sent_at).toLocaleDateString()}</span>
        </div>
      )}
      <button style={S.save} onClick={onOpen}>Open estimate</button>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,16,.72)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 },
  sheet: { background: '#0b1a2b', width: '100%', maxWidth: 560, maxHeight: '94vh',
           borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
           border: '1px solid #22344c', borderBottom: 0 },

  head: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '18px 18px 4px' },
  headText: { minWidth: 0 },
  customer: { color: '#eef4fb', fontSize: 21, fontWeight: 700, letterSpacing: '-.01em' },
  issueLine: { color: '#93a6bd', fontSize: 13.5, marginTop: 3, lineHeight: 1.4 },
  pill: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#16243a',
          border: '1px solid #22344c', borderRadius: 20, padding: '4px 11px',
          fontSize: 12, color: '#93a6bd', marginTop: 10 },
  pillAge: { color: '#5b6f88' },
  x: { background: 'transparent', border: 0, color: '#5b6f88', fontSize: 18,
       cursor: 'pointer', padding: 4, height: 28 },

  err: { background: '#7f1d1d', color: '#fecaca', fontSize: 12.5, padding: '8px 18px' },

  banner: { display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 36px)',
            margin: '14px 18px 0', border: '1.5px solid', borderRadius: 12,
            padding: '13px 14px', cursor: 'pointer', textAlign: 'left' },
  bIco: { width: 32, height: 32, borderRadius: '50%', border: '1.5px solid',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 'none', fontSize: 14 },
  bText: { flex: 1, minWidth: 0 },
  bTitle: { display: 'block', fontSize: 15, fontWeight: 700 },
  bDetail: { display: 'block', color: '#93a6bd', fontSize: 12.5, marginTop: 2,
             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  bChip: { background: '#16243a', color: '#93a6bd', borderRadius: 6, padding: '3px 8px',
           fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 600, flex: 'none' },
  bChipHot: { background: '#78350f', color: '#fde68a' },
  bChev: { fontSize: 18, flex: 'none' },

  facts: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', background: '#11243a',
           borderRadius: 12, margin: '12px 18px 0', overflow: 'hidden' },
  fact: { padding: '12px 8px', textAlign: 'center', borderRight: '1px solid #16243a' },
  fLabel: { color: '#5b6f88', fontSize: 11 },
  fVal: { color: '#eef4fb', fontSize: 14, fontWeight: 600, marginTop: 3,
          textTransform: 'capitalize' },
  fSub: { color: '#5b6f88', fontSize: 11.5, marginTop: 2 },

  tabs: { display: 'flex', gap: 20, padding: '0 18px', marginTop: 16,
          borderBottom: '1px solid #22344c' },
  tab: { background: 'transparent', border: 0, borderBottom: '2px solid transparent',
         color: '#5b6f88', fontSize: 14, padding: '9px 0', cursor: 'pointer' },
  tabOn: { color: '#19D3BF', borderBottomColor: '#19D3BF', fontWeight: 600 },

  body: { overflowY: 'auto', padding: '0 18px', flex: 1 },
  block: { background: '#11243a', borderRadius: 12, padding: '14px 15px', marginTop: 12 },
  blockHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
               color: '#eef4fb', fontSize: 14.5, fontWeight: 600 },
  pencil: { background: 'transparent', color: '#93a6bd', border: '1px solid #22344c',
            borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' },
  summary: { color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.55, marginTop: 9,
             whiteSpace: 'pre-wrap' },
  internal: { color: '#93a6bd', fontSize: 13, lineHeight: 1.5, marginTop: 9,
              paddingTop: 9, borderTop: '1px solid #16243a', whiteSpace: 'pre-wrap' },
  addr: { color: '#93a6bd', fontSize: 13, marginTop: 3 },
  roRow: { display: 'flex', justifyContent: 'space-between', padding: '7px 0',
           borderTop: '1px solid #16243a', marginTop: 7 },
  roK: { color: '#5b6f88', fontSize: 12.5 },
  roV: { color: '#cbd5e1', fontSize: 13 },

  label: { display: 'block', color: '#93a6bd', fontSize: 12, marginTop: 12, marginBottom: 6 },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { background: '#0f1f33', color: '#93a6bd', border: '1px solid #22344c',
          borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' },
  chipOn: { background: '#122a2c', borderColor: '#19D3BF', color: '#eef4fb' },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  input: { width: '100%', height: 48, background: '#0f1f33', color: '#eef4fb',
           border: '1px solid #22344c', borderRadius: 10, padding: '0 12px', fontSize: 14 },
  area: { width: '100%', background: '#0f1f33', color: '#eef4fb', border: '1px solid #22344c',
          borderRadius: 10, padding: '11px 12px', fontSize: 14, lineHeight: 1.5,
          resize: 'vertical', fontFamily: 'inherit', marginTop: 8 },
  save: { width: '100%', background: '#19D3BF', color: '#03201c', border: 0, borderRadius: 10,
          padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 12 },
  saveOff: { background: '#1e293b', color: '#475569', cursor: 'default' },

  none: { color: '#93a6bd', fontSize: 13.5, textAlign: 'center', padding: '28px 0' },
  noneHint: { color: '#5b6f88', fontSize: 12, marginTop: 8 },
  total: { color: '#19D3BF', fontSize: 13, fontWeight: 700 },
  timeRow: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0',
             borderTop: '1px solid #16243a', marginTop: 7, fontSize: 13, color: '#cbd5e1' },
  timeWhen: { color: '#5b6f88', fontSize: 12 },

  act: { display: 'flex', gap: 11, padding: '10px 0', borderTop: '1px solid #16243a' },
  actIco: { width: 26, height: 26, borderRadius: '50%', border: '1.5px solid', flex: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 },
  actText: { flex: 1, minWidth: 0 },
  actTitle: { display: 'block', color: '#eef4fb', fontSize: 13.5, lineHeight: 1.4 },
  actBody: { display: 'block', color: '#93a6bd', fontSize: 12.5, marginTop: 3,
             lineHeight: 1.45, whiteSpace: 'pre-wrap' },
  actWho: { display: 'block', color: '#5b6f88', fontSize: 11.5, marginTop: 3 },
  actAge: { color: '#5b6f88', fontSize: 11.5, flex: 'none' },

  stepper: { display: 'flex', justifyContent: 'space-between', margin: '4px 0 12px' },
  step: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 },
  stepDot: { width: 10, height: 10, borderRadius: '50%', background: '#22344c' },
  stepOn: { background: '#4F8CFF', boxShadow: '0 0 0 4px rgba(79,140,255,.18)' },
  stepWord: { color: '#5b6f88', fontSize: 11.5, textTransform: 'capitalize' },
  stepWordOn: { color: '#93c5fd', fontWeight: 600 },

  next: { display: 'flex', flexDirection: 'column', gap: 3, margin: '14px 18px 0',
          background: '#11243a', borderLeft: '3px solid #4F8CFF', borderRadius: 10,
          padding: '11px 13px' },
  nextLabel: { color: '#5b6f88', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' },
  nextBody: { color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.5 },

  foot: { padding: '12px 18px 18px', borderTop: '1px solid #22344c', marginTop: 12 },
  primary: { width: '100%', background: '#4F8CFF', color: '#fff', border: 0, borderRadius: 10,
             padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  secondRow: { display: 'flex', gap: 8, marginTop: 9 },
  secondary: { flex: 1, background: 'transparent', color: '#93a6bd', border: '1px solid #22344c',
               borderRadius: 10, padding: '11px', fontSize: 13.5, cursor: 'pointer' },
  moves: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 9 },
  move: { background: '#11243a', color: '#cbd5e1', border: '1px solid #22344c',
          borderRadius: 9, padding: '10px', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' },
  moveOff: { color: '#3f5470', cursor: 'default' },
  moveWhy: { display: 'block', color: '#5b6f88', fontSize: 10.5, marginTop: 3 },
};
