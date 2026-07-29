// ============================================
// Overwatch — Client Cockpit
// ============================================
// Source of truth = customers (master accounts).
// Search a client -> see their history AND act on them:
//   + Note      -> logs a note, stamped with the client's id
//   + Task      -> action item, assign to a user (lands in their queue)
//   + New job   -> full intake/schedule flow (NewJobModal), stamped on save
// Everything created here gets customer_id = client's real UUID, so it can't
// fragment by name and always shows back in this client's history.

import { dispo } from '../utils/billing.js';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, jobsApi, assignmentsApi, techsApi, JOB_STATUS } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';

// ── helpers ──────────────────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  if (!isFinite(h)) return null;
  return `${h.toFixed(1)}h`;
}

// Open-work status chip colors (jobs.status)
function jobChip(status) {
  const map = {
    new:            { label: 'New',           color: '#cbd5e1' },
    needs_details:  { label: 'Needs details', color: '#cbd5e1' },
    needs_parts:    { label: 'Needs parts',   color: '#eab308' },
    pending_materials: { label: 'Pending materials', color: '#eab308' },
    ready_to_schedule: { label: 'Ready',      color: '#3b82f6' },
    scheduled:      { label: 'Scheduled',     color: '#3b82f6' },
    return_pending: { label: 'Return',        color: '#f97316' },
    needs_estimate: { label: 'Needs estimate', color: '#eab308' },
    estimate_sent:  { label: 'Estimate sent', color: '#06b6d4' },
    won:            { label: 'Won',           color: '#22c55e' },
    to_bill:        { label: 'To bill',       color: '#22c55e' },
    complete:       { label: 'Complete',      color: '#22c55e' },
  };
  return map[status] || { label: (status || '—').replace(/_/g, ' '), color: '#cbd5e1' };
}
function typeBadge(job) {
  if (job.job_type === 'note') return { label: 'Note', color: '#5dcaa5' };
  if (job.job_type === 'task') return { label: 'Task', color: '#7f77dd' };
  return { label: 'Job', color: '#97c459' };
}

const TERMINAL = [JOB_STATUS.BILLED, JOB_STATUS.LOST, JOB_STATUS.DEAD, JOB_STATUS.ARCHIVED].filter(Boolean);

// Distinctive name tokens, for finding un-tagged look-alikes.
const STOP = new Set([
  'construction', 'security', 'residence', 'services', 'service', 'company',
  'llc', 'inc', 'the', 'and', 'drh', 'group', 'systems', 'install', 'call',
]);
function nameTokens(name) {
  return Array.from(new Set(
    (name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !STOP.has(w))
  ));
}

const TIME_FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, customer_id';

const editLabel = { display: 'flex', flexDirection: 'column', gap: 3, color: '#cbd5e1', fontSize: 11 };
const editInput = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '7px 9px', outline: 'none', fontFamily: 'inherit' };

