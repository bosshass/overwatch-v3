import { useState, useEffect } from 'react';
import {
  reviewGaps, approveForBilling, requestChanges,
  acknowledgePartBilling, markPartNotBillable, NON_BILLABLE_REASONS,
} from '../services/jobs';

// ============================================================================
// OfficeReview — where the tech's work lands.
//
// Nothing is blocked from REACHING this screen. A card with no hours and no
// materials still arrives, because the alternative is it sitting silently on
// a tech's phone until Friday. Gaps are visible here, which is the point.
//
// Time and materials WARN. Parts BLOCK. The difference is not severity, it is
// recoverability: missing hours can be reconstructed from a timesheet or a
// calendar next week, but a billable part that arrived and never made the
// invoice is money already out the door that nobody will ever go looking for.
//
// Either Sara or Shana can approve. No tiers — the record just has to say which.
//
// The office can enter missing time and materials from here rather than
// bouncing to the tech's screen for something they can type themselves.
// ============================================================================

const ago = iso => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d > 0) return `${d}d`;
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  return h > 0 ? `${h}h` : 'just now';
};

export default function OfficeReview({ job, actor, onClose, onDone, onEnterTime, onEnterMaterials }) {
  const [gaps, setGaps]   = useState(null);
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const [nbFor, setNbFor] = useState(null);   // part id awaiting a not-billable reason

  const load = () => reviewGaps(job).then(setGaps);
  useEffect(() => { load(); }, [job.id]);

  const run = async (fn) => {
    setBusy(true); setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return false; }
    return true;
  };

  const approve = async () => {
    if (await run(() => approveForBilling(job, actor))) { onDone?.(); onClose?.(); }
  };
  const kickBack = async () => {
    if (await run(() => requestChanges(job, note, actor))) { onDone?.(); onClose?.(); }
  };

  const blocked = gaps && !gaps.parts.ok;
  const age = ago(job.updated_at);

  const Row = ({ ok, blocks, label, value, children }) => (
    <div style={{ ...S.row, ...(blocks && !ok ? S.rowBlock : {}) }}>
      <span style={{ ...S.icon, color: ok ? '#14b8a6' : blocks ? '#dc2626' : '#d97706' }}>
        {ok ? '✓' : blocks ? '✕' : '!'}
      </span>
      <div style={S.rowText}>
        <div style={S.rowLabel}>{label}</div>
        <div style={S.rowValue}>{value}</div>
      </div>
      <div style={S.rowActions}>{children}</div>
    </div>
  );

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <button style={S.back} onClick={onClose}>←</button>
        </div>

        <div style={S.title}>Office Review</div>
        <div style={S.sub}>{job.customer?.name || job.customer_name}</div>
        {age && <div style={S.age}>Needs review · {age}</div>}

        {err && <div style={S.err}>{err}</div>}

        {!gaps ? (
          <div style={S.loading}>Checking…</div>
        ) : (
          <>
            <div style={S.card}>
              <Row ok label="Disposition" value={job.status?.replace(/_/g, ' ') || '—'} />
              <Row
                ok={gaps.time.ok} label="Time"
                value={gaps.time.ok ? 'Entered' : 'Not entered'}
              >
                {!gaps.time.ok && onEnterTime && (
                  <button style={S.mini} onClick={() => onEnterTime(job)}>Enter</button>
                )}
              </Row>
              <Row
                ok={gaps.materials.ok} label="Materials"
                value={gaps.materials.ok
                  ? (job.materials_none_at ? 'None needed' : 'Logged')
                  : 'Not logged'}
              >
                {!gaps.materials.ok && onEnterMaterials && (
                  <button style={S.mini} onClick={() => onEnterMaterials(job)}>Enter</button>
                )}
              </Row>
              <Row
                ok={gaps.parts.ok} blocks label="Parts"
                value={gaps.parts.ok
                  ? 'Nothing outstanding'
                  : `${gaps.parts.unconfirmed.length} arrived, not confirmed on bill`}
              />
            </div>

            {/* Each unconfirmed part gets its own two ways out: confirm it made
                the bill, or say why it never will. Both stamp who and when. */}
            {!gaps.parts.ok && (
              <div style={S.parts}>
                {gaps.parts.unconfirmed.map(p => (
                  <div key={p.id} style={S.part}>
                    <div style={S.partTop}>
                      <span style={S.partName}>{p.description} ×{p.qty}</span>
                      <button
                        style={S.confirm} disabled={busy}
                        onClick={async () => {
                          if (await run(() => acknowledgePartBilling(p.id, actor))) load();
                        }}
                      >
                        Confirm
                      </button>
                    </div>
                    {nbFor === p.id ? (
                      <div style={S.reasons}>
                        {NON_BILLABLE_REASONS.map(r => (
                          <button
                            key={r.key} style={S.reason} disabled={busy}
                            onClick={async () => {
                              if (await run(() => markPartNotBillable(p.id, r.key, r.label, actor))) {
                                setNbFor(null); load();
                              }
                            }}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button style={S.nbLink} onClick={() => setNbFor(p.id)}>
                        Not billable…
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <label style={S.label}>Note for the technician</label>
            <textarea
              style={S.textarea} rows={3}
              placeholder="Upload the photos of the panel label and battery test."
              value={note} onChange={e => setNote(e.target.value)}
            />

            <button
              style={{ ...S.approve, ...(blocked ? S.approveOff : {}) }}
              disabled={busy || blocked}
              onClick={approve}
            >
              Approve for Billing
            </button>
            <button
              style={{ ...S.changes, ...(!note.trim() ? S.changesOff : {}) }}
              disabled={busy || !note.trim()}
              onClick={kickBack}
            >
              Request Changes
            </button>

            <div style={S.foot}>
              {blocked
                ? 'Parts confirmation blocks approval. Everything else is a warning.'
                : 'Warnings do not block. Approve when the work is complete and satisfactory.'}
            </div>
          </>
        )}
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
  head: { display: 'flex' },
  back: { background: 'transparent', border: 0, color: '#94a3b8', fontSize: 22,
          cursor: 'pointer', padding: 0, lineHeight: 1 },

  title: { color: '#f1f5f9', fontSize: 22, fontWeight: 800, marginTop: 8 },
  sub: { color: '#94a3b8', fontSize: 14, marginTop: 2 },
  age: { display: 'inline-block', marginTop: 8, background: '#78350f22',
         border: '1px solid #78350f', color: '#fbbf24', borderRadius: 999,
         padding: '3px 10px', fontSize: 12 },

  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  loading: { color: '#64748b', fontSize: 13, marginTop: 20 },

  card: { marginTop: 16, background: '#0f1b2e', border: '1px solid #1e293b',
          borderRadius: 12, overflow: 'hidden' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
         borderBottom: '1px solid #16233a' },
  rowBlock: { background: '#450a0a33', border: '1px solid #7f1d1d', borderRadius: 10 },
  icon: { fontSize: 15, fontWeight: 800, width: 16, textAlign: 'center' },
  rowText: { flex: 1 },
  rowLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  rowValue: { color: '#64748b', fontSize: 12, marginTop: 1, textTransform: 'capitalize' },
  rowActions: { display: 'flex', gap: 6 },
  mini: { background: 'transparent', border: '1px solid #2563eb', color: '#60a5fa',
          borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },

  parts: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  part: { background: '#0f1b2e', border: '1px solid #1e293b', borderRadius: 10, padding: 12 },
  partTop: { display: 'flex', alignItems: 'center', gap: 10 },
  partName: { flex: 1, color: '#e2e8f0', fontSize: 14 },
  confirm: { background: '#dc2626', color: '#fff', border: 0, borderRadius: 8,
             padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  nbLink: { background: 'transparent', border: 0, color: '#64748b', fontSize: 12,
            padding: '8px 0 0', cursor: 'pointer' },
  reasons: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  reason: { background: '#0a1526', color: '#94a3b8', border: '1px solid #1e293b',
            borderRadius: 6, padding: '6px 10px', fontSize: 11, cursor: 'pointer' },

  label: { color: '#94a3b8', fontSize: 13, fontWeight: 600, display: 'block',
           marginTop: 20, marginBottom: 8 },
  textarea: { width: '100%', background: '#0f1b2e', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 10, padding: 12,
              fontSize: 14, resize: 'vertical', fontFamily: 'inherit' },

  approve: { width: '100%', marginTop: 16, background: '#2563eb', color: '#fff', border: 0,
             borderRadius: 12, padding: 15, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  approveOff: { background: '#1e293b', color: '#475569', cursor: 'not-allowed' },
  changes: { width: '100%', marginTop: 8, background: 'transparent', color: '#94a3b8',
             border: '1px solid #1e293b', borderRadius: 12, padding: 14, fontSize: 14,
             fontWeight: 600, cursor: 'pointer' },
  changesOff: { color: '#475569', cursor: 'not-allowed' },

  foot: { color: '#475569', fontSize: 11, marginTop: 14, lineHeight: 1.5 },
};
