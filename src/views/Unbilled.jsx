// ============================================
// Unbilled — hours and materials, by customer
// ============================================
// WHY THIS EXISTS
//   The finish sheet writes every visit to `time_entries` (310 rows, 728 hours).
//   The old Billing screen read hours from `job_assignments.actual_hours` — a
//   table with 18 rows in it. Two different tables. Billing has never once
//   looked at the one the techs actually fill in. 315 hours and 62 visits
//   carrying materials were invisible.
//
// WHAT THIS DOES
//   Groups every UNBILLED time entry BY CUSTOMER, not by job. That's the whole
//   point: Nordic goes visit → return → return → estimate → won, and each of
//   those wrote its own time_entries row. When you finally bill, you need all
//   of them in front of you — the two earlier trips AND the materials — not
//   whichever single job happens to be in the To Bill column.
//
//   Tick the visits going on the invoice, drop in the invoice ref, mark billed.
//   That stamps billed / billed_at / invoice_ref on those rows and they leave
//   the queue. The `billed` flag already existed; nothing was ever using it.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, jobsApi } from '../services/supabase.js';
import { unbilledBucket as bucketOf } from '../utils/jobResolve.js';
import ArchiveModal from '../components/ArchiveModal.jsx';


// ── BUCKETS ──────────────────────────────────────────────────────────
// The old screen showed every unbilled hour as if you could invoice it. You
// can't. Of ~150 unbilled hours only ~12 are actually invoiceable — the rest
// are waiting on a return, sat on a job somebody marked DEAD, or belong to no
// job at all. Showing them together wastes your time and hides the real
// problem, so an hour now goes in the bucket that says what has to happen next.
export const BUCKETS = [
  { key: 'ready',    label: '✅ Ready to bill',        color: '#22c55e',
    blurb: 'The work is done and the job is closed out. Invoice these.' },
  { key: 'return',   label: '🔄 Waiting on a return',  color: '#ec4899',
    blurb: 'You CANNOT bill these until someone goes back. The customer is waiting, and every day this sits is a day of unbilled work AND a day of bad service.' },
  { key: 'progress', label: '🚧 Still in progress',    color: '#3b82f6',
    blurb: 'Scheduled, estimating, or mid-job. Not billable yet — nothing to do here.' },
  { key: 'dead',     label: '⚠️ Worked, then killed',  color: '#f59e0b',
    blurb: 'A tech spent these hours and the job was later marked dead, lost or archived. Somebody has to DECIDE: bill it anyway, or archive it as cost DRH absorbed. Right now it is just sitting there.' },
  { key: 'nojob',    label: '🔗 No job on the board',  color: '#94a3b8',
    blurb: 'Work with no job attached. It cannot be tracked, chased or invoiced until it is linked.' },
  { key: 'nohours',  label: '⏱ To bill, no hours',    color: '#f97316',
    blurb: 'The job is marked To Bill but nobody logged time against it. It shows as done on the board and is invisible on an invoice. Either the hours were never clocked, or it should not be in To Bill. Open it and decide.' },
  { key: 'mismatch', label: '❓ Job says billed',      color: '#a855f7',
    blurb: 'The job is marked billed but this time entry never was. A reconciliation gap — check whether it made the invoice.' },
];
export const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map(b => [b.key, b]));


const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

// A single visit longer than this is almost certainly a tech who never clocked
// out. Flag it — don't silently put it on an invoice.
const SUSPICIOUS_HOURS = 12;

const hrs = (mins) => (mins || 0) / 60;
const fmtH = (h) => `${(Math.round(h * 10) / 10).toFixed(1)}h`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