// ── component ────────────────────────────────────────────────
export default function CustomerHistory({ onBack, userEmail, accessToken, initialCustomerId }) {
  const location = useLocation();
  const me = userEmail || (typeof localStorage !== 'undefined' && localStorage.getItem('juce_v4_email')) || '';

  const [registry, setRegistry]   = useState([]);
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState(null);
  const [tagged, setTagged]       = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [openWork, setOpenWork]   = useState([]);
  const [showDone, setShowDone]   = useState(true);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState('');

  // techs (for task assignee)
  const [techs, setTechs] = useState([]);

  // create flow
  const [createMode, setCreateMode] = useState(null); // 'note' | 'task' | null
  const [noteText, setNoteText]     = useState('');
  const [taskTitle, setTaskTitle]   = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingDetails, setSavingDetails] = useState(false);
  const [showJobModal, setShowJobModal] = useState(false);
  const [saving, setSaving]         = useState(false);

  // load the master account list once
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, short_code, cs_number, cms_account_id, address, phone, system_type, monitoring_tier, service_tier, package, gate_code, key_location, alula_username, has_cms_monitoring, qbo_customer_id, qbo_customer_name')
        .is('merged_into', null)
        .order('name');
      if (error) setErr(error.message);
      else setRegistry(data || []);
    })();
  }, []);

  // load techs once (for task assignment)
  useEffect(() => {
    techsApi.getAll().then(setTechs).catch(() => {});
  }, []);

  // pre-fill the search box if arrived via ?name=
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('name');
    if (p && p.length >= 2) setQuery(p);
  }, [location.search]);

  // arrived with a SPECIFIC customer already chosen (e.g. from Triage Queue's
  // Customers tab) -- jump straight to their detail view, skip the search step
  useEffect(() => {
    if (!initialCustomerId) return;
    (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, short_code, cs_number, cms_account_id, address, phone, system_type, monitoring_tier, service_tier, package, gate_code, key_location, alula_username, has_cms_monitoring, qbo_customer_id, qbo_customer_name')
        .eq('id', initialCustomerId)
        .maybeSingle();
      if (!error && data) pick(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId]);

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return registry.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.short_code || '').toLowerCase().includes(s) ||
      (c.cs_number || '').toLowerCase().includes(s) ||
      (c.address || '').toLowerCase().includes(s)
    ).slice(0, 40);
  }, [query, registry]);

  const loadOpenWork = useCallback(async (customer) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, customer_name, job_type, status, issue, notes, created_at, customer_id')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false });
    if (!error) setOpenWork(data || []); // keep ALL (open + done); split in render
  }, []);

  const loadEvents = useCallback(async (customer) => {
    setLoading(true); setErr('');
    try {
      // 1) everything already tagged to this master account
      const tg = await supabase
        .from('time_entries')
        .select(TIME_FIELDS)
        .eq('customer_id', customer.id)
        .order('event_start', { ascending: false });
      if (tg.error) throw tg.error;

      // 2) un-tagged look-alikes that share the customer's name
      let sg = [];
      const tokens = nameTokens(customer.name);
      if (tokens.length) {
        const orStr = tokens.map(t => `customer_name_raw.ilike.%${t}%`).join(',');
        const r = await supabase
          .from('time_entries')
          .select(TIME_FIELDS)
          .is('customer_id', null)
          .or(orStr)
          .order('event_start', { ascending: false })
          .limit(100);
        if (!r.error) sg = r.data || [];
      }
      setTagged(tg.data || []);
      setSuggested(sg);
    } catch (e) {
      setErr(e.message || 'Failed to load events');
      setTagged([]); setSuggested([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const pick = (customer) => {
    setSelected(customer);
    setCreateMode(null);
    setEditingDetails(false);
    loadEvents(customer);
    loadOpenWork(customer);
  };

  const startEditDetails = () => {
    setEditForm({
      address: selected.address || '',
      phone: selected.phone || '',
      gate_code: selected.gate_code || '',
      key_location: selected.key_location || '',
      qbo_customer_id: selected.qbo_customer_id || '',
      qbo_customer_name: selected.qbo_customer_name || '',
    });
    setEditingDetails(true);
  };

  const saveDetails = async () => {
    if (!selected) return;
    setSavingDetails(true); setErr('');
    try {
      const { error } = await supabase.from('customers').update(editForm).eq('id', selected.id);
      if (error) throw error;
      const updated = { ...selected, ...editForm };
      setSelected(updated);
      setRegistry(prev => prev.map(c => c.id === selected.id ? updated : c));
      setEditingDetails(false);
    } catch (e) { setErr(e.message || 'Failed to save details'); }
    finally { setSavingDetails(false); }
  };

  const refreshWork = () => { if (selected) loadOpenWork(selected); };

  // ── create actions ──
  const saveNote = async () => {
    if (!noteText.trim() || !selected) return;
    setSaving(true); setErr('');
    try {
      await jobsApi.create({
        customer_name: selected.name, customer_address: selected.address || '',
        customer_id: selected.id, job_type: 'note', priority: 'normal',
        issue: noteText.trim(),
        notes: `[NOTE - ${new Date().toLocaleString()}]\n${noteText.trim()}`,
        status: JOB_STATUS.NEW,
      }, me);
      setNoteText(''); setCreateMode(null); refreshWork();
    } catch (e) { setErr(e.message || 'Failed to save note'); }
    finally { setSaving(false); }
  };

  const saveTask = async () => {
    if (!taskTitle.trim() || !selected) return;
    setSaving(true); setErr('');
    try {
      const job = await jobsApi.create({
        customer_name: selected.name, customer_address: selected.address || '',
        customer_id: selected.id, job_type: 'task', priority: 'normal',
        issue: taskTitle.trim(), status: JOB_STATUS.NEW,
      }, me);
      if (taskAssignee && job?.id) {
        await assignmentsApi.create({ job_id: job.id, tech_id: taskAssignee, scheduled_for: null }, me);
      }
      setTaskTitle(''); setTaskAssignee(''); setCreateMode(null); refreshWork();
    } catch (e) { setErr(e.message || 'Failed to create task'); }
    finally { setSaving(false); }
  };

  // mark a note/task done = archive it. Row stays, so the customer keeps the record.
  const markDone = async (id) => {
    try { await jobsApi.changeStatus(id, JOB_STATUS.ARCHIVED, me, 'Marked done from customer screen'); refreshWork(); }
    catch (e) { setErr(e.message || 'Failed to mark done'); }
  };
  // promote a note/task into a real job → enters the schedule→bill flow.
  const promoteToJob = async (id) => {
    try { await jobsApi.update(id, { job_type: 'service_res' }, me); refreshWork(); }
    catch (e) { setErr(e.message || 'Failed to make a job'); }
  };
  const reopen = async (id) => {
    try { await jobsApi.changeStatus(id, JOB_STATUS.NEW, me, 'Reopened from customer screen'); refreshWork(); }
    catch (e) { setErr(e.message || 'Failed to reopen'); }
  };

  const assign = async (entryId, customerId) => {
    const { error } = await supabase
      .from('time_entries').update({ customer_id: customerId }).eq('id', entryId);
    if (error) { setErr(error.message); return; }
    setSuggested(prev => {
      const hit = prev.find(e => e.id === entryId);
      if (hit) setTagged(t => [{ ...hit, customer_id: customerId }, ...t]);
      return prev.filter(e => e.id !== entryId);
    });
  };

  const goBack = () => {
    if (createMode) { setCreateMode(null); return; }
    if (selected) { setSelected(null); setTagged([]); setSuggested([]); setOpenWork([]); setErr(''); }
    else if (onBack) onBack();
  };

  // ── styles ──
  const page = { minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: 100 };
  const bar  = { position: 'sticky', top: 0, zIndex: 10, background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '12px 14px' };
  const back = { background: 'none', border: 'none', color: '#cbd5e1', fontSize: 16, cursor: 'pointer', padding: '4px 0' };
  const input = { width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0', padding: '12px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' };
  const card = { background: '#1a1a2e', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 12, color: '#e2e8f0', fontFamily: 'inherit' };
  const sectionLabel = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 10px', color: '#94a3b8' };

  const actBtn = (bg) => ({
    flex: 1, background: `${bg}1f`, border: `1px solid ${bg}`, color: bg,
    borderRadius: 10, padding: '11px 0', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  });

  const Chip = ({ d }) => {
    const { label, color } = dispo(d);
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${color}20`, color, border: `1px solid ${color}40` }}>{label}</span>;
  };
  const Badge = ({ color, children }) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${color}20`, color, border: `1px solid ${color}40` }}>{children}</span>
  );

  const EventCard = ({ e, showAssign }) => (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{e.event_title || e.customer_name_raw || 'Event'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
        <Chip d={e.disposition} />
        {e.tech_name && <span>👷 {e.tech_name}</span>}
        {e.event_start && <span>📅 {fmtDateTime(e.event_start)}</span>}
        {hoursFromMin(e.total_minutes) && <span>⏱ {hoursFromMin(e.total_minutes)}</span>}
      </div>
      {e.materials && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>🔧 {e.materials}</div>}
      {e.notes && <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{e.notes}</div>}
      {showAssign && (
        <button onClick={() => assign(e.id, selected.id)} style={{ marginTop: 10, width: '100%', background: '#00c8e820', border: '1px solid #00c8e8', borderRadius: 8, color: '#00c8e8', padding: '8px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Assign to {selected.name}
        </button>
      )}
    </div>
  );

  const WorkCard = ({ j, done }) => {
    const t = typeBadge(j);
    const s = jobChip(j.status);
    const actionable = j.job_type === 'note' || j.job_type === 'task';
    const miniBtn = (bg) => ({ flex: 1, background: `${bg}1f`, border: `1px solid ${bg}`, color: bg, borderRadius: 8, padding: '8px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' });
    return (
      <div style={{ ...card, opacity: done ? 0.6 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <Badge color={t.color}>{t.label}</Badge>
          {!done && <Badge color={s.color}>{s.label}</Badge>}
          {done && <Badge color="#64748b">{jobChip(j.status).label}</Badge>}
          {j.created_at && <span style={{ fontSize: 12, color: '#cbd5e1' }}>📅 {fmtDate(j.created_at)}</span>}
        </div>
        {j.issue && <div style={{ fontSize: 13.5, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.4, textDecoration: done ? 'line-through' : 'none' }}>{j.issue}</div>}
        {actionable && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {done ? (
              <button style={miniBtn('#64748b')} onClick={() => reopen(j.id)}>↩ Reopen</button>
            ) : (
              <>
                <button style={miniBtn('#22c55e')} onClick={() => markDone(j.id)}>✓ Done</button>
                <button style={miniBtn('#97c459')} onClick={() => promoteToJob(j.id)}>→ Make a job</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={page}>
      <div style={bar}>
        <button onClick={goBack} style={back}>←</button>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
          {selected ? selected.name : 'Customer Lookup'}
        </div>
        {selected && (
          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
            <span style={{ color: '#00c8e8', fontWeight: 700 }}>{selected.short_code}</span>
            {(selected.cs_number || selected.cms_account_id) && (
              <span> · CS# {selected.cs_number || selected.cms_account_id}</span>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div style={{ margin: '0 14px 14px', background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: editingDetails ? 4 : -4 }}>
            {!editingDetails ? (
              <button onClick={startEditDetails} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>✏️ Edit details</button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEditingDetails(false)} disabled={savingDetails} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveDetails} disabled={savingDetails} style={{ background: '#00c8e8', border: 'none', borderRadius: 8, color: '#0f1729', fontWeight: 700, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>{savingDetails ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </div>

          {editingDetails ? (
            <>
              <label style={editLabel}>Address<input style={editInput} value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></label>
              <label style={editLabel}>Phone<input style={editInput} value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></label>
              <label style={editLabel}>Gate code<input style={editInput} value={editForm.gate_code} onChange={e => setEditForm(f => ({ ...f, gate_code: e.target.value }))} /></label>
              <label style={editLabel}>Key location<input style={editInput} value={editForm.key_location} onChange={e => setEditForm(f => ({ ...f, key_location: e.target.value }))} /></label>
              <label style={editLabel}>QuickBooks customer ID<input style={editInput} placeholder="leave blank if not captured" value={editForm.qbo_customer_id} onChange={e => setEditForm(f => ({ ...f, qbo_customer_id: e.target.value }))} /></label>
              <label style={editLabel}>QuickBooks customer name<input style={editInput} placeholder="leave blank if not captured" value={editForm.qbo_customer_name} onChange={e => setEditForm(f => ({ ...f, qbo_customer_name: e.target.value }))} /></label>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>CS# and system/monitoring fields aren't editable here.</div>
            </>
          ) : (
            <>
              {selected.address && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>📍</span>
                  <span style={{ color: '#e2e8f0' }}>{selected.address}</span>
                </div>
              )}
              {selected.phone && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flexShrink: 0 }}>📞</span>
                  <a href={`tel:${selected.phone}`} style={{ color: '#00c8e8', textDecoration: 'none' }}>{selected.phone}</a>
                </div>
              )}
              {(selected.system_type || selected.monitoring_tier || selected.service_tier || selected.package) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>🛡️</span>
                  <span style={{ color: '#e2e8f0', background: '#1e293b', padding: '2px 8px', borderRadius: 6, display: 'inline-block' }}>
                    {[selected.system_type, selected.monitoring_tier, selected.service_tier, selected.package].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              {selected.alula_username && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flexShrink: 0 }}>👤</span>
                  <span style={{ color: '#94a3b8' }}>Alula: {selected.alula_username}</span>
                </div>
              )}
              {(selected.gate_code || selected.key_location) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>🔑</span>
                  <span style={{ color: '#94a3b8' }}>
                    {selected.gate_code && <>Gate: {selected.gate_code}</>}
                    {selected.gate_code && selected.key_location && ' · '}
                    {selected.key_location && <>Key: {selected.key_location}</>}
                  </span>
                </div>
              )}
              {selected.qbo_customer_id && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flexShrink: 0 }}>📗</span>
                  <span style={{ color: '#94a3b8' }}>QBO: {selected.qbo_customer_name || selected.qbo_customer_id}</span>
                </div>
              )}
              {!selected.address && !selected.phone && !selected.system_type && !selected.monitoring_tier &&
                !selected.service_tier && !selected.package && !selected.alula_username &&
                !selected.gate_code && !selected.key_location && !selected.qbo_customer_id && (
                <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No stored details on file for this customer.</div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ padding: 14 }}>
        {err && <div style={{ background: '#ef444420', border: '1px solid #ef444440', color: '#fca5a5', borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {/* search mode */}
        {!selected && (
          <>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search a customer — name, code, CS#, address…"
              style={input}
            />
            {query.trim() && matches.length === 0 && (
              <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 14 }}>
                No customer matches “{query.trim()}”. (Customer lookup searches all customers.)
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              {matches.map(c => (
                <button key={c.id} onClick={() => pick(c)} style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>{c.name}</span>
                    <span style={{ color: '#00c8e8', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.short_code}</span>
                  </div>
                  {c.address && <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>📍 {c.address}</div>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* customer detail mode */}
        {selected && (
          <>
            {/* action bar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button style={actBtn('#5dcaa5')} onClick={() => setCreateMode(createMode === 'note' ? null : 'note')}>+ Note</button>
              <button style={actBtn('#7f77dd')} onClick={() => setCreateMode(createMode === 'task' ? null : 'task')}>+ Task</button>
              <button style={actBtn('#97c459')} onClick={() => setShowJobModal(true)}>+ New job</button>
            </div>

            {/* create: note */}
            {createMode === 'note' && (
              <div style={{ ...card, borderColor: '#5dcaa580' }}>
                <textarea
                  autoFocus value={noteText} onChange={e => setNoteText(e.target.value)} rows={3}
                  placeholder={`Note for ${selected.name}…`}
                  style={{ ...input, resize: 'vertical', fontFamily: 'inherit', marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setCreateMode(null); setNoteText(''); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveNote} disabled={saving || !noteText.trim()} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: noteText.trim() ? '#5dcaa5' : '#334155', color: '#0f1729', fontWeight: 700, cursor: noteText.trim() ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : 'Save note'}</button>
                </div>
              </div>
            )}

            {/* create: task */}
            {createMode === 'task' && (
              <div style={{ ...card, borderColor: '#7f77dd80' }}>
                <input
                  autoFocus value={taskTitle} onChange={e => setTaskTitle(e.target.value)}
                  placeholder="What needs to happen?"
                  style={{ ...input, marginBottom: 10 }}
                />
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Assign to</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {techs.map(t => {
                    const on = taskAssignee === t.id;
                    const c = t.color || '#7f77dd';
                    return (
                      <button key={t.id} onClick={() => setTaskAssignee(on ? '' : t.id)}
                        style={{ padding: '7px 13px', borderRadius: 8, border: `2px solid ${on ? c : '#334155'}`, background: on ? `${c}22` : '#0f172a', color: on ? c : '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setCreateMode(null); setTaskTitle(''); setTaskAssignee(''); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveTask} disabled={saving || !taskTitle.trim()} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: taskTitle.trim() ? '#7f77dd' : '#334155', color: '#fff', fontWeight: 700, cursor: taskTitle.trim() ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : (taskAssignee ? 'Create + assign' : 'Create task')}</button>
                </div>
              </div>
            )}

            {loading && <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6 }}>Loading…</div>}

            {!loading && (
              <>
                {/* open work + collapsed done */}
                {(() => {
                  const openItems = openWork.filter(j => !TERMINAL.includes(j.status));
                  const doneItems = openWork.filter(j => TERMINAL.includes(j.status));
                  return (
                    <>
                      {openItems.length > 0 && (
                        <>
                          <div style={{ ...sectionLabel, color: '#a78bfa' }}>Open work ({openItems.length})</div>
                          {openItems.map(j => <WorkCard key={j.id} j={j} />)}
                        </>
                      )}
                      {doneItems.length > 0 && (
                        <>
                          <button onClick={() => setShowDone(v => !v)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: '6px 0', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {showDone ? '▾ Hide done' : `▸ Done (${doneItems.length})`}
                          </button>
                          {showDone && doneItems.map(j => <WorkCard key={j.id} j={j} done />)}
                        </>
                      )}
                    </>
                  );
                })()}

                {/* finished visits */}
                <div style={{ ...sectionLabel, color: '#cbd5e1', marginTop: openWork.length ? 18 : 4 }}>
                  Calendar events ({tagged.length})
                </div>
                {tagged.length === 0 && (
                  <div style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 16 }}>
                    Nothing tagged to this account yet. Any look-alikes below can be assigned with one tap.
                  </div>
                )}
                {tagged.map(e => <EventCard key={e.id} e={e} />)}

                {suggested.length > 0 && (
                  <>
                    <div style={{ ...sectionLabel, color: '#f59e0b', marginTop: 18 }}>
                      Possible matches — not yet assigned ({suggested.length})
                    </div>
                    {suggested.map(e => <EventCard key={e.id} e={e} showAssign />)}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {showJobModal && selected && (
        <NewJobModal
          accessToken={accessToken}
          userEmail={me}
          prefill={{ customerName: selected.name, address: selected.address || '' }}
          onClose={() => setShowJobModal(false)}
          onCreated={async (job) => {
            setShowJobModal(false);
            if (job?.id) { try { await jobsApi.update(job.id, { customer_id: selected.id }, me); } catch (_) {} }
            refreshWork();
          }}
        />
      )}
    </div>
  );
}
