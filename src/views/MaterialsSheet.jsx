import { useState, useEffect } from 'react';
import { logMaterials, markNoMaterials, listMaterials } from '../services/jobs';

// ============================================================================
// MaterialsSheet — what came off the truck.
//
// Reached from Needs Your Attention AFTER the job is dispositioned, never
// during it. A tech at a customer's door is not itemising a parts list, and
// one who is forced to will guess. This is the truck, or the end of the day.
//
// No prices. Not cost, not sell. The moment there is a number here somebody
// has to decide whose markup it carries and which item it maps to, and that
// decision belongs on a different screen owned by a different person.
//
// "Nothing used" is an ANSWER, not a blank. Without it there is no way to tell
// a job where nothing was used from a job nobody has got to yet — which is the
// whole reason truck stock is invisible today.
// ============================================================================

const SOURCES = [
  { key: 'truck_stock',      label: 'Truck stock' },
  { key: 'purchased',        label: 'Bought for job' },
  { key: 'customer_supplied', label: 'Customer supplied' },
  { key: 'misc',             label: 'Misc / consumables' },
];

const blank = () => ({ description: '', qty: 1, source: 'truck_stock' });

export default function MaterialsSheet({ job, actor, techId, onClose, onSaved }) {
  const [lines, setLines]   = useState([blank()]);
  const [already, setAlready] = useState([]);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState(null);

  useEffect(() => { listMaterials(job.id).then(setAlready); }, [job.id]);

  const set    = (i, k, v) => setLines(l => l.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const add    = () => setLines(l => [...l, blank()]);
  const remove = i => setLines(l => (l.length === 1 ? [blank()] : l.filter((_, n) => n !== i)));

  const filled = lines.filter(l => l.description.trim());

  const save = async () => {
    setBusy(true); setErr(null);
    const res = await logMaterials(job.id, lines, actor, techId);
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    onSaved?.(res); onClose?.();
  };

  const none = async () => {
    setBusy(true); setErr(null);
    const res = await markNoMaterials(job.id, actor);
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    onSaved?.(res); onClose?.();
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.title}>Materials</div>
            <div style={S.sub}>{job.customer?.name || job.customer_name}</div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {already.length > 0 && (
          <div style={S.already}>
            <div style={S.alreadyHead}>Already logged</div>
            {already.map(m => (
              <div key={m.id} style={S.alreadyRow}>
                <span>{m.description}</span>
                <span style={S.alreadyQty}>×{m.qty}</span>
              </div>
            ))}
          </div>
        )}

        <div style={S.lines}>
          {lines.map((l, i) => (
            <div key={i} style={S.line}>
              <div style={S.lineTop}>
                <input
                  style={S.desc} placeholder="HID reader"
                  value={l.description}
                  onChange={e => set(i, 'description', e.target.value)}
                />
                <input
                  style={S.qty} type="number" min="1" value={l.qty}
                  onChange={e => set(i, 'qty', e.target.value)}
                />
                <button style={S.rm} onClick={() => remove(i)}>✕</button>
              </div>
              <div style={S.sources}>
                {SOURCES.map(sc => (
                  <button
                    key={sc.key}
                    onClick={() => set(i, 'source', sc.key)}
                    style={{ ...S.src, ...(l.source === sc.key ? S.srcOn : {}) }}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button style={S.add} onClick={add}>＋ Add item</button>

        <div style={S.actions}>
          <button style={S.none} disabled={busy} onClick={none}>Nothing used</button>
          <button
            style={{ ...S.save, ...(!filled.length ? S.saveOff : {}) }}
            disabled={busy || !filled.length}
            onClick={save}
          >
            {busy ? 'Saving…' : `Save ${filled.length || ''}`.trim()}
          </button>
        </div>

        <div style={S.note}>
          No prices here — what things cost is decided in the office, against
          this list.
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 70, padding: 16 },
  modal: { background: '#0a1526', borderRadius: 16, padding: 18,
           width: 'min(480px, 100%)', maxHeight: '92vh', overflowY: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: 800 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },

  already: { marginTop: 14, background: '#0f1b2e', borderRadius: 10, padding: '10px 12px' },
  alreadyHead: { color: '#475569', fontSize: 11, textTransform: 'uppercase',
                 letterSpacing: .5, marginBottom: 6 },
  alreadyRow: { display: 'flex', justifyContent: 'space-between', color: '#94a3b8',
                fontSize: 13, padding: '3px 0' },
  alreadyQty: { color: '#64748b' },

  lines: { marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  line: { background: '#0f1b2e', border: '1px solid #1e293b', borderRadius: 10, padding: 10 },
  lineTop: { display: 'flex', gap: 8, alignItems: 'center' },
  desc: { flex: 1, background: '#0a1526', color: '#e2e8f0', border: '1px solid #1e293b',
          borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  qty: { width: 62, background: '#0a1526', color: '#e2e8f0', border: '1px solid #1e293b',
         borderRadius: 8, padding: '9px 8px', fontSize: 14, textAlign: 'center' },
  rm: { background: 'transparent', border: 0, color: '#475569', fontSize: 14, cursor: 'pointer' },

  sources: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  src: { background: '#0a1526', color: '#64748b', border: '1px solid #1e293b',
         borderRadius: 6, padding: '5px 9px', fontSize: 11, cursor: 'pointer' },
  srcOn: { borderColor: '#3b82f6', color: '#bfdbfe', background: '#132038' },

  add: { background: 'transparent', border: 0, color: '#3b82f6', fontSize: 14,
         padding: '10px 0', cursor: 'pointer', textAlign: 'left' },

  actions: { display: 'flex', gap: 8, marginTop: 8 },
  none: { flex: 1, background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 10,
          padding: 13, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  save: { flex: 1, background: '#2563eb', color: '#fff', border: 0, borderRadius: 10,
          padding: 13, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  saveOff: { background: '#1e293b', color: '#475569', cursor: 'not-allowed' },

  note: { color: '#475569', fontSize: 11, marginTop: 14, lineHeight: 1.4 },
};
