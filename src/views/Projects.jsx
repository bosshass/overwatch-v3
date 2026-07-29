// ============================================
// Projects — every P-code, by stored hours OR scheduled event
// ============================================
// A project ref (P-NNN / S-NNN / PROJ-NNN) shows here if ANY of these is true:
//   • a job row carries that p_number               (budget / estimate $)
//   • a time_entry is tagged with that project_ref  (billed OR unbilled hours)
//   • a calendar event title carries [P-NNN]         (scheduled, maybe not worked yet)
//
// Hours are pulled regardless of billed status — billed and unbilled both roll up.
// Calendar events come from services/calendarApi.fetchAllCalendars (shared fetch),
// not a duplicate fetch in this view.

import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase.js';
import { fetchAllCalendars } from '../services/calendarApi.js';
import { CALENDARS } from '../config/calendars.js';

const formatMoney = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const formatHours = (mins) => `${(Number(mins || 0) / 60).toFixed(1)}h`;
const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

// Pull a canonical project ref out of a calendar title: [P-NNN] / [S-NNN] / [PROJ-NNN]
function extractRef(title) {
  const mP = (title || '').match(/\[P-(\d+)\]/i);
  if (mP) return `P-${mP[1]}`;
  const mS = (title || '').match(/\[S-(\d+)\]/i);
  if (mS) return `S-${mS[1]}`;
  const mProj = (title || '').match(/\[PROJ-(\d+)\]/i);
  return mProj ? `PROJ-${mProj[1]}` : null;
}

// Strip leading [TAGS] and trailing " - …" to get a display name from an event title
function cleanName(title) {
  let n = title || '';
  while (n.match(/^\[[^\]]+\]\s*/)) n = n.replace(/^\[[^\]]+\]\s*/, '');
  return n.split(' - ')[0].trim() || (title || '').trim();
}

// Sort refs newest-first by numeric part, grouping by prefix
function refSort(a, b) {
  const pa = a.match(/^([A-Z]+)-(\d+)$/i), pb = b.match(/^([A-Z]+)-(\d+)$/i);
  if (pa && pb && pa[1].toUpperCase() === pb[1].toUpperCase()) return Number(pb[2]) - Number(pa[2]);
  return b.localeCompare(a);
}

const PROJECT_CALENDARS = [
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Service Queue' },
  { id: CALENDARS.AUSTIN,                name: 'Austin' },
  { id: CALENDARS.JR,                    name: 'JR' },
  { id: CALENDARS.INSTALLATIONS,         name: 'Installations' },
  { id: CALENDARS.COMPLETED,             name: 'Completed' },
];

