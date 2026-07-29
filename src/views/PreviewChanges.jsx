// ============================================
// Overwatch — Preview Changes (audit + revert)
// ============================================
// Shows everything the PREVIEW build touched:
//   • Calendar events stamped with extendedProperties.private.ow_preview = 'true'
//   • Job rows whose created_by carries the PREVIEW marker
// Each can be reverted in one tap. Revert strips the OW-PREVIEW note + machine tag,
// moves a moved-to-Completed event back to its origin calendar, and deletes the
// linked preview job. Nothing here runs in production unless this branch is merged.

import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';
const JUN_FROM = '2026-06-01T00:00:00Z';
const JUN_TO   = '2026-07-01T00:00:00Z';

const SCAN_CALS = [
  { id: CALENDARS.AUSTIN,                name: 'Austin' },
  { id: CALENDARS.JR,                    name: 'JR' },
  { id: CALENDARS.TECH3,                 name: 'Brian' },
  { id: CALENDARS.SUBS,                  name: 'Subs' },
  { id: CALENDARS.INSTALLATIONS,         name: 'Installations' },
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Tent / Queue' },
  { id: CALENDARS.SALES_ACCOUNTING,      name: 'Sales & Accounting' },
  { id: CALENDARS.RETURN_VISITS,         name: 'Return Visits' },
  { id: CALENDARS.SHANA,                 name: 'Shana' },
  { id: CALENDARS.ADMIN_NOTES,           name: 'Admin Notes' },
  { id: CALENDARS.COMPLETED,             name: 'Completed' },
].filter(c => c.id);

const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
const cleanTitle = (t) => (t || '(no title)').replace(/\s*\[.*?\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchStamped(accessToken, cal) {
  const params = new URLSearchParams({
    privateExtendedProperty: 'ow_preview=true',
    timeMin: JUN_FROM, timeMax: JUN_TO,
    singleEvents: 'true', maxResults: '250',
  });
  try {
    const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(ev => ({ ev, calId: cal.id, calName: cal.name }));
  } catch { return []; }
}

export default function PreviewChanges({ accessToken, userEmail, onBack }) {
  const [events, setEvents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const evLists = await Promise.all(SCAN_CALS.map(c => fetchStamped(accessToken, c)));
      const evs = evLists.flat().sort((a, b) =>
        (b.ev.extendedProperties?.private?.ow_preview_ts || '').localeCompare(a.ev.extendedProperties?.private?.ow_preview_ts || ''));
      setEvents(evs);
      try {
        const { data } = await supabase.from('jobs').select('*').ilike('created_by', '%PREVIEW%').order('created_at', { ascending: false });
        setJobs(data || []);
      } catch (e) { console.warn('jobs query failed', e); setJobs([]); }
    } catch (e) { setError(e.message || 'Load failed'); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { if (accessToken) load(); }, [accessToken, load]);

  const revertEvent = async (item) => {
    setBusy(item.ev.id);
    try {
      const priv = item.ev.extendedProperties?.private || {};
      const desc = (item.ev.description || '').split('\n').filter(l => !l.includes('OW-PREVIEW')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calId)}/events/${encodeURIComponent(item.ev.id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, extendedProperties: { private: { ow_preview: null, ow_preview_action: null, ow_preview_ts: null, ow_preview_origin: null } } }),
      });
      if ((priv.ow_preview_action || '').startsWith('moved') && priv.ow_preview_origin && item.calId === CALENDARS.COMPLETED) {
        await fetch(`${GCAL}/calendars/${encodeURIComponent(item.calId)}/events/${encodeURIComponent(item.ev.id)}/move?destination=${encodeURIComponent(priv.ow_preview_origin)}`,
          { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      }
      try { await supabase.from('jobs').delete().ilike('created_by', '%PREVIEW%').eq('calendar_event_id', item.ev.id); } catch {}
      setEvents(prev => prev.filter(e => e.ev.id !== item.ev.id));
      setJobs(prev => prev.filter(j => j.calendar_event_id !== item.ev.id));
    } catch (e) { setError(e.message || 'Revert failed'); }
    finally { setBusy(null); }
  };

  const revertJob = async (job) => {
    setBusy(job.id);
    try {
      await supabase.from('jobs').delete().eq('id', job.id);
      setJobs(prev => prev.filter(j => j.id !== job.id));
    } catch (e) { setError(e.message || 'Delete failed'); }
    finally { setBusy(null); }
  };

  const revertAll = async () => {
    if (!confirm(`Revert ALL preview changes? ${events.length} event(s) un-stamped/moved back, ${jobs.length} job(s) deleted.`)) return;
    setBusy('all');
    for (const item of [...events]) { await revertEvent(item); }
    for (const job of jobs.filter(j => !events.some(e => e.ev.id === j.calendar_event_id))) { await revertJob(job); }
    setBusy(null);
    load();
  };

  const total = events.length + jobs.length;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 14px 80px', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button onClick={onBack} style={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Back</button>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🔬 Preview changes</div>
        <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>↻ Rescan</button>
      </div>
      <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
        Everything the preview build touched in June. <b>Revert</b> un-stamps the event, moves anything that went to Completed back where it came from, and deletes the matching preview job. Nothing is lost.
      </div>

      {error && <div style={{ background: '#3a1212', border: '1px solid #7f1d1d', borderRadius: 8, padding: 10, color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {!loading && total > 0 && (
        <button onClick={revertAll} disabled={busy === 'all'} style={{ width: '100%', background: '#3a1212', border: '1px solid #7f1d1d', borderRadius: 10, color: '#fca5a5', padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 16, opacity: busy === 'all' ? 0.5 : 1 }}>
          {busy === 'all' ? 'Reverting…' : `Revert ALL (${total})`}
        </button>
      )}

      {loading && <div style={{ color: '#cbd5e1', fontSize: 14, padding: 20, textAlign: 'center' }}>Scanning for OW-PREVIEW changes…</div>}

      {!loading && total === 0 && (
        <div style={{ color: '#94a3b8', fontSize: 14, padding: 30, textAlign: 'center', border: '1px dashed #1e293b', borderRadius: 10 }}>
          No preview changes found in June. Clean slate.
        </div>
      )}

      {!loading && events.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', margin: '4px 0 8px' }}>Events touched · {events.length}</div>
          {events.map(item => {
            const p = item.ev.extendedProperties?.private || {};
            return (
              <div key={item.ev.id} style={{ background: '#0c1322', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{cleanTitle(item.ev.summary)}</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
                    {item.calName} · {p.ow_preview_action || 'modified'}{p.ow_preview_ts ? ` · ${fmt(p.ow_preview_ts)}` : ''}
                  </div>
                </div>
                <button onClick={() => revertEvent(item)} disabled={busy === item.ev.id} style={{ flexShrink: 0, background: 'none', border: '1px solid #7f1d1d', borderRadius: 7, color: '#fca5a5', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: busy === item.ev.id ? 0.5 : 1 }}>
                  {busy === item.ev.id ? '…' : 'Revert'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', margin: '4px 0 8px' }}>Jobs created · {jobs.length}</div>
          {jobs.map(job => (
            <div key={job.id} style={{ background: '#0c1322', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{job.customer_name || '(no name)'}</div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{job.status}{job.created_at ? ` · ${fmt(job.created_at)}` : ''}</div>
              </div>
              <button onClick={() => revertJob(job)} disabled={busy === job.id} style={{ flexShrink: 0, background: 'none', border: '1px solid #7f1d1d', borderRadius: 7, color: '#fca5a5', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: busy === job.id ? 0.5 : 1 }}>
                {busy === job.id ? '…' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
