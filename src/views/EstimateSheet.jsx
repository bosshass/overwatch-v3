import { useState, useEffect } from 'react';
import {
  fetchEstimate, priceEstimate, markEstimateSent, decideEstimate,
} from '../services/jobs';

// ============================================================================
// EstimateSheet — where a draft becomes a number that goes out the door.
//
// The estimates table has existed since the schema was laid down and the field
// has been creating draft rows into it for days, with no screen to price them
// on. Every "Estimate needed" a tech filed was accumulating a record nobody
// could see.
//
// FOUR STATES, ONE DIRECTION: draft -> sent -> won / lost.
//
// THE NUMBER IS REQUIRED TO SEND, THE PRICE IS NOT.
// The number is how an Overwatch estimate ties back to the real one in QBO,
// and how a customer with three open estimates is talked about on the phone.
// The dollar value is optional here and appears on no technician-facing
// surface and in no job history entry — the field says what the work is;
// pricing it is somebody else's decision.
// ============================================================================

const STEPS = ['draft', 'sent', 'won', 'lost'];

export default function EstimateSheet({ estimateId, actor, onClose, onChanged }) {
  const [est, setEst]   = useState(null);
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [desc, setDesc]     = useState('');
  const [note, setNote]     = useState('');
  const [deciding, setDeciding] = useState(null);   // 'won' | 'lost'
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState(null);
  const [dirty, setDirty]   = useState(false);

  const load = () =>
    fetchEstimate(estimateId).then(e => {
      setEst(e);
      setNumber(e.estimate_number || '');
      setAmount(e.amount != null ? String(e.amount) : '');
      setDesc(e.description || '');
      setDirty(false);
    }).catch(x => setErr(x.message));

  useEffect(() => { load(); }, [estimateId]);

  if (!est) {
    return (
      <div style={S.backdrop} onClick={onClose}>
        <div style={S.sheet}><div style={S.loading}>Loading…</div></div>
      </div>
    );
  }

  const at = STEPS.indexOf(est.status);
  const open = est.status === 'draft' || est.status === 'sent';

  const run = async fn => {
    setBusy(true); setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return false; }
    await load();
    onChanged?.();
    return true;
  };

  const savePricing = () =>
    run(() => priceEstimate(est.id, { number, amount, description: desc }, actor));

  const send = async () => {
    if (dirty) { const ok = await savePricing(); if (!ok) return; }
    run(() => markEstimateSent(est.id, actor));
  };

  const decide = () =>
    run(() => decideEstimate(est.id, deciding, actor, note))
      .then(ok => { if (ok) { setDeciding(null); setNote(''); } });

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        <div style={S.head}>
          <div>
            <div style={S.title}>
              {est.estimate_number ? `Estimate ${est.estimate_number}` : 'Draft estimate'}
            </div>
            <div style={S.sub}>{est.customer?.name || 'No customer'}</div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        <div style={S.stepper}>
          {STEPS.map((s, i) => (
            <div key={s} style={S.step}>
              <span style={{
                ...S.dot,
                ...(i === at ? (s === 'lost' ? S.dotLost : S.dotOn) : {}),
                ...(i < at && at < 2 ? S.dotPast : {}),
              }} />
              <span style={{ ...S.stepWord, ...(i === at ? S.stepWordOn : {}) }}>{s}</span>
            </div>
          ))}
        </div>

        <div style={S.body}>
          {est.job?.issue && (
            <div style={S.block}>
              <div style={S.blockHead}>What the tech scoped</div>
              <div style={S.scope}>{est.job.issue}</div>
            </div>
          )}

          <div style={S.block}>
            <div style={S.blockHead}>
              Pricing
              {!open && <span style={S.locked}>closed</span>}
            </div>

            <label style={S.label}>
              Estimate number <span style={S.req}>required to send</span>
            </label>
            <input
              style={S.input} disabled={!open}
              placeholder="e.g. 4471"
              value={number}
              onChange={e => { setNumber(e.target.value); setDirty(true); }}
            />

            <label style={S.label}>
              Amount <span style={S.opt}>optional — never shown to a tech</span>
            </label>
            <input
              type="number" step="0.01" style={S.input} disabled={!open}
              placeholder="—"
              value={amount}
              onChange={e => { setAmount(e.target.value); setDirty(true); }}
            />

            <label style={S.label}>Scope as quoted</label>
            <textarea
              style={S.area} rows={4} disabled={!open}
              placeholder="What the customer is being quoted for."
              value={desc}
              onChange={e => { setDesc(e.target.value); setDirty(true); }}
            />

            {open && dirty && (
              <button style={S.save} disabled={busy} onClick={savePricing}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>

          <div style={S.block}>
            <div style={S.blockHead}>History</div>
            <Row k="Created" v={new Date(est.created_at).toLocaleDateString()} />
            {est.sent_at    && <Row k="Sent"    v={new Date(est.sent_at).toLocaleDateString()} />}
            {est.decided_at && <Row k="Decided" v={new Date(est.decided_at).toLocaleDateString()} />}
            {est.decided_note && <Row k="Reason" v={est.decided_note} />}
            {est.spawned_job_id && <Row k="Job created" v="yes" />}
          </div>
        </div>

        <div style={S.foot}>
          {est.status === 'draft' && (
            <>
              <button
                style={{ ...S.primary, ...(number.trim() ? {} : S.primaryOff) }}
                disabled={!number.trim() || busy}
                onClick={send}
              >
                Mark estimate sent
              </button>
              <div style={S.footNote}>
                {number.trim()
                  ? 'The job moves to Estimate sent — waiting on the customer.'
                  : 'Give it a number first. Until it goes out, the job stays in Returns.'}
              </div>
            </>
          )}

          {est.status === 'sent' && !deciding && (
            <>
              <div style={S.row}>
                <button style={S.won}  onClick={() => setDeciding('won')}>Won</button>
                <button style={S.lost} onClick={() => setDeciding('lost')}>Lost</button>
              </div>
              <div style={S.footNote}>
                Won sends the job back to Open so it can be scheduled. Lost closes it.
              </div>
            </>
          )}

          {est.status === 'sent' && deciding && (
            <>
              <textarea
                style={S.area} rows={2}
                placeholder={deciding === 'lost'
                  ? 'Why did we lose it? Price, timing, went with someone else…'
                  : 'Anything worth recording?'}
                value={note} onChange={e => setNote(e.target.value)}
              />
              <div style={S.row}>
                <button style={S.secondary} onClick={() => { setDeciding(null); setNote(''); }}>
                  Cancel
                </button>
                <button
                  style={deciding === 'won' ? S.won : S.lost}
                  disabled={busy}
                  onClick={decide}
                >
                  {busy ? 'Saving…' : `Confirm ${deciding}`}
                </button>
              </div>
            </>
          )}

          {!open && (
            <div style={S.closed}>
              This estimate is {est.status}. Nothing further to do here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div style={S.roRow}>
      <span style={S.roK}>{k}</span>
      <span style={S.roV}>{v}</span>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,16,.72)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 },
  sheet: { background: '#0b1a2b', width: '100%', maxWidth: 520, maxHeight: '94vh',
           borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
           border: '1px solid #22344c', borderBottom: 0 },
  loading: { color: '#93a6bd', fontSize: 14, padding: 40, textAlign: 'center' },

  head: { display: 'flex', justifyContent: 'space-between', padding: '18px 18px 12px' },
  title: { color: '#eef4fb', fontSize: 20, fontWeight: 700 },
  sub: { color: '#93a6bd', fontSize: 13, marginTop: 3 },
  x: { background: 'transparent', border: 0, color: '#5b6f88', fontSize: 18,
       cursor: 'pointer', padding: 4, height: 28 },

  err: { background: '#7f1d1d', color: '#fecaca', fontSize: 12.5, padding: '8px 18px' },

  stepper: { display: 'flex', justifyContent: 'space-between', padding: '4px 18px 14px' },
  step: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: '50%', background: '#22344c' },
  dotOn: { background: '#4F8CFF', boxShadow: '0 0 0 4px rgba(79,140,255,.18)' },
  dotLost: { background: '#ef4444', boxShadow: '0 0 0 4px rgba(239,68,68,.18)' },
  dotPast: { background: '#19D3BF' },
  stepWord: { color: '#5b6f88', fontSize: 11.5, textTransform: 'capitalize' },
  stepWordOn: { color: '#eef4fb', fontWeight: 600 },

  body: { overflowY: 'auto', padding: '0 18px', flex: 1 },
  block: { background: '#11243a', borderRadius: 12, padding: '14px 15px', marginBottom: 12 },
  blockHead: { display: 'flex', justifyContent: 'space-between', color: '#eef4fb',
               fontSize: 14.5, fontWeight: 600 },
  locked: { color: '#5b6f88', fontSize: 11.5, fontWeight: 400 },
  scope: { color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.55, marginTop: 9,
           whiteSpace: 'pre-wrap' },

  label: { display: 'block', color: '#93a6bd', fontSize: 12, marginTop: 13, marginBottom: 6 },
  req: { color: '#f3a51f', fontSize: 11 },
  opt: { color: '#5b6f88', fontSize: 11 },
  input: { width: '100%', height: 48, background: '#0f1f33', color: '#eef4fb',
           border: '1px solid #22344c', borderRadius: 10, padding: '0 12px', fontSize: 15 },
  area: { width: '100%', background: '#0f1f33', color: '#eef4fb', border: '1px solid #22344c',
          borderRadius: 10, padding: '11px 12px', fontSize: 14, lineHeight: 1.5,
          resize: 'vertical', fontFamily: 'inherit' },
  save: { width: '100%', background: '#19D3BF', color: '#03201c', border: 0, borderRadius: 10,
          padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 12 },

  roRow: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0',
           borderTop: '1px solid #16243a', marginTop: 7 },
  roK: { color: '#5b6f88', fontSize: 12.5, flex: 'none' },
  roV: { color: '#cbd5e1', fontSize: 13, textAlign: 'right' },

  foot: { padding: '14px 18px 18px', borderTop: '1px solid #22344c' },
  primary: { width: '100%', background: '#4F8CFF', color: '#fff', border: 0, borderRadius: 10,
             padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  primaryOff: { background: '#1e293b', color: '#475569', cursor: 'default' },
  row: { display: 'flex', gap: 9 },
  won: { flex: 1, background: '#19D3BF', color: '#03201c', border: 0, borderRadius: 10,
         padding: '13px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  lost: { flex: 1, background: 'transparent', color: '#fca5a5', border: '1px solid #7f1d1d',
          borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  secondary: { flex: 1, background: 'transparent', color: '#93a6bd', border: '1px solid #22344c',
               borderRadius: 10, padding: '13px', fontSize: 14, cursor: 'pointer' },
  footNote: { color: '#5b6f88', fontSize: 11.5, marginTop: 9, lineHeight: 1.5,
              textAlign: 'center' },
  closed: { color: '#93a6bd', fontSize: 13, textAlign: 'center' },
};
