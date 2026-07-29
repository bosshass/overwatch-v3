// ============================================================
// Event Audit — the reconciliation workbench.
// Every calendar event (time_entry) since Jan 1:
//   • assign / re-assign to a real customer (writes time_entries.customer_id)
//   • change the disposition inline (Bill it / Return / Estimate / In progress)
//   • push to the Board as a ticket — ONLY on explicit confirm (never auto)
//   • expand the full history thread (job_history) inline
// ============================================================

import { dispo, DISPO_KEYS } from '../utils/billing.js';
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, jobsApi, notesApi, techsApi, JOB_STATUS, STATUS_INFO } from '../services/supabase.js';
import { archiveEvent, scanForOrphans } from '../services/calendarSync.js';
import { missingLabel } from '../utils/completeness.js';
import { MergeTool } from './BoardView.jsx';
import ArchiveModal from '../components/ArchiveModal.jsx';
import { jobLink as boardJobLink } from '../config/appBase.js';
import { statusLabel } from '../utils/status.js';
import CustomerPicker from '../components/CustomerPicker.jsx';

const SINCE = '2026-01-01';

// Terminal — the work is finished. Everything else is still live.
const DONE_STATUSES = ['billed', 'complete', 'archived', 'dead', 'lost', 'won'];

// disposition -> the board status a ticket should land in
const DISPO_STATUS = {
  bill_it:     JOB_STATUS.TO_BILL,
  estimate:    JOB_STATUS.NEEDS_ESTIMATE,
  return:      JOB_STATUS.RETURN_PENDING,
  in_progress: JOB_STATUS.SCHEDULED,
};

const AUTHORS = {
  'drhservicetech1@gmail.com': 'Austin', 'austin@drhsecurityservices.com': 'Austin',
  'jr@drhsecurityservices.com': 'JR', 'brian@drhsecurityservices.com': 'Brian',
  'trevor@drhsecurityservices.com': 'Trevor', 'subs@drhsecurityservices.com': 'Subs',
  'info@drhsecurityservices.com': 'Office', 'sara@jnbllc.com': 'Sara',
  'shanaparks@drhsecurityservices.com': 'Shana',
};
const author = e => AUTHORS[(e || '').toLowerCase()] || (e ? e.split('@')[0] : 'Office');

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function hrs(mins) { return mins ? (mins / 60).toFixed(1) + 'h' : null; }

