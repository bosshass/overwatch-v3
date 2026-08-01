import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import BillingSheet from './BillingSheet';

// ============================================================================
// BillingView — jobs that have left the board.
//
// Good to go means field work is finished and time has been logged. These jobs
// are not on the board — the board is ops. This is the handoff to Accounting.
//
// For now this is a read-only list. The Jovelin connection, QBO push, and
// invoice workflow will be built here when that integration is ready. The
// surface exists now so the board stays clean and nothing falls into a void.
// ============================================================================

const JOB_SELECT = `
  *,
  customer:customers ( id, unique_id, name, address, phone, cs_number ),
  assignments:job_assignments (
    id, tech_id, day_number, scheduled_for, estimated_hours,
    is_complete, calendar_event_id,
    tech:techs ( id, name, email, calendar_id, color )
  )
`;

export default function BillingView({ actor }) {
  const [jobs, setJobs] = useState([]);
  const [entries, setEntries] = useState({});   // job_id -> [time_entries]
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_SELECT)
      .eq('status', 'good_to_go')
      .order('updated_at', { ascending: false });

    if (error) { setErr(error.message); setLoading(false); return; }
    const list = data || [];
    setJobs(list);

    if (list.length) {
      const ids = list.map(j => j.id);
      const { data: te } = await supabase
        .from('time_entries')
        .select('job_id, total_minutes, tech_name, tech_email, billable, billed')
        .in('job_id', ids);
      const byJob = {};
      for (const t of te || []) {
        byJob[t.job_id] = [...(byJob[t.job_id] || []), t];
      }
      setEntries(byJob);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalMins = jobId => (entries[jobId] || [])
    .reduce((n, t) => n + (t.total_minutes || 0), 0);

  if (loading) return <div style={S.msg}>Loading…</div>;
  if (err)     return <div style={S.err}>{err}</div>;

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <div>
          <div style={S.title}>Billing</div>
          <div style={S.sub}>
            {jobs.length === 0
              ? 'Nothing waiting — all clear'
              : `${jobs.length} job${jobs.length === 1 ? '' : 's'} ready for Accounting`}
          </div>
        </div>
        <div style={S.totalRow}>
          <span style={S.totalHrs}>
            {(Object.values(entries).flat()
              .reduce((n, t) => n + (t.total_minutes || 0), 0) / 60).toFixed(1)}h
          </span>
          <span style={S.totalLabel}>total logged</span>
        </div>
      </div>

      {jobs.length === 0
        ? (
          <div style={S.empty}>
            No jobs in the billing queue. When field work is finished and hours are
            logged, jobs move here automatically.
          </div>
        )
        : (
          <div style={S.list}>
            {jobs.map(j => {
              const c = j.customer || {};
              const te = entries[j.id] || [];
              const hrs = totalMins(j.id) / 60;
              const techs = [...new Set(te.map(t => t.tech_name || t.tech_email).filter(Boolean))];
              const movedAt = new Date(j.updated_at);

              return (
                <button key={j.id} style={S.row} onClick={() => setOpen(j)}>
                  <div style={S.rowLeft}>
                    <div style={S.rowCust}>{c.name || 'No customer'}</div>
                    <div style={S.rowSub}>
                      {c.unique_id && <span style={S.code}>{c.unique_id}</span>}
                      {c.cs_number && <span style={S.code}>CS {c.cs_number}</span>}
                    </div>
                    {j.issue && <div style={S.rowIssue}>{j.issue}</div>}
                    {techs.length > 0 && (
                      <div style={S.rowTechs}>{techs.join(', ')}</div>
                    )}
                  </div>

                  <div style={S.rowRight}>
                    <div style={S.rowHrs}>{hrs.toFixed(1)}h</div>
                    <div style={S.rowDate}>
                      {movedAt.toLocaleDateString(undefined,
                        { month: 'short', day: 'numeric' })}
                    </div>
                    {te.some(t => t.billed) && (
                      <div style={S.billed}>billed</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

      {open && (
        <BillingSheet
          job={open}
          actor={actor}
          onClose={() => setOpen(null)}
          onChanged={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 16, background: '#0b1220', maxWidth: 720, margin: '0 auto' },
  msg: { color: '#94a3b8', padding: 24 },
  err: { background: '#7f1d1d', color: '#fecaca', padding: 12, borderRadius: 8, margin: 16 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 3 },
  totalRow: { display: 'flex', alignItems: 'baseline', gap: 6 },
  totalHrs: { color: '#14b8a6', fontSize: 24, fontWeight: 800 },
  totalLabel: { color: '#64748b', fontSize: 12 },
  empty: { background: '#111c2e', borderRadius: 10, padding: 24,
           color: '#64748b', fontSize: 13, lineHeight: 1.6 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
         gap: 12, background: '#111c2e', border: '1px solid #1e293b', borderRadius: 10,
         padding: '12px 14px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  rowLeft: { flex: 1, minWidth: 0 },
  rowCust: { color: '#f1f5f9', fontSize: 15, fontWeight: 600 },
  rowSub: { display: 'flex', gap: 8, marginTop: 2 },
  code: { color: '#475569', fontSize: 11 },
  rowIssue: { color: '#94a3b8', fontSize: 12, marginTop: 4,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowTechs: { color: '#64748b', fontSize: 11, marginTop: 3 },
  rowRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
              gap: 4, flexShrink: 0 },
  rowHrs: { color: '#14b8a6', fontSize: 18, fontWeight: 800 },
  rowDate: { color: '#475569', fontSize: 11 },
  billed: { color: '#14b8a6', fontSize: 10, fontWeight: 700 },
  note: { color: '#334155', fontSize: 11, marginTop: 24, lineHeight: 1.5 },
};
