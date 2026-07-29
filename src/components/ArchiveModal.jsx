// ============================================
// ArchiveModal — pick a reason, and mean it
// ============================================
// Deliberately NOT a free-text prompt. The class (did a truck roll or not)
// cannot be reconstructed later — nobody remembers in six months whether that
// archived visit was a test entry or a warranty callback DRH ate the cost on.
// So it gets captured here, once, with the consequence spelled out on screen.

import { useState } from 'react';
import { ARCHIVE_REASONS } from '../config/archiveReasons.js';

export default function ArchiveModal({ count, hours, onCancel, onConfirm }) {
  const [reason, setReason] = useState(null);
  const [saving, setSaving] = useState(false);

  const notReal  = ARCHIVE_REASONS.filter(r => r.cls === 'not_real');
  const absorbed = ARCHIVE_REASONS.filter(r => r.cls === 'absorbed');
  const sales    = ARCHIVE_REASONS.filter(r => r.cls === 'sales');

  const go = async () => {
    if (!reason) return;
    setSaving(true);
    await onConfirm(reason);
    setSaving(false);
  };

  const Group = ({ title, blurb, items, color }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 8px', lineHeight: 1.45 }}>{blurb}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map(r => {
          const on = reason === r.key;
          return (
            <button key={r.key} onClick={() => setReason(r.key)}
              style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                background: on ? `${color}22` : '#0f172a',
                border: on ? `2px solid ${color}` : '1px solid #334155',
                color: '#e2e8f0', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 14, fontWeight: on ? 800 : 600, color: on ? color : '#e2e8f0' }}>{r.label}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{r.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#1a1a2e', border: '1px solid #334155', borderRadius: 14, padding: 18, width: '100%', maxWidth: 460, maxHeight: '86vh', overflowY: 'auto' }}>

        <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9' }}>
          Archive {count} visit{count > 1 ? 's' : ''}{hours ? ` · ${hours}` : ''}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', margin: '5px 0 14px', lineHeight: 1.5 }}>
          This leaves the billing queue <b>without being marked billed</b> — nothing enters the
          books as revenue. Nothing is deleted, and it stays on the customer's record.
        </div>

        <Group
          title="It never happened"
          blurb="Not real work. Excluded from revenue AND cost — it vanishes from profitability entirely."
          items={notReal}
          color="#64748b"
        />

        <Group
          title="It happened — we ate it"
          blurb="The truck rolled. A tech's hours went in. This is REAL COST with ZERO REVENUE, and it will show up on the customer's profitability as money DRH lost. Do not file these as 'test'."
          items={absorbed}
          color="#f59e0b"
        />

        <Group
          title="Sales / estimate visit"
          blurb="Real time spent, but not a mistake — this is the normal cost of running a pipeline, not something to minimize the way a callback is. Keeping it separate from 'we ate it' is the point."
          items={sales}
          color="#a855f7"
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: 11, borderRadius: 9, border: '1px solid #334155', background: 'none', color: '#94a3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={go} disabled={!reason || saving}
            style={{ flex: 2, padding: 11, borderRadius: 9, border: 'none',
              background: reason ? '#22c55e' : '#334155',
              color: reason ? '#052e16' : '#64748b',
              fontSize: 14, fontWeight: 800, cursor: reason ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Archiving…' : reason ? 'Archive' : 'Pick a reason'}
          </button>
        </div>
      </div>
    </div>
  );
}