function Chip({ color, children }) {
  return <span style={{ background: `${color}20`, color, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

// ── Searchable customer picker ───────────────────────────────
// LOCAL, and different from components/CustomerPicker.jsx — this one takes a
// preloaded `registry` and is wired into the time-entry assign flow. It is a
// duplicate that should fold into the shared picker, but that means touching
// the assign path, so it keeps its own name for now rather than being
// half-migrated. Tracked as leftover from the #6 picker consolidation.
function RegistryPicker({ registry, onPick, onClose }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? registry.filter(c =>
      (c.name || '').toLowerCase().includes(s) || (c.short_code || '').toLowerCase().includes(s) ||
      (c.address || '').toLowerCase().includes(s) || (c.cs_number || '').toLowerCase().includes(s)) : registry;
    return list.slice(0, 40);
  }, [q, registry]);
  return (
    <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code, address…"
          style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 14, padding: '8px 10px', outline: 'none', fontFamily: 'inherit' }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {matches.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, padding: 12, textAlign: 'center' }}>No match for "{q}"</div>}
        {matches.map(c => (
          <div key={c.id} onClick={() => onPick(c)} style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: '#1a1a2e', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.short_code}</span>
            </div>
            {c.address && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{c.address}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomerAudit({ onBack, accessToken }) {
  const userEmail = (typeof localStorage !== 'undefined' && localStorage.getItem('juce_v4_email')) || 'audit';

  const [registry, setRegistry] = useState([]);
  const [events, setEvents] = useState([]);
  const [jobByEvent, setJobByEvent] = useState({}); // calendar_event_id -> { id, status }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [hideDone, setHideDone] = useState(true);   // finished work is noise by default

  const [openPickerId, setOpenPickerId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [dispoBusyId, setDispoBusyId] = useState(null);
  const [confirmTicketId, setConfirmTicketId] = useState(null);
  const [ticketBusyId, setTicketBusyId] = useState(null);
  const [openHistoryId, setOpenHistoryId] = useState(null);
  const [historyById, setHistoryById] = useState({}); // entryId -> { loading, rows, hasJob }

  // Event Audit is now THE orphan queue. Three separate piles of bad data used
  // to live in three places nobody looked at:
  //   1. time_entries with no customer_id  (already here)
  //   2. jobs with no customer_id          (was only on the Board)
  //   3. calendar events created BY HAND   (was buried in the Calendar tab)
  // #3 is detected by the absence of the "Managed by JUC-E" / "Open in JUC-E"
  // marker in the event description — if Overwatch didn't write the event,
  // Overwatch didn't put that marker there.
  const [orphanJobs, setOrphanJobs] = useState([]);
  const [manualEvents, setManualEvents] = useState([]);
  const [adoptBusy, setAdoptBusy] = useState(null);
  const [adoptCustomer, setAdoptCustomer] = useState({});
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Arriving from the home banner (/audit?scan=1) runs the scan immediately.
  // The banner already told her there are 12; making her press Scan to see the
  // same 12 is asking her to prove she meant it.
  useEffect(() => {
    if (!accessToken) return;
    const wants = new URLSearchParams(window.location.search).get('scan');
    if (wants && !scanned) { setScanned(true); scanManual(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);
  const [archiveTarget, setArchiveTarget] = useState(null);   // the entry being archived

  const byId = useMemo(() => { const m = {}; for (const c of registry) m[c.id] = c; return m; }, [registry]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true); setErr(null);
    try {
      const [{ data: reg, error: e1 }, { data: ev, error: e2 }, { data: jobs, error: e3 }] = await Promise.all([
        supabase.from('customers').select('id, name, short_code, cs_number, address').is('merged_into', null).order('name'),
        supabase.from('time_entries')
          .select('id, event_title, event_start, created_at, calendar_event_id, customer_id, tech_name, total_minutes, disposition, materials, notes, customer_name_raw')
          .or('archived.is.null,archived.eq.false')
          .gte('created_at', SINCE).limit(2000),
        supabase.from('jobs').select('id, status, calendar_event_id').not('calendar_event_id', 'is', null).limit(3000),
      ]);
      if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;
      setRegistry(reg || []);
      const map = {};
      for (const j of (jobs || [])) if (j.calendar_event_id) map[j.calendar_event_id] = { id: j.id, status: j.status };
      setJobByEvent(map);
      setEvents((ev || []).sort((a, b) => new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at)));

      // Pile 2 — jobs with no client attached (excluding finished work).
      const { data: oj } = await supabase
        .from('jobs')
        .select('id, customer_name, customer_phone, customer_address, issue, status, tech_name, created_at, calendar_event_id, calendar_id')
        .is('customer_id', null)
        .not('status', 'in', '(billed,archived,dead,lost)')
        .order('created_at', { ascending: true });
      setOrphanJobs(oj || []);
    } catch (e) { setErr(e.message || String(e)); }
    setLoading(false);
  }

  async function assign(entryId, customerId) {
    setSavingId(entryId);
    try {
      const { error } = await supabase.from('time_entries').update({ customer_id: customerId }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === entryId ? { ...e, customer_id: customerId } : e));
      setOpenPickerId(null);
    } catch (e) { alert('Could not save: ' + (e.message || e)); }
    setSavingId(null);
  }

  // Adopt a hand-made calendar event into a real job, keeping the event.
  // Until now this list was READ-ONLY: you could see 18 events that would never
  // bill and do absolutely nothing about them. That is why the number never
  // went down.
  //
  // Stamps calendar_event_id so the event stops showing as an orphan the moment
  // the job exists, and so the tech's disposition finds it later.
  async function adoptEvent(o) {
    setAdoptBusy(o.event.id);
    try {
      const start = o.event.start?.dateTime ? new Date(o.event.start.dateTime) : null;
      const future = start && start > new Date();
      const created = await jobsApi.create({
        customer_name:     (o.event.summary || 'Untitled').replace(/\[[^\]]*\]\s*/g, '').trim(),
        customer_id:       adoptCustomer[o.event.id] || undefined,
        // Future work is scheduled. Past work already happened, so it goes to
        // complete where the billing flow can pick it up rather than sitting
        // on the board pretending it is still upcoming.
        status:            future ? 'scheduled' : 'complete',
        issue:             (o.event.description || '').slice(0, 500) || o.event.summary || '',
        customer_address:  o.event.location || '',
        scheduled_date:    start ? start.toISOString() : undefined,
        calendar_event_id: o.event.id,
        calendar_id:       o.calendar?.id,
      }, `${userEmail} · adopted from calendar`);
      if (created?.id) {
        setManualEvents(prev => prev.filter(x => x.event.id !== o.event.id));
      }
    } catch (e) { alert('Could not create job: ' + (e.message || e)); }
    setAdoptBusy(null);
  }

  // "not trying to create a second ticket" — this scan already DETECTS the
  // duplicate (possibleDuplicate, fuzzy name match against open jobs) but the
  // only button offered was Create job & link, which makes a second one
  // anyway. This attaches the event to the job that's already there instead.
  async function linkToExisting(o) {
    if (!o.possibleDuplicate) return;
    setAdoptBusy(o.event.id);
    try {
      const { error } = await supabase.from('jobs').update({
        calendar_event_id: o.event.id,
        calendar_id: o.calendar?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', o.possibleDuplicate.id);
      if (error) throw error;
      setManualEvents(prev => prev.filter(x => x.event.id !== o.event.id));
    } catch (e) { alert('Could not link: ' + (e.message || e)); }
    setAdoptBusy(null);
  }

  // Pile 3 — calendar events Overwatch never created. Hits Google, so it runs
  // on demand rather than blocking the page load.
  async function scanManual() {
    if (!accessToken) { alert('Not signed in to Google — cannot scan the calendars.'); return; }
    setScanning(true);
    try {
      const res = await scanForOrphans(accessToken);
      setManualEvents(res.orphans || []);
      if ((res.orphans || []).length) setManualOpen(true);
    } catch (e) {
      alert('Scan failed: ' + (e.message || e));
    }
    setScanning(false);
  }

  // Archive — the class matters (see config/archiveReasons.js). A test entry and
  // a warranty callback both leave this queue, but one never happened and the
  // other is real cost DRH absorbed with no revenue. Never collapse them.
  const [completingId, setCompletingId] = useState(null);

  // Mark complete, no customer required. Explicitly NOT the same button as
  // the billing-side Archive above: that one classifies a real visit as
  // not_real/absorbed for the profitability numbers. This one says "this row
  // was never a customer job at all" — moves its calendar event (if any) to
  // Completed WITHOUT deleting it, and archives the job so both the job query
  // and the calendar scan stop surfacing it, permanently.
  async function markOrphanComplete(job) {
    setCompletingId(job.id);
    try {
      if (job.calendar_event_id && job.calendar_id) {
        await archiveEvent(accessToken, job.calendar_id, job.calendar_event_id);
      }
      const { error } = await supabase.from('jobs').update({
        status: 'archived',
        updated_by: userEmail || null,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      setOrphanJobs(prev => prev.filter(j => j.id !== job.id));
    } catch (e) {
      alert('Could not mark complete: ' + (e.message || e));
    }
    setCompletingId(null);
  }

  async function doArchive(reason) {
    const entryId = archiveTarget?.id;
    if (!entryId) return;
    try {
      const { error } = await supabase.from('time_entries').update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: userEmail || null,
        archive_reason: reason,
      }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.filter(e => e.id !== entryId));
      setArchiveTarget(null);
    } catch (e) {
      alert('Could not archive: ' + (e.message || e) + '\n\nIf this says the column does not exist, run migration 023 first.');
      setArchiveTarget(null);
    }
  }

  async function changeDispo(entryId, dispo) {
    setDispoBusyId(entryId);
    try {
      const { error } = await supabase.from('time_entries').update({ disposition: dispo }).eq('id', entryId);
      if (error) throw error;
      setEvents(prev => prev.map(e => e.id === entryId ? { ...e, disposition: dispo } : e));
    } catch (e) { alert('Could not change disposition: ' + (e.message || e)); }
    setDispoBusyId(null);
  }

  // Create or update a board ticket — ONLY called after explicit confirm.
  async function pushToBoard(ev) {
    const target = DISPO_STATUS[ev.disposition] || JOB_STATUS.SCHEDULED;
    const existing = ev.calendar_event_id ? jobByEvent[ev.calendar_event_id] : null;
    setTicketBusyId(ev.id); setConfirmTicketId(null);
    try {
      if (existing) {
        await jobsApi.changeStatus(existing.id, target, userEmail, `Set to ${statusLabel(target)} from Audit`);
        setJobByEvent(m => ({ ...m, [ev.calendar_event_id]: { ...existing, status: target } }));
      } else {
        const job = {
          customer_name: byId[ev.customer_id]?.name || ev.customer_name_raw || ev.event_title || 'Customer',
          customer_id: ev.customer_id || undefined,
          status: target,
          issue: ev.notes || ev.event_title || '',
          scheduled_date: ev.event_start ? new Date(ev.event_start).toISOString() : undefined,
          calendar_event_id: ev.calendar_event_id || undefined,
        };
        const created = await jobsApi.create(job, userEmail);
        if (ev.calendar_event_id && created?.id) setJobByEvent(m => ({ ...m, [ev.calendar_event_id]: { id: created.id, status: target } }));
      }

      // v9.3.6 fix: when the disposition is Bill It (work is DONE), move the
      // source calendar event to the Completed calendar — same pattern as
      // BoardView/Billing. Event Audit was the one screen that never got this
      // wiring, leaving done events stranded on tech calendars.
      // Calendar is derived from the assigned tech's techs.calendar_id
      // (the 9.3.4 pattern). Best-effort, never blocks the status change.
      if (target === JOB_STATUS.TO_BILL && ev.calendar_event_id && accessToken) {
        try {
          const techs = await techsApi.getAll();
          const tech = (techs || []).find(t =>
            t.calendar_id && ev.tech_name &&
            (t.name || '').toLowerCase() === ev.tech_name.toLowerCase());
          if (tech) {
            await archiveEvent(accessToken, tech.calendar_id, ev.calendar_event_id);
          } else {
            console.warn('Event Audit: no tech calendar match for', ev.tech_name, '— event not moved');
          }
        } catch (e) { console.warn('Event Audit calendar move failed (non-fatal):', e.message); }
      }
    } catch (e) { alert('Could not push to board: ' + (e.message || e)); }
    setTicketBusyId(null);
  }

  async function toggleHistory(ev) {
    if (openHistoryId === ev.id) { setOpenHistoryId(null); return; }
    setOpenHistoryId(ev.id);
    if (historyById[ev.id]) return; // cached
    const job = ev.calendar_event_id ? jobByEvent[ev.calendar_event_id] : null;
    if (!job) { setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: [], hasJob: false } })); return; }
    setHistoryById(h => ({ ...h, [ev.id]: { loading: true, rows: [], hasJob: true } }));
    try {
      const rows = await notesApi.getAllForJob(job.id);
      setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: rows || [], hasJob: true } }));
    } catch {
      setHistoryById(h => ({ ...h, [ev.id]: { loading: false, rows: [], hasJob: true } }));
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return events.filter(e => {
      if (unassignedOnly && e.customer_id) return false;
      if (hideDone) {
        const j = e.calendar_event_id ? jobByEvent[e.calendar_event_id] : null;
        if (j && DONE_STATUSES.includes(j.status)) return false;
      }
      if (!s) return true;
      const cust = byId[e.customer_id];
      return (e.event_title || '').toLowerCase().includes(s) || (e.customer_name_raw || '').toLowerCase().includes(s) ||
        (e.notes || '').toLowerCase().includes(s) || (e.materials || '').toLowerCase().includes(s) ||
        (e.tech_name || '').toLowerCase().includes(s) || (cust?.name || '').toLowerCase().includes(s) ||
        (cust?.short_code || '').toLowerCase().includes(s);
    });
  }, [events, search, unassignedOnly, hideDone, jobByEvent, byId]);

  const assignedCount = events.filter(e => e.customer_id).length;
  const unassignedEntries = events.filter(e => !e.customer_id).length;
  const total = events.length;

  const btn = (active, color) => ({
    border: `1px solid ${active ? color : '#334155'}`, background: active ? `${color}25` : 'transparent',
    color: active ? color : '#64748b', borderRadius: 7, padding: '5px 9px', fontSize: 11, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 16, cursor: 'pointer', padding: '4px 0' }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🔎 Event Audit</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#cbd5e1' }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>{assignedCount}</span> / {total} assigned
          </div>
        </div>
        <div style={{ height: 4, background: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: total ? `${(assignedCount / total) * 100}%` : '0%', background: '#22c55e' }} />
        </div>

        {archiveTarget && (
          <ArchiveModal
            count={1}
            hours={archiveTarget.total_minutes ? `${(archiveTarget.total_minutes / 60).toFixed(1)}h` : ''}
            onCancel={() => setArchiveTarget(null)}
            onConfirm={doArchive}
          />
        )}

        {/* DATA PROBLEMS — loud, top of the audit. This is the orphan queue. */}
        {(unassignedEntries > 0 || orphanJobs.length > 0 || manualEvents.length > 0) && (
          <div style={{ background: '#78350f33', border: '2px solid #f59e0b', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 6 }}>
              ⚠️ Bad data — {unassignedEntries + orphanJobs.length + manualEvents.length} items need a client
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#fcd34d' }}>
              <span><b style={{ color: '#fbbf24' }}>{unassignedEntries}</b> time entries with no client</span>
              <span><b style={{ color: '#fbbf24' }}>{orphanJobs.length}</b> jobs with no client</span>
              <span>
                <b style={{ color: '#fbbf24' }}>{manualEvents.length}</b> hand-made calendar events
                {!scanned && (
                  <button onClick={() => { setScanned(true); scanManual(); }} disabled={scanning}
                    style={{ marginLeft: 6, background: 'none', border: '1px solid #f59e0b', borderRadius: 6, color: '#fbbf24', fontSize: 12, fontWeight: 700, padding: '2px 8px', cursor: 'pointer' }}>
                    {scanning ? 'scanning…' : 'scan'}
                  </button>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Jobs with no client — not calendar-backed, so they never showed here before.
            Two of these are meta calendar noise ("Austin Off", "Meeting with Sara & JR")
            that never should have become jobs, and a real duplicate ("Holding Shelton -"
            matching an existing job) that "open on board" made you go fix somewhere else.
            Both actions live right here now: merge into whatever this really is, or mark
            it complete with no customer if it was never real work at all. */}
        {orphanJobs.length > 0 && (
          <details open style={{ marginBottom: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#fbbf24', fontWeight: 700, padding: '4px 0' }}>
              {orphanJobs.length} jobs with no client →
            </summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {orphanJobs.map(j => (
                <div key={j.id} style={{ background: '#1e293b', border: '1px solid #f59e0b55', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{j.customer_name || 'Unnamed'}</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>{j.issue || 'no issue noted'}</div>
                  <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 2 }}>{missingLabel(j)}</div>
                  <a href={boardJobLink(j.id)} style={{ fontSize: 12, color: '#00c8e8', textDecoration: 'none' }}>open on board →</a>

                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Merge — this IS an existing customer/job under a different
                        name. Same tool the board and every ticket use; here it
                        loads its own candidates since orphanJobs is a filtered
                        subset, not the full board. */}
                    <MergeTool job={j} accessToken={accessToken} userEmail={userEmail}
                      onMerge={() => setOrphanJobs(prev => prev.filter(x => x.id !== j.id))} />

                    {/* Mark complete, no customer. For meta noise like "Austin Off"
                        or "Meeting with Sara & JR" — never real customer work, so
                        forcing a client link onto it is wrong. Moves the underlying
                        calendar event to the Completed calendar (not deleted — same
                        archiveEvent() the tech-side archive uses) and archives the
                        job. 'completed' is a skipped calendar type in the scan, and
                        'archived' is excluded from this exact query, so it stops
                        being flagged permanently — ignored to infinity, nothing lost. */}
                    <button onClick={() => markOrphanComplete(j)} disabled={completingId === j.id}
                      style={{ background: 'none', border: '1px solid #475569', color: '#94a3b8',
                               borderRadius: 8, fontSize: 11, fontWeight: 700, padding: '6px 10px',
                               cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {completingId === j.id ? 'Marking…' : '✓ Mark complete — no customer'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Calendar events Overwatch never created — no "Managed by JUC-E" marker */}
        {manualEvents.length > 0 && (
          // CONTROLLED, not `<details open>`. `open` as a bare attribute only
          // sets the INITIAL state, so a section that renders after an async
          // scan lands collapsed no matter what. Arriving from the home banner
          // has to land on the open list — the whole point of the banner is
          // that this work is invisible, and making someone hit Scan and then
          // click a 13px summary to reveal it keeps it invisible.
          <details open={manualOpen} style={{ marginBottom: 10 }}>
            <summary
              onClick={(e) => { e.preventDefault(); setManualOpen(o => !o); }}
              style={{ cursor: 'pointer', fontSize: 16, color: '#fbbf24', fontWeight: 800,
                       padding: '8px 0', listStyle: 'none' }}>
              {manualOpen ? '▾' : '▸'} {manualEvents.length} calendar events made by hand — will not bill
            </summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {manualEvents.map(o => (
                <div key={o.event.id} style={{ background: '#1e293b', border: `1px solid ${o.possibleDuplicate ? '#f97316' : '#f59e0b55'}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{o.event.summary || '(no title)'}</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                    {o.calendar?.name} · {o.event.start?.dateTime ? new Date(o.event.start.dateTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 2 }}>never entered Overwatch — will not bill</div>
                  {o.possibleDuplicate && (
                    <div style={{ fontSize: 12, color: '#fdba74', fontWeight: 700, marginTop: 4, background: '#7c2d1230', borderRadius: 6, padding: '4px 8px' }}>
                      ⚠️ Possible duplicate — already open: {o.possibleDuplicate.customer_name} ({o.possibleDuplicate.status})
                    </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {o.possibleDuplicate ? (
                      // A match was found — link is the PRIMARY action. Create
                      // job stays available underneath for when the match is
                      // wrong, but it's no longer the only button.
                      <>
                        <button onClick={() => linkToExisting(o)} disabled={adoptBusy === o.event.id}
                          style={{ background: '#22c55e', border: 'none', color: '#0f172a', borderRadius: 8,
                                   padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {adoptBusy === o.event.id ? 'Linking…' : `Link to ${o.possibleDuplicate.customer_name} →`}
                        </button>
                        <button onClick={() => adoptEvent(o)} disabled={adoptBusy === o.event.id}
                          style={{ background: 'none', border: '1px solid #475569', color: '#94a3b8', borderRadius: 8,
                                   padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Not a match — create new
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <CustomerPicker compact
                            value={adoptCustomer[o.event.id] || null}
                            onChange={(id) => setAdoptCustomer(m => ({ ...m, [o.event.id]: id }))}
                            placeholder="Link a client (optional)" />
                        </div>
                        <button onClick={() => adoptEvent(o)} disabled={adoptBusy === o.event.id}
                          style={{ background: '#22c55e', border: 'none', color: '#0f172a', borderRadius: 8,
                                   padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {adoptBusy === o.event.id ? 'Creating…' : 'Create job & link →'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by title, note, tech, customer…"
            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '9px 12px', outline: 'none', fontFamily: 'inherit' }} />
          <button onClick={() => setUnassignedOnly(v => !v)} style={{
            background: unassignedOnly ? '#00c8e820' : '#1e293b', border: `1px solid ${unassignedOnly ? '#00c8e8' : '#334155'}`,
            color: unassignedOnly ? '#00c8e8' : '#64748b', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {unassignedOnly ? 'Unassigned only' : 'All events'}
          </button>
          <button onClick={() => setHideDone(v => !v)} style={{
            background: hideDone ? '#22c55e20' : '#1e293b', border: `1px solid ${hideDone ? '#22c55e' : '#334155'}`,
            color: hideDone ? '#22c55e' : '#94a3b8', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {hideDone ? 'Done hidden' : 'Done shown'}
          </button>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>Events since Jan 1, 2026</div>
      </div>

      <div style={{ padding: 14 }}>
        {loading && <div style={{ textAlign: 'center', color: '#cbd5e1', padding: 60, fontSize: 14 }}>Loading events…</div>}
        {err && <div style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#fca5a5', borderRadius: 10, padding: 14, fontSize: 13 }}>{err}</div>}
        {!loading && !err && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 60, fontSize: 14 }}>
            {unassignedOnly ? 'Nothing left to assign 🎉' : 'No events match.'}
          </div>
        )}

        {!loading && !err && filtered.map(e => {
          const d = dispo(e.disposition);
          const cust = byId[e.customer_id];
          const job = e.calendar_event_id ? jobByEvent[e.calendar_event_id] : null;
          const target = DISPO_STATUS[e.disposition] || JOB_STATUS.SCHEDULED;
          const onBoardSynced = job && job.status === target;
          // "Done" = the job reached a terminal state. Billed, complete, archived,
          // dead, lost, won. Anything else is still live work.
          const isDone = job && DONE_STATUSES.includes(job.status);
          const si = job ? STATUS_INFO[job.status] : null;
          const hist = historyById[e.id];
          return (
            <div key={e.id} style={{ background: '#1a1a2e', border: `1px solid ${isDone ? '#22c55e40' : '#1e293b'}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12, opacity: isDone ? 0.7 : 1 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, opacity: isDone ? 0.65 : 1 }}>{e.event_title || e.customer_name_raw || '(untitled event)'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* CURRENT STATE first — this is what actually moves */}
                {si
                  ? <Chip color={isDone ? '#22c55e' : si.color}>{isDone ? '✓ Done' : `${si.icon} ${si.label}`}</Chip>
                  : <Chip color="#94a3b8">not on the board</Chip>}
                {/* The disposition is history — what the tech said that day. Demoted. */}
                <span style={{ color: '#94a3b8', fontSize: 11 }}>tech said: {d.label}</span>
                <button onClick={(ev2) => { ev2.stopPropagation(); setArchiveTarget(e); }}
                  title="Test data / junk. Leaves the audit WITHOUT being marked billed."
                  style={{ marginLeft: 'auto', background: 'none', border: '1px solid #475569', color: '#94a3b8', borderRadius: 6, fontSize: 11, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  🗑️ Archive
                </button>
                {e.tech_name && <span style={{ color: '#cbd5e1', fontSize: 11 }}>👷 {e.tech_name}</span>}
                <span style={{ color: '#cbd5e1', fontSize: 11 }}>📅 {fmtDate(e.event_start || e.created_at)}</span>
                {hrs(e.total_minutes) && <span style={{ color: '#00c8e8', fontSize: 11 }}>⏱ {hrs(e.total_minutes)}</span>}
              </div>

              {e.materials && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>🔧 {e.materials}</div>}
              {e.notes && <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.notes}</div>}

              {/* Disposition changer */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Disposition {dispoBusyId === e.id && <span style={{ color: '#cbd5e1' }}>· saving…</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DISPO_KEYS.map(k => (
                    <button key={k} onClick={() => e.disposition !== k && changeDispo(e.id, k)} style={btn(e.disposition === k, dispo(k).color)}>
                      {dispo(k).label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer assignment */}
              <div style={{ marginTop: 10 }}>
                {cust ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 700, marginRight: 6 }}>✓ {cust.short_code}</span>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{cust.name}</span>
                    </div>
                    <button onClick={() => setOpenPickerId(openPickerId === e.id ? null : e.id)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', padding: '5px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Change</button>
                  </div>
                ) : (
                  <button onClick={() => setOpenPickerId(openPickerId === e.id ? null : e.id)} disabled={savingId === e.id}
                    style={{ width: '100%', background: '#00c8e820', border: '1px solid #00c8e8', borderRadius: 8, color: '#00c8e8', padding: '9px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {savingId === e.id ? 'Saving…' : '+ Assign customer'}
                  </button>
                )}
                {openPickerId === e.id && <RegistryPicker registry={registry} onPick={c => assign(e.id, c.id)} onClose={() => setOpenPickerId(null)} />}
              </div>

              {/* Board ticket + History */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {onBoardSynced ? (
                  <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>✓ On board · {statusLabel(job.status)}</span>
                ) : confirmTicketId === e.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#cbd5e1', fontSize: 12 }}>
                      {job ? 'Update board ticket →' : 'Create board ticket →'} <b style={{ color: '#e2e8f0' }}>{statusLabel(target)}</b>
                    </span>
                    <button onClick={() => pushToBoard(e)} style={{ background: '#22c55e25', border: '1px solid #22c55e', color: '#22c55e', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes</button>
                    <button onClick={() => setConfirmTicketId(null)} style={{ background: 'none', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 7, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmTicketId(e.id)} disabled={ticketBusyId === e.id}
                    style={{ background: 'none', border: '1px solid #8b5cf6', color: '#a78bfa', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {ticketBusyId === e.id ? 'Working…' : job ? `Update ticket → ${statusLabel(target)}` : `Create ticket → ${statusLabel(target)}`}
                  </button>
                )}

                <button onClick={() => toggleHistory(e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#cbd5e1', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  {openHistoryId === e.id ? 'Hide history' : 'View history'}
                </button>
              </div>

              {openHistoryId === e.id && (
                <div style={{ marginTop: 10, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 10 }}>
                  {hist?.loading && <div style={{ color: '#cbd5e1', fontSize: 12 }}>Loading…</div>}
                  {hist && !hist.loading && !hist.hasJob && (
                    <div style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>No board ticket yet — only the field note above. Create a ticket to start a history thread.</div>
                  )}
                  {hist && !hist.loading && hist.hasJob && hist.rows.length === 0 && (
                    <div style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>Ticket exists but has no notes yet.</div>
                  )}
                  {hist && !hist.loading && hist.rows.map(r => (
                    <div key={r.id} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ color: '#00c8e8', fontSize: 11, fontWeight: 700 }}>{author(r.created_by)}</span>
                        {r.from_status && r.to_status && <span style={{ color: '#94a3b8', fontSize: 10 }}>{r.from_status} → {r.to_status}</span>}
                        <span style={{ color: '#94a3b8', fontSize: 10, marginLeft: 'auto' }}>{fmtDateTime(r.created_at)}</span>
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{r.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