export default function Unbilled({ onBack, userEmail }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [groups, setGroups] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [invoiceRef, setInvoiceRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data: entries, error } = await supabase
        .from('time_entries')
        .select('id, customer_id, customer_name_raw, event_title, event_start, tech_name, total_minutes, disposition, notes, materials, billed, archived, job_id, calendar_event_id')
        .or('billed.is.null,billed.eq.false')
        .or('archived.is.null,archived.eq.false')
        // .gt('total_minutes', 0) REMOVED — it dropped every visit with no
        // clocked time straight out of the result set, with nothing on any
        // screen to say so. A job could read "To Bill" on the board and simply
        // not exist in Billing. Zero-hour work now surfaces in its own bucket.
        .order('event_start', { ascending: true });
      if (error) throw error;

      // The job's STATUS is what decides whether an hour can actually be
      // invoiced. Most time entries have a null job_id and link through
      // calendar_event_id instead, so we resolve both ways.
      const { data: jobRows } = await supabase
        .from('jobs')
        .select('id, status, calendar_event_id, customer_name, updated_at')
        .limit(5000);
      const jobById = {}, jobByEvent = {};
      (jobRows || []).forEach(j => {
        jobById[j.id] = j;
        if (j.calendar_event_id) jobByEvent[j.calendar_event_id] = j;
      });
      const jobFor = (e) => jobById[e.job_id] || jobByEvent[e.calendar_event_id] || null;

      const ids = [...new Set((entries || []).map(e => e.customer_id).filter(Boolean))];
      let cust = {};
      if (ids.length) {
        const { data: cs } = await supabase.from('customers').select('id, name, short_code').in('id', ids);
        (cs || []).forEach(c => { cust[c.id] = c; });
      }

      const byCustomer = {};
      (entries || []).forEach(e0 => {
        const job = jobFor(e0);
        // Zero clocked minutes is its own problem, not a 'ready to bill'.
        const b0 = bucketOf(job);
        const e = { ...e0, _job: job,
                    _bucket: (b0 === 'ready' && !(e0.total_minutes > 0)) ? 'nohours' : b0 };
        // Group on the customer UUID where we have one. Where we don't, the
        // entry is ORPHANED — it still needs billing, but it also needs a
        // client attached, and we say so instead of quietly merging it in.
        const key = `${e._bucket}::${e.customer_id || `orphan:${e.customer_name_raw || 'unknown'}`}`;
        byCustomer[key] ||= {
          key,
          bucket: e._bucket,
          job: e._job,
          customerId: e.customer_id || null,
          name: cust[e.customer_id]?.name || e.customer_name_raw || 'Unknown',
          shortCode: cust[e.customer_id]?.short_code || null,
          orphan: !e.customer_id,
          visits: [],
        };
        byCustomer[key].visits.push(e);
      });

      // ── Jobs that are marked done and have NO time entry pointing at them.
      // Nothing in this screen ever looked for these, because it only ever
      // walked time_entries. A ticket dispositioned "Bill it" from the audit
      // writes a job status and no hours, so it sat on the board as To Bill and
      // did not exist here. That is the ticket "floating in space."
      // The entries query above only returns UNBILLED time. So a job whose hours
      // were already invoiced has no rows here and looked like it had no hours
      // at all — Womack, Temple and BG Longmont were landing in this bucket
      // when they are simply done and paid. Ask the database which jobs have
      // ANY time against them, billed or not, before calling one empty.
      const { data: everBilled } = await supabase
        .from('time_entries').select('job_id, calendar_event_id')
        .not('billed', 'is', false)
        .limit(5000);
      const hasAnyTime = new Set();
      (everBilled || []).forEach(t => {
        if (t.job_id) hasAnyTime.add(t.job_id);
        if (t.calendar_event_id && jobByEvent[t.calendar_event_id])
          hasAnyTime.add(jobByEvent[t.calendar_event_id].id);
      });

      const seenJobIds = new Set((entries || []).map(e => e.job_id).filter(Boolean));
      (entries || []).forEach(e => { const j = jobFor(e); if (j) seenJobIds.add(j.id); });
      (jobRows || [])
        .filter(j => ['complete', 'to_bill'].includes(j.status)
                  && !seenJobIds.has(j.id) && !hasAnyTime.has(j.id))
        .forEach(j => {
          const key = `nohours::job:${j.id}`;
          byCustomer[key] = {
            key, bucket: 'nohours', job: j, customerId: null,
            name: j.customer_name || 'Unknown', shortCode: null,
            orphan: false, noEntries: true, visits: [],
          };
        });

      const list = Object.values(byCustomer).map(g => ({
        ...g,
        waitingDays: g.bucket === 'return' ? daysSince(g.visits[0]?.event_start) : 0,
        hours: g.visits.reduce((s, v) => s + hrs(v.total_minutes), 0),
        materialVisits: g.visits.filter(v => v.materials && v.materials.trim()).length,
        suspicious: g.visits.filter(v => hrs(v.total_minutes) > SUSPICIOUS_HOURS).length,
        oldest: g.visits[0]?.event_start,
      })).sort((a, b) => b.hours - a.hours);

      setGroups(list);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const [tab, setTab] = useState('ready');

  const byBucket = useMemo(() => {
    const m = {};
    BUCKETS.forEach(b => { m[b.key] = { hours: 0, visits: 0, groups: [] }; });
    groups.forEach(g => {
      const b = m[g.bucket];
      if (!b) return;
      b.hours += g.hours;
      b.visits += g.visits.length;
      b.groups.push(g);
    });
    // Returns sorted by what they're COSTING you: hours held x days waiting.
    // The most expensive, longest-ignored return is always at the top.
    m.return.groups.sort((a, b) => (b.hours * (b.waitingDays + 1)) - (a.hours * (a.waitingDays + 1)));
    return m;
  }, [groups]);

  const shown = useMemo(() => {
    const inTab = byBucket[tab]?.groups || [];
    const q = search.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter(g =>
      g.name.toLowerCase().includes(q) || (g.shortCode || '').toLowerCase().includes(q));
  }, [byBucket, tab, search]);

  const toggle = (id) => setPicked(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const pickAll = (g) => setPicked(p => {
    const n = new Set(p);
    const all = g.visits.every(v => n.has(v.id));
    g.visits.forEach(v => all ? n.delete(v.id) : n.add(v.id));
    return n;
  });

  // Everything currently ticked, across every customer
  const sel = useMemo(() => {
    const rows = groups.flatMap(g => g.visits.filter(v => picked.has(v.id)).map(v => ({ ...v, _g: g })));
    return {
      rows,
      hours: rows.reduce((s, v) => s + hrs(v.total_minutes), 0),
      materials: rows.filter(v => v.materials && v.materials.trim()).map(v => v.materials.trim()),
    };
  }, [groups, picked]);

  // Close out a job that is marked done but carries no time. Writes through
  // jobsApi.changeStatus so it lands in job_history and is auditable — the same
  // path every other status move uses.
  const closeNoHours = async (g, target) => {
    if (!g.job?.id) return;
    const label = target === 'billed' ? 'billed' : 'cleared';
    if (!window.confirm(`Mark ${g.name} as ${label}?\n\nNo hours are attached, so nothing goes on an invoice. This only moves the card off the board.`)) return;
    setSaving(true);
    try {
      await jobsApi.changeStatus(g.job.id, target, userEmail,
        target === 'billed'
          ? 'Marked billed from Billing — invoiced outside Overwatch, no hours logged'
          : 'Cleared from Billing — no hours logged, not billable');
      setToast(`${g.name} ${label}`);
      setTimeout(() => setToast(''), 2600);
      await load();
    } catch (e) { setToast('Could not update: ' + (e.message || e)); }
    setSaving(false);
  };

  const markBilled = async () => {
    if (!sel.rows.length) return;
    const n = sel.rows.length;
    if (!window.confirm(`Mark ${n} visit${n > 1 ? 's' : ''} (${fmtH(sel.hours)}) as billed?\n\nThey will leave this queue. This does not create an invoice — do that in QuickBooks.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          billed: true,
          billed_at: new Date().toISOString(),
          invoice_ref: invoiceRef.trim() || null,
        })
        .in('id', sel.rows.map(r => r.id));
      if (error) throw error;
      // ── Write-through to the job card ────────────────────────────
      // Marking time billed used to touch time_entries ONLY. The job stayed in
      // to_bill forever, so the home screen counted 18 jobs owed while only 2
      // hours were genuinely unbilled — 13 of those jobs were already paid.
      // Two switches, nobody flipping both.
      //
      // Now: for each job these entries belong to, if NOTHING unbilled is left
      // on it, the job moves to billed. If any unbilled time remains (partial
      // invoice, a second visit not yet billed) the card stays put — it is
      // still genuinely owed. changeStatus writes job_history, so it's auditable.
      try {
        // WAS: sel.rows.map(r => r.job_id) — and 320 of 357 time entries have a
        // NULL job_id, because they link to their job through calendar_event_id
        // instead. So this list came back empty on ~90% of invoices and the
        // write-through below never ran: the hours were marked billed and the
        // job card stayed in To Bill permanently. That is why Temple, Womack
        // and Shelton sit on the board as unbilled work that was already paid.
        //
        // `_job` is the job this screen already resolved for the row (jobFor(),
        // which checks job_id AND calendar_event_id). Use it.
        const jobIds = [...new Set(sel.rows.map(r => r.job_id || r._job?.id).filter(Boolean))];
        for (const jobId of jobIds) {
          // Anything still owed on this job, found the SAME two ways.
          const evIds = [...new Set(sel.rows
            .filter(r => (r.job_id || r._job?.id) === jobId)
            .map(r => r._job?.calendar_event_id || r.calendar_event_id)
            .filter(Boolean))];
          const orParts = [`job_id.eq.${jobId}`,
            ...evIds.map(e => `calendar_event_id.eq.${e}`)];
          const { data: left } = await supabase
            .from('time_entries').select('id')
            .or(orParts.join(','))
            .not('billed', 'is', true)
            .or('archived.is.null,archived.eq.false')
            .limit(1);
          if (left && left.length) continue; // still owed — leave the card alone

          const { data: jobRow } = await supabase
            .from('jobs').select('status').eq('id', jobId).maybeSingle();
          if (jobRow && ['complete', 'to_bill'].includes(jobRow.status)) {
            await jobsApi.changeStatus(
              jobId, 'billed', userEmail,
              invoiceRef.trim() ? `Billed — invoice ${invoiceRef.trim()}` : 'Billed from Unbilled queue'
            );
          }
        }
      } catch (e) {
        // Non-fatal on purpose: the time entries ARE billed at this point.
        // A failure here leaves a stale card, not lost money.
        console.warn('job status write-through failed', e);
      }

      setToast(`${n} visit${n > 1 ? 's' : ''} marked billed ✓`);
      setPicked(new Set());
      setInvoiceRef('');
      await load();
      setTimeout(() => setToast(''), 3500);
    } catch (e) {
      alert('Could not mark billed: ' + (e.message || e));
    }
    setSaving(false);
  };

  // Archive — the REASON matters more than the act. See config/archiveReasons.js:
  // "test" and "warranty" both leave the billing queue, but one never happened
  // and the other is real cost DRH absorbed. Collapsing them would silently
  // make unprofitable customers look profitable. So the class is captured here.
  const doArchive = async (reason) => {
    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userEmail || null,
          archive_reason: reason,
        })
        .in('id', sel.rows.map(r => r.id));
      if (error) throw error;
      setToast(`${sel.rows.length} visit(s) archived — not billed`);
      setPicked(new Set());
      setArchiving(false);
      await load();
      setTimeout(() => setToast(''), 3500);
    } catch (e) {
      alert('Could not archive: ' + (e.message || e) + '\n\nIf this says the column does not exist, run migration 023 first.');
      setArchiving(false);
    }
  };

  const page = { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', paddingBottom: 160 };
  const card = { background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: 12, marginBottom: 10 };

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading unbilled work…</div>;
  if (err) return <div style={{ ...page, padding: 20 }}>Couldn’t load: {err}</div>;

  return (
    <div style={page}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Home</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>💵 Billing</span>
          <button onClick={load} style={{ marginLeft: 'auto', background: '#1e293b', border: 'none', color: '#94a3b8', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>↻</button>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {BUCKETS.map(b => {
            const d = byBucket[b.key] || { hours: 0, visits: 0 };
            const on = tab === b.key;
            return (
              <button key={b.key} onClick={() => { setTab(b.key); setPicked(new Set()); setOpenKey(null); }}
                style={{ background: on ? `${b.color}22` : '#1e293b', border: `1px solid ${on ? b.color : 'transparent'}`,
                  borderRadius: 9, padding: '7px 11px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 11, color: on ? b.color : '#94a3b8', fontWeight: 600 }}>{b.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: on ? b.color : '#e2e8f0' }}>
                  {fmtH(d.hours)} <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>· {d.visits}</span>
                </div>
              </button>
            );
          })}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="find a customer…"
            style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#fff', fontSize: 13, width: 170, flexShrink: 0 }} />
        </div>
      </div>

      {toast && (
        <div style={{ background: '#166534', color: '#dcfce7', padding: '10px 14px', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>{toast}</div>
      )}

      <div style={{ padding: 14, maxWidth: 900, margin: '0 auto' }}>
        <div style={{ ...card, background: `${BUCKET_BY_KEY[tab].color}12`, border: `1px solid ${BUCKET_BY_KEY[tab].color}44` }}>
          <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.55 }}>{BUCKET_BY_KEY[tab].blurb}</div>
        </div>

        {shown.length === 0 && (
          <div style={{ ...card, textAlign: 'center', color: '#94a3b8' }}>Nothing in here. Good.</div>
        )}

        {shown.map(g => {
          const open = openKey === g.key;
          const allPicked = g.visits.length > 0 && g.visits.every(v => picked.has(v.id));
          return (
            <div key={g.key} style={{ ...card, borderColor: g.orphan ? '#f59e0b' : '#1e293b' }}>
              <div onClick={() => setOpenKey(open ? null : g.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <span style={{ color: '#64748b', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.name} {g.shortCode && <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700 }}>{g.shortCode}</span>}
                  </div>
                  {g.bucket === 'return' && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ec4899', marginTop: 2 }}>
                      Customer waiting {g.waitingDays} day{g.waitingDays === 1 ? '' : 's'} · {fmtH(g.hours)} of work you cannot invoice until someone goes back
                    </div>
                  )}
                  {g.noEntries && (
                    <div style={{ fontSize: 12.5, color: '#fdba74', marginTop: 3, lineHeight: 1.5 }}>
                      Marked done, but nobody logged time against it. There is nothing to put on an invoice.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {g.noEntries
                      ? 'no time logged'
                      : `${g.visits.length} visit${g.visits.length > 1 ? 's' : ''} · since ${fmtD(g.oldest)}`}
                    {!g.noEntries && g.materialVisits > 0 && <span style={{ color: '#f59e0b' }}> · {g.materialVisits} with materials</span>}
                    {g.suspicious > 0 && <span style={{ color: '#ef4444' }}> · ⚠️ {g.suspicious} over {SUSPICIOUS_HOURS}h — check it</span>}
                  </div>
                  {g.orphan && (
                    <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 2 }}>
                      ⚠️ Not linked to a client — link it before you invoice
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 19, fontWeight: 800, color: '#22c55e', whiteSpace: 'nowrap' }}>{fmtH(g.hours)}</span>
              </div>

              {/* A job with no time has nothing to tick, so the checkbox flow is a
                  dead end — "Select all visits" selects nothing and the invoice
                  button stays dead. What it needs is a DECISION, so offer the
                  three that actually exist. */}
              {open && g.noEntries && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 10,
                              display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button onClick={() => window.open(`/board?job=${g.job.id}`, '_self')}
                    style={{ background: '#1d4ed8', border: 'none', borderRadius: 8, color: '#fff',
                             fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Open the ticket
                  </button>
                  <button onClick={() => closeNoHours(g, 'billed')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #22c55e', borderRadius: 8,
                             color: '#22c55e', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Invoiced elsewhere — mark billed
                  </button>
                  <button onClick={() => closeNoHours(g, 'archived')} disabled={saving}
                    style={{ background: 'transparent', border: '1px solid #64748b', borderRadius: 8,
                             color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: '9px 14px',
                             cursor: 'pointer', fontFamily: 'inherit' }}>
                    Not billable — clear it
                  </button>
                  <div style={{ flexBasis: '100%', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                    If the work really happened and the hours were never entered, open the
                    ticket and log the visit — that is the only route that puts it on an invoice.
                  </div>
                </div>
              )}

              {open && !g.noEntries && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
                  <button onClick={() => pickAll(g)}
                    style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', fontSize: 12, padding: '4px 10px', cursor: 'pointer', marginBottom: 8 }}>
                    {allPicked ? 'Deselect all' : 'Select all visits'}
                  </button>

                  {g.visits.map(v => {
                    const h = hrs(v.total_minutes);
                    const on = picked.has(v.id);
                    const sus = h > SUSPICIOUS_HOURS;
                    return (
                      <div key={v.id} onClick={() => toggle(v.id)}
                        style={{ display: 'flex', gap: 10, padding: '8px 9px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                          background: on ? '#0e293f' : '#0f172a', border: `1px solid ${on ? '#00c8e8' : sus ? '#ef4444' : '#1e293b'}` }}>
                        <span style={{ color: on ? '#00c8e8' : '#475569', fontSize: 15 }}>{on ? '☑' : '☐'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
                            {fmtD(v.event_start)} · {v.tech_name || 'unknown tech'}
                            {v.disposition && <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {v.disposition.replace('_', ' ')}</span>}
                          </div>
                          {v.event_title && <div style={{ fontSize: 12, color: '#94a3b8' }}>{v.event_title}</div>}
                          {v.notes && <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3, whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
                          {v.materials && v.materials.trim() && (
                            <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 3, background: '#78350f33', borderRadius: 5, padding: '4px 7px' }}>
                              🔧 {v.materials.trim()}
                            </div>
                          )}
                          {sus && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 3 }}>⚠️ {fmtH(h)} on one visit — somebody probably never clocked out</div>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: sus ? '#ef4444' : '#22c55e', whiteSpace: 'nowrap' }}>{fmtH(h)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {archiving && (
        <ArchiveModal
          count={sel.rows.length}
          hours={fmtH(sel.hours)}
          onCancel={() => setArchiving(false)}
          onConfirm={doArchive}
        />
      )}

      {/* Selection bar — everything ticked, across every customer */}
      {sel.rows.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 64, background: '#1a1a2e', borderTop: '2px solid #22c55e', padding: '12px 14px', zIndex: 20 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#22c55e' }}>
                {sel.rows.length} visit{sel.rows.length > 1 ? 's' : ''} · {fmtH(sel.hours)}
              </span>
              <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="invoice # (optional)"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#fff', fontSize: 13, width: 150 }} />
              <button onClick={() => setPicked(new Set())}
                style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Clear</button>
              <button onClick={() => setArchiving(true)} disabled={saving}
                title="Junk / test data. Leaves the queue WITHOUT being marked billed."
                style={{ background: 'none', border: '1px solid #64748b', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                🗑️ Archive (not billable)
              </button>
              <button onClick={markBilled} disabled={saving}
                style={{ marginLeft: 'auto', background: '#22c55e', border: 'none', color: '#052e16', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving…' : 'Mark billed'}
              </button>
            </div>
            {sel.materials.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24', background: '#78350f33', borderRadius: 6, padding: '6px 9px' }}>
                🔧 <b>Materials on this invoice:</b> {sel.materials.join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
