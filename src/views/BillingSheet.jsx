import { useState, useEffect } from 'react';
import {
  fetchTimeEntries, markBilled, markNonBillable, closeJob, setInvoiceNumber,
} from '../services/jobs';
import { NON_BILLABLE_REASONS, canClose } from '../utils/lanes';

// ============================================================================
// BillingSheet — Accounting's view of a finished job.
//
// Billing used to open TicketSheet, which is the BOARD's ticket: lane moves,
// the scheduler, reschedule and finish buttons. None of that is Accounting's
// job. Work that reaches this queue is done; the only questions left are what
// gets billed, on which invoice, and can it close.
//
// Three things and nothing else:
//   1. Every time entry — who, when, how long — resolved to billed or written
//      off with a reason. Nothing sits in limbo.
//   2. The invoice number.
//   3. Close, once every entry is resolved. That gate lives in canClose().
// ============================================================================

export default function BillingSheet({ job, actor, onClose, onChanged }) {
  const [entries, setEntries] = useState([]);
  const [invoice, setInvoice] = useState(job.invoice_number || '');
  const [invoiceSaved, setInvoiceSaved] = useState(false);
  const [pickReason, setPickReason] = useState(null);   // entry id awaiting a reason
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const c = job.customer || {};

  const reload = () =>
    fetchTimeEntries(job.id).then(setEntries).catch(e => setErr(e.message));

  useEffect(() => { reload(); }, [job.id]);

  const live = entries.filter(t => !t.archived);
  const totalHrs = live.reduce((n, t) => n + (t.total_minutes || 0), 0) / 60;
  const billableHrs = live
    .filter(t => t.billable !== false)
    .reduce((n, t) => n + (t.total_minutes || 0), 0) / 60;
  const verdict = canClose(live);

  const act = async fn => {
    setBusy(true); setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return false; }
    await reload();
    return true;
  };

  const saveInvoice = async () => {
    const ok = await act(() => setInvoiceNumber(job.id, invoice, actor));
    if (ok) { setInvoiceSaved(true); setTimeout(() => setInvoiceSaved(false), 2000); }
  };

  const close = async () => {
    const ok = await act(() => closeJob(job, actor));
    if (ok) onChanged?.();
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        <div style={S.head}>
          <div>
            <div style={S.title}>{c.name || job.customer_name || 'No customer'}</div>
            <div style={S.sub}>
              {c.unique_id}{c.cs_number ? ` · CS ${c.cs_number}` : ''}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {job.issue && <div style={S.issue}>{job.issue}</div>}
        {err && <div style={S.err}>{err}</div>}

        {/* ── Hours ──────────────────────────────────────────────────── */}
        <div style={S.sectionHead}>
          Hours
          <span style={S.totals}>
            {billableHrs.toFixed(1)}h billable
            {billableHrs !== totalHrs && ` · ${totalHrs.toFixed(1)}h logged`}
          </span>
        </div>

        {live.length === 0 && <div style={S.none}>No time entries.</div>}

        {live.map(t => {
          const resolved = t.billed || t.billable === false;
          return (
            <div key={t.id} style={{ ...S.entry, ...(resolved ? S.entryDone : {}) }}>
              <div style={S.entryTop}>
                <span style={S.entryTech}>{t.tech_name || t.tech_email || 'Unknown tech'}</span>
                <span style={S.entryDate}>
                  {new Date(t.event_start || t.created_at).toLocaleDateString(undefined,
                    { month: 'short', day: 'numeric' })}
                </span>
                <span style={S.entryHrs}>{((t.total_minutes || 0) / 60).toFixed(1)}h</span>
              </div>

              {t.notes && <div style={S.entryNotes}>{t.notes}</div>}
              {t.materials && <div style={S.entryMats}>Materials: {t.materials}</div>}

              {t.billed && <div style={S.tagBilled}>billed</div>}
              {t.billable === false && (
                <div style={S.tagNb}>not billable — {t.non_billable_reason}</div>
              )}

              {!resolved && pickReason !== t.id && (
                <div style={S.entryActions}>
                  <button style={S.billBtn} disabled={busy}
                          onClick={() => act(() => markBilled(t.id, actor))}>
                    Mark billed
                  </button>
                  <button style={S.nbBtn} disabled={busy}
                          onClick={() => setPickReason(t.id)}>
                    Not billable
                  </button>
                </div>
              )}

              {/* A write-off always carries a reason. No silent zeroing. */}
              {pickReason === t.id && (
                <div style={S.reasons}>
                  {NON_BILLABLE_REASONS.map(r => (
                    <button key={r} style={S.reason} disabled={busy}
                            onClick={async () => {
                              await act(() => markNonBillable(t.id, r, actor));
                              setPickReason(null);
                            }}>
                      {r}
                    </button>
                  ))}
                  <button style={S.cancel} onClick={() => setPickReason(null)}>cancel</button>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Invoice ────────────────────────────────────────────────── */}
        <div style={S.sectionHead}>Invoice</div>
        <div style={S.invoiceRow}>
          <input
            style={S.input}
            placeholder="Invoice number"
            value={invoice}
            onChange={e => { setInvoice(e.target.value); setInvoiceSaved(false); }}
          />
          <button style={S.save} disabled={busy || invoice === (job.invoice_number || '')}
                  onClick={saveInvoice}>
            {invoiceSaved ? 'Saved' : 'Save'}
          </button>
        </div>

        <div style={S.spacer} />

        {/* ── Close ──────────────────────────────────────────────────── */}
        <div style={S.footer}>
          {!verdict.ok && <div style={S.gate}>{verdict.reason}</div>}
          <button style={{ ...S.close, ...(verdict.ok ? {} : S.closeOff) }}
                  disabled={!verdict.ok || busy} onClick={close}>
            {busy ? 'Working…' : 'Close job'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
              display: 'flex', justifyContent: 'flex-end', zIndex: 60 },
  sheet: { background: '#111c2e', width: 'min(460px, 100%)', height: '100%',
           display: 'flex', flexDirection: 'column',
           padding: '18px 18px 0', overflowY: 'auto' },

  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },

  issue: { color: '#cbd5e1', fontSize: 14, marginTop: 12, paddingLeft: 10,
           borderLeft: '3px solid #3b82f6', lineHeight: 1.4 },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px',
         borderRadius: 8, marginTop: 12, fontSize: 13 },

  sectionHead: { color: '#64748b', fontSize: 11, textTransform: 'uppercase',
                 letterSpacing: .5, marginTop: 22, marginBottom: 8,
                 display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  totals: { color: '#94a3b8', fontSize: 12, textTransform: 'none', letterSpacing: 0 },
  none: { color: '#64748b', fontSize: 13, padding: '6px 0' },

  entry: { background: '#0b1220', borderRadius: 8, padding: '10px 12px', marginBottom: 8 },
  entryDone: { opacity: .62 },
  entryTop: { display: 'flex', alignItems: 'baseline', gap: 8 },
  entryTech: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  entryDate: { color: '#64748b', fontSize: 11, marginLeft: 'auto' },
  entryHrs: { color: '#f1f5f9', fontSize: 14, fontWeight: 700 },
  entryNotes: { color: '#94a3b8', fontSize: 12, marginTop: 6, lineHeight: 1.4 },
  entryMats: { color: '#64748b', fontSize: 11, marginTop: 4 },

  tagBilled: { color: '#4ade80', fontSize: 11, fontWeight: 700, marginTop: 6 },
  tagNb: { color: '#94a3b8', fontSize: 11, marginTop: 6 },

  entryActions: { display: 'flex', gap: 8, marginTop: 10 },
  billBtn: { flex: 1, background: '#22c55e', color: '#06240f', border: 0, borderRadius: 6,
             padding: '7px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  nbBtn: { flex: 1, background: '#1e293b', color: '#94a3b8', border: 0, borderRadius: 6,
           padding: '7px', fontSize: 13, cursor: 'pointer' },

  reasons: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  reason: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 12,
            padding: '5px 11px', fontSize: 12, cursor: 'pointer' },
  cancel: { background: 'transparent', color: '#64748b', border: 0, fontSize: 12,
            cursor: 'pointer', textDecoration: 'underline' },

  invoiceRow: { display: 'flex', gap: 8 },
  input: { flex: 1, background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
           borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  save: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 8,
          padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  spacer: { flex: 1, minHeight: 20 },
  footer: { position: 'sticky', bottom: 0, background: '#111c2e',
            paddingTop: 12, paddingBottom: 16, marginTop: 'auto' },
  gate: { color: '#64748b', fontSize: 12, marginBottom: 8, paddingLeft: 2 },
  close: { width: '100%', background: '#3b82f6', color: '#fff', border: 0, borderRadius: 8,
           padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  closeOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
};