export default function Projects({ accessToken, onBack }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { (async () => {
    setLoading(true);
    setError(null);
    try {
      // ── 1. Jobs with a P-number → budget / estimate / customer ──
      const { data: jobs, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, p_number, s_number, customer_name, customer_address, status, qbo_estimate_status, estimate_amount, invoiced_amount, remaining_amount, created_at')
        .not('p_number', 'is', null);
      if (jobsErr) throw jobsErr;
      const jobByRef = {};
      for (const j of (jobs || [])) if (j.p_number) jobByRef[j.p_number] = j;

      // ── 2. ALL tagged time entries (billed AND unbilled) ──
      const { data: entries, error: teErr } = await supabase
        .from('time_entries')
        .select('id, project_ref, tech_name, tech_email, total_minutes, time_in, event_title, calendar_event_id, disposition, materials, billed, billed_at, invoice_ref')
        .not('project_ref', 'is', null)
        .order('time_in', { ascending: false });
      if (teErr) throw teErr;
      const entriesByRef = {};
      for (const e of (entries || [])) (entriesByRef[e.project_ref] = entriesByRef[e.project_ref] || []).push(e);

      // ── 3. Calendar events tagged [P-NNN] (scheduled work) ──
      // Uses the shared calendar module — no duplicate fetch here.
      const eventsByRef = {};
      if (accessToken) {
        try {
          const timeMin = new Date(Date.now() - 365 * 86400000);
          const timeMax = new Date(Date.now() + 180 * 86400000);
          const calEvents = await fetchAllCalendars(accessToken, PROJECT_CALENDARS, timeMin, timeMax);
          for (const ev of (calEvents || [])) {
            const ref = extractRef(ev.summary);
            if (!ref) continue;
            (eventsByRef[ref] = eventsByRef[ref] || []).push({
              id: ev.id,
              summary: ev.summary || '',
              name: cleanName(ev.summary),
              start: ev.start?.dateTime || ev.start?.date || null,
              calendarName: ev._calendarName || '',
            });
          }
        } catch (e) {
          // Calendar is best-effort; stored hours still render without it.
          if (e.message !== 'TOKEN_EXPIRED') console.warn('Projects calendar scan failed:', e.message);
        }
      }

      // ── 4. Union of every ref seen anywhere ──
      const allRefs = new Set([
        ...Object.keys(jobByRef),
        ...Object.keys(entriesByRef),
        ...Object.keys(eventsByRef),
      ]);

      const merged = [...allRefs].sort(refSort).map(ref => {
        const job = jobByRef[ref] || null;
        const es = entriesByRef[ref] || [];
        const evs = eventsByRef[ref] || [];

        // Don't double-count a scheduled event that already has a logged time entry
        const workedEventIds = new Set(es.map(e => e.calendar_event_id).filter(Boolean));
        const scheduledOnly = evs.filter(ev => !workedEventIds.has(ev.id))
          .sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0));

        const unbilledMinutes = es.filter(e => !e.billed).reduce((s, e) => s + (Number(e.total_minutes) || 0), 0);
        const billedMinutes   = es.filter(e => e.billed).reduce((s, e) => s + (Number(e.total_minutes) || 0), 0);
        const totalMinutes    = unbilledMinutes + billedMinutes;

        const techs = {};
        for (const e of es) {
          const t = e.tech_name || e.tech_email?.split('@')[0] || 'Unknown';
          techs[t] = (techs[t] || 0) + (Number(e.total_minutes) || 0);
        }

        const customerName = job?.customer_name
          || es.find(e => e.event_title)?.event_title && cleanName(es.find(e => e.event_title).event_title)
          || scheduledOnly[0]?.name
          || 'Unknown';

        return {
          ref, job, entries: es, scheduled: scheduledOnly,
          unbilledMinutes, billedMinutes, totalMinutes, techs,
          customerName,
          address: job?.customer_address || '',
          status: job?.qbo_estimate_status || null,
          budget: job?.estimate_amount || null,
        };
      });

      setRows(merged);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  })(); }, [accessToken]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>← Home</button>
          <h2 style={{ margin: 0 }}>🔨 Projects</h2>
        </div>
        <span style={{ color: '#cbd5e1', fontSize: 12 }}>{rows.length} projects</span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ color: '#cbd5e1', textAlign: 'center', padding: 40 }}>Loading…</div>}
        {error && <div style={{ color: '#ef4444', padding: 12, background: '#7f1d1d22', borderRadius: 8 }}>Error: {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={{ color: '#cbd5e1', textAlign: 'center', padding: 40 }}>No projects yet. Tag a time entry or a calendar event with a P-code.</div>
        )}
        {!loading && !error && rows.map(r => {
          const isOpen = expanded === r.ref;
          const isTerminal = ['Lost', 'Billed'].includes(r.status);
          const entryCount = r.entries.length;
          return (
            <div key={r.ref} style={{ background: '#1e293b', borderRadius: 8, padding: 14, borderLeft: '3px solid #22c55e', opacity: isTerminal ? 0.6 : 1 }}>
              <div onClick={() => setExpanded(isOpen ? null : r.ref)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ background: '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>{r.ref}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{r.customerName}</span>
                    {r.status && (
                      <span style={{ fontSize: 10, color: '#94a3b8', background: '#33415540', padding: '2px 6px', borderRadius: 4 }}>{r.status}</span>
                    )}
                    {!r.job && (
                      <span style={{ fontSize: 9, color: '#fbbf24', background: '#78350f40', padding: '2px 6px', borderRadius: 4 }}>NO JOB ROW</span>
                    )}
                  </div>
                  {r.address && <div style={{ fontSize: 11, color: '#cbd5e1' }}>{r.address}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 150 }}>
                  {r.budget != null && <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>{formatMoney(r.budget)} budget</div>}
                  <div style={{ fontSize: 12, color: '#fbbf24' }}>{formatHours(r.unbilledMinutes)} unbilled</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {formatHours(r.totalMinutes)} total · {entryCount} entr{entryCount === 1 ? 'y' : 'ies'}
                    {r.scheduled.length > 0 && ` · ${r.scheduled.length} scheduled`}
                  </div>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #334155' }}>
                  {Object.keys(r.techs).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {Object.entries(r.techs).map(([t, m]) => (
                        <span key={t} style={{ fontSize: 11, color: '#cbd5e1', background: '#33415560', padding: '3px 8px', borderRadius: 4 }}>
                          {t}: {formatHours(m)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Logged time entries — billed and unbilled */}
                  {entryCount === 0 && r.scheduled.length === 0 && (
                    <div style={{ color: '#cbd5e1', fontSize: 12, fontStyle: 'italic' }}>No time entries logged yet.</div>
                  )}
                  {r.entries.map(e => {
                    const isNC = e.invoice_ref === 'NC-ARCHIVED';
                    const badge = isNC
                      ? { t: 'No Charge', bg: '#37415160', c: '#9ca3af' }
                      : e.billed
                        ? { t: 'Billed', bg: '#14532d60', c: '#4ade80' }
                        : { t: 'Unbilled', bg: '#78350f60', c: '#fbbf24' };
                    return (
                      <div key={e.id} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#cbd5e1' }}>{e.tech_name || e.tech_email?.split('@')[0] || 'Unknown'} · {formatHours(e.total_minutes)}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: badge.bg, color: badge.c }}>{badge.t}</span>
                            <span style={{ color: '#cbd5e1' }}>{fmtDay(e.time_in)}</span>
                          </span>
                        </div>
                        {e.event_title && <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{e.event_title}</div>}
                        {e.materials && <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 2 }}>🔧 {e.materials}</div>}
                        {e.invoice_ref && !isNC && <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2 }}>Invoice #{e.invoice_ref}</div>}
                      </div>
                    );
                  })}

                  {/* Scheduled calendar events with no logged time yet */}
                  {r.scheduled.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Scheduled — no time logged
                      </div>
                      {r.scheduled.map(ev => (
                        <div key={ev.id} style={{ background: '#0c1a3d', borderRadius: 6, padding: '8px 10px', marginBottom: 4, fontSize: 12, border: '1px solid #1e3a5f' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#93c5fd' }}>📅 {ev.calendarName}</span>
                            <span style={{ color: '#cbd5e1' }}>{fmtDay(ev.start)}</span>
                          </div>
                          <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{ev.summary}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
