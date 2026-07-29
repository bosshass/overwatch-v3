// ============================================
// CustomerPicker — one searchable client picker
// ============================================
// Twelve screens rolled their own customer dropdown. Only some filtered
// `merged_into IS NULL`, so the rest happily offered merged duplicate rows as
// valid targets — which is how work gets attached to a customer record nobody
// looks at again, undoing the dedup work.
//
// This one always excludes merged rows. 481 live customers means a raw
// <select> is unusable, so it's type-to-filter.

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';

const BG = '#0f1729', SURFACE = '#1e293b', LINE = '#334155';
const TEXT = '#e2e8f0', MUTED = '#94a3b8', ACCENT = '#00c8e8';

// Module-level cache — this list is stable within a session and several
// screens mount pickers at once.
let _cache = null;

export async function loadCustomers(force = false) {
  if (_cache && !force) return _cache;
  const { data } = await supabase
    .from('customers').select('id, name')
    .is('merged_into', null)          // never offer a merged duplicate
    .order('name').limit(2000);
  _cache = data || [];
  return _cache;
}

export default function CustomerPicker({
  value, onChange, placeholder = 'Search clients…', customers: provided, compact = false,
}) {
  const [customers, setCustomers] = useState(provided || _cache || []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (provided) { setCustomers(provided); return; }
    let alive = true;
    loadCustomers().then(rows => { if (alive) setCustomers(rows); });
    return () => { alive = false; };
  }, [provided]);

  const selected = customers.find(c => c.id === value);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers.slice(0, 40);
    return customers.filter(c => (c.name || '').toLowerCase().includes(s)).slice(0, 40);
  }, [q, customers]);

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: `${ACCENT}22`, color: ACCENT, borderRadius: 20,
                       padding: '5px 11px', fontSize: 12, fontWeight: 700 }}>{selected.name}</span>
        <button onClick={() => { onChange(null); setQ(''); }}
          style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, cursor: 'pointer' }}>
          clear
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${LINE}`,
                 borderRadius: 8, padding: compact ? '7px 10px' : '9px 12px', color: TEXT,
                 fontSize: compact ? 12 : 13, outline: 'none' }}
      />
      {open && hits.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
                      background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 8,
                      maxHeight: 220, overflowY: 'auto' }}>
          {hits.map(c => (
            <div key={c.id}
              onClick={() => { onChange(c.id, c); setOpen(false); setQ(''); }}
              style={{ padding: '9px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${BG}` }}>
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
