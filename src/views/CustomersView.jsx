import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';

// ============================================================================
// CustomersView — the customer list and record.
//
// RULES CARRIED OVER FROM THE V9 DEDUP WORK:
//   - unique_id is the canonical ID. Not drh_id — those were garbage from a
//     broken trigger and v3 does not have the column at all.
//   - merged_into rows are HIDDEN everywhere. Always filter is('merged_into', null).
//   - Same name + different cs_number = a different physical location. Keep
//     both. Do not offer to merge them and do not warn about them.
//   - is_active means "has a monitoring subscription", NOT "is a real customer".
//     It is labelled Monitoring here so nobody reads it as active/inactive again.
// ============================================================================

function Detail({ customer, onClose, onNewJob }) {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    supabase.from('jobs')
      .select('id, status, issue, scheduled_date, due_date, created_at')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setJobs(data || []));
  }, [customer.id]);

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.name}>{customer.name}</div>
            <div style={S.sub}>
              {customer.unique_id}
              {customer.cs_number && ` · CS ${customer.cs_number}`}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {customer.address && <div style={S.line}>{customer.address}</div>}
        {customer.phone && <a href={`tel:${customer.phone}`} style={S.link}>{customer.phone}</a>}
        {customer.email && customer.email !== 'Test' && (
          <a href={`mailto:${customer.email}`} style={S.link}>{customer.email}</a>
        )}

        <div style={S.badges}>
          {customer.is_active && <span style={S.badgeOn}>Monitoring</span>}
          {customer.is_cancelled && <span style={S.badgeOff}>Cancelled</span>}
          {customer.customer_type && <span style={S.badge}>{customer.customer_type}</span>}
        </div>

        <button style={S.newJob} onClick={() => onNewJob(customer)}>New job here</button>

        <div style={S.sectionHead}>Work history ({jobs.length})</div>
        {jobs.length === 0
          ? <div style={S.none}>No jobs yet</div>
          : jobs.map(j => (
              <div key={j.id} style={S.job}>
                <span style={S.jobStatus}>{j.status}</span>
                <span style={S.jobIssue}>{j.issue || '—'}</span>
                <span style={S.jobDate}>
                  {(j.scheduled_date || j.created_at || '').slice(0, 10)}
                </span>
              </div>
            ))}
      </div>
    </div>
  );
}

export default function CustomersView({ onNewJob }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    supabase.from('customers')
      .select('*')
      .is('merged_into', null)      // merged duplicates never surface
      .order('name')
      .limit(1000)
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.unique_id || '').toLowerCase().includes(s) ||
      (c.cs_number || '').includes(s) ||
      (c.address || '').toLowerCase().includes(s) ||
      (c.phone || '').includes(s) ||
      // business_name and contact_name arrived with the 409-customer import.
      // Someone looking for "Big O" or asking for a person by name will not
      // know the account is filed as something else.
      (c.business_name || '').toLowerCase().includes(s) ||
      (c.contact_name || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  if (loading) return <div style={S.msg}>Loading…</div>;

  return (
    <div className="ow-full" style={S.wrap}>
      <div style={S.topRow}>
        <input
          style={S.search}
          placeholder="Search customers…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <span style={S.count}>{shown.length}</span>
      </div>

      <div style={S.list}>
        {shown.map(c => (
          <button key={c.id} style={S.row} onClick={() => setSel(c)}>
            <div style={S.rowMain}>
              <span style={S.rowName}>{c.name}</span>
              <span style={S.rowCode}>{c.unique_id}</span>
            </div>
            <div style={S.rowSub}>
              {c.address || 'No address'}
              {c.is_active && <span style={S.mon}> · monitoring</span>}
            </div>
          </button>
        ))}
        {shown.length === 0 && <div style={S.none}>Nothing matches that.</div>}
      </div>

      {sel && (
        <Detail
          customer={sel}
          onClose={() => setSel(null)}
          onNewJob={c => { setSel(null); onNewJob(c); }}
        />
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 16, background: '#0b1220' },
  msg: { padding: 32, color: '#94a3b8' },
  topRow: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 },
  search: { flex: 1, background: '#111c2e', color: '#e2e8f0', border: '1px solid #1e293b',
            borderRadius: 8, padding: '10px 12px', fontSize: 14 },
  count: { color: '#64748b', fontSize: 12 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { textAlign: 'left', background: '#111c2e', border: 0, borderRadius: 8,
         padding: '10px 12px', cursor: 'pointer' },
  rowMain: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  rowName: { color: '#f1f5f9', fontSize: 14, fontWeight: 600 },
  rowCode: { color: '#475569', fontSize: 11 },
  rowSub: { color: '#64748b', fontSize: 12, marginTop: 3 },
  mon: { color: '#14b8a6' },
  none: { color: '#475569', fontSize: 13, padding: 12 },
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex',
              justifyContent: 'flex-end', zIndex: 50 },
  sheet: { background: '#111c2e', width: 'min(440px, 100%)', height: '100%',
           overflowY: 'auto', padding: 18 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  line: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
  link: { color: '#38bdf8', fontSize: 13, textDecoration: 'none', display: 'block', marginTop: 3 },
  badges: { display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  badge: { background: '#1e293b', color: '#94a3b8', fontSize: 11, padding: '3px 9px',
           borderRadius: 12 },
  badgeOn: { background: '#134e4a', color: '#5eead4', fontSize: 11, padding: '3px 9px',
             borderRadius: 12 },
  badgeOff: { background: '#7f1d1d', color: '#fecaca', fontSize: 11, padding: '3px 9px',
              borderRadius: 12 },
  newJob: { width: '100%', marginTop: 16, background: '#22c55e', color: '#06240f', border: 0,
            borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  sectionHead: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                 marginTop: 24, marginBottom: 8, borderTop: '1px solid #1e293b', paddingTop: 14 },
  job: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 0', fontSize: 12 },
  jobStatus: { color: '#38bdf8', fontSize: 11, minWidth: 96 },
  jobIssue: { color: '#cbd5e1', flex: 1 },
  jobDate: { color: '#475569', fontSize: 11 },
};
