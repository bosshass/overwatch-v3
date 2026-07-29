// ============================================
// Overwatch — Reconcile (operator-only cleanup)
// ============================================
// One-time-ish sweep of OLD calendar events that never got closed out.
// Rule (Sara's): Completed calendar = done. Anything before May 1 2026 that
// isn't on Completed and isn't already ignored is the review pile. Tag like
// [BILL IT]/[BILLED]/[COMPLETE] = done even if stranded on a tech calendar
// (the move-to-Completed bug left a lot of those behind).
//
// Read-only until you click. "Mark done" writes the ignore flag via the
// existing machinery (ignoreAllOrphans → juce_ignored_events + activity_log).
//
// Route (App.jsx): <Route path="/admin/reconcile" element={<OperatorOnly>
//   <ReconcileView accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} />
// </OperatorOnly>} />

import { useState, useEffect, useCallback } from 'react';
import { CALENDARS } from '../config/calendars.js';
import { jobsApi, JOB_STATUS } from '../services/supabase.js';
import { ignoreAllOrphans, isOrphanIgnored, syncIgnoredOrphansFromSupabase } from '../services/calendarSync.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';
const CUTOFF = new Date();                               // through today — the underlying stranding bug was active in July too
const SWEEP_FROM = new Date('2026-06-01T00:00:00');      // still starts June 1, widen further if needed
const COMPLETED_FROM = new Date('2026-06-01T00:00:00');

// Calendars to sweep — Sara's list. Completed + Sales excluded.
const SWEEP = [
  { id: CALENDARS.AUSTIN,                name: 'Austin' },
  { id: CALENDARS.JR,                    name: 'JR' },
  { id: CALENDARS.TECH3,                 name: 'Brian' },
  { id: CALENDARS.SUBS,                  name: 'Subs' },
  { id: CALENDARS.INSTALLATIONS,         name: 'Installations' },
  { id: CALENDARS.RETURN_VISITS,         name: 'Returns' },
  { id: CALENDARS.TENTATIVELY_SCHEDULED, name: 'Queue' },
  { id: CALENDARS.SHANA,                 name: 'Shana' },
  { id: CALENDARS.ADMIN_NOTES,           name: 'Admin Notes' },
];

// A title with one of these = done, even if stranded off the Completed calendar.
const DONE_TAGS = ['[BILL IT]', '[BILLED]', '[INVOICED]', '[INVOICE]', '[COMPLETE]', '[COMPLETED]', '[DONE]', '[PAID]', '[NC]', '[NO CHARGE]'];

// Triage statuses for "Set status" — the board statuses, no hours required.
const TRIAGE = [
  { status: JOB_STATUS.RETURN_PENDING,   label: 'Return needed',     icon: '🔄', color: '#ec4899' },
  { status: JOB_STATUS.NEEDS_ESTIMATE,   label: 'Needs estimate',    icon: '📋', color: '#f59e0b' },
  { status: JOB_STATUS.NEEDS_PARTS,      label: 'Needs parts',       icon: '📦', color: '#eab308' },
  { status: JOB_STATUS.NEEDS_DETAILS,    label: 'Needs notes',       icon: '📝', color: '#f97316' },
  { status: JOB_STATUS.PENDING_DECISION, label: 'Blocked',           icon: '⏳', color: '#a855f7' },
  { status: JOB_STATUS.READY_TO_SCHEDULE,label: 'Ready to schedule', icon: '✅', color: '#22c55e' },
];

function startOf(ev) { return ev.start?.dateTime || ev.start?.date || null; }
function looksDone(title) {
  const up = (title || '').toUpperCase();
  return DONE_TAGS.some(t => up.includes(t));
}
function cleanNotes(desc) {
  // Drop the deep-link line; keep the human notes.
  return (desc || '')
    .replace(/\n*📱 Open in Overwatch:.*$/s, '')
    .replace(/\n*🔗 OPEN IN OVERWATCH:.*$/s, '')
    .trim();
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function moveToCompleted(accessToken, sourceCalId, eventId) {
  const url = `${GCAL}/calendars/${encodeURIComponent(sourceCalId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  return res.ok;
}

// Stamp any event this PREVIEW build modifies — visible note + machine tag — so every
// change is auditable and reversible. Search Google Calendar for "OW-PREVIEW" to find them all.
async function stampEvent(accessToken, calId, evId, action, extra = {}) {
  try {
    const getRes = await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } });
    const ev = await getRes.json();
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' });
    const note = `\n\n🔬 OW-PREVIEW ${when} — ${action} (preview build)`;
    await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: (ev.description || '') + note,
        extendedProperties: { private: { ow_preview: 'true', ow_preview_action: action, ow_preview_ts: new Date().toISOString(), ...extra } },
      }),
    });
  } catch (e) { console.warn('preview stamp failed', evId, e); }
}

async function fetchAllPages(accessToken, calId, timeMin, timeMax) {
  const out = [];
  let pageToken = null;
  for (let i = 0; i < 8; i++) {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(calId)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break;
    const data = await res.json();
    out.push(...(data.items || []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

export default function ReconcileView({ accessToken, userEmail, onBack, onOpenFinish, onOpenPreview }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState([]);       // looks-done candidates
  const [review, setReview] = useState([]);   // needs-eyes candidates
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [pickerRow, setPickerRow] = useState(null);

  const load = useCallback(async () => {
    if (!accessToken) { setError('Not signed in.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      await syncIgnoredOrphansFromSupabase();

      // 1) Build the "done" set from the Completed calendar (this year).
      const completedEvents = await fetchAllPages(accessToken, CALENDARS.COMPLETED, COMPLETED_FROM, new Date());
      const completedIds = new Set(completedEvents.map(e => e.id));

      // 2) Sweep the working calendars and filter to the review pile.
      const doneList = [], reviewList = [];
      for (const cal of SWEEP) {
        const events = await fetchAllPages(accessToken, cal.id, SWEEP_FROM, CUTOFF);
        for (const ev of events) {
          if (ev.status === 'cancelled') continue;
          const start = startOf(ev);
          if (!start || new Date(start) >= CUTOFF) continue;       // before May 1 2026 only
          if (completedIds.has(ev.id)) continue;                    // already on Completed = done
          if (isOrphanIgnored(ev.id)) continue;                     // already ignored
          const row = {
            id: ev.id,
            calId: cal.id,
            calName: cal.name,
            title: (ev.summary || '(no title)'),
            start,
            notes: cleanNotes(ev.description),
            location: ev.location || '',
          };
          (looksDone(ev.summary) ? doneList : reviewList).push(row);
        }
      }
      doneList.sort((a, b) => new Date(b.start) - new Date(a.start));
      reviewList.sort((a, b) => new Date(b.start) - new Date(a.start));
      setDone(doneList);
      setReview(reviewList);
      setSelected(new Set(doneList.map(r => r.id)));   // pre-check the looks-done bucket
      setLoading(false);
    } catch (e) {
      setError(e.message || 'Scan failed');
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpand = (id) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = (rows, on) => setSelected(s => { const n = new Set(s); rows.forEach(r => on ? n.add(r.id) : n.delete(r.id)); return n; });

  const applyStatus = async (status) => {
    if (!pickerRow) return;
    setBusy(true);
    try {
      // Stamp the source event so the preview change is auditable.
      try { await stampEvent(accessToken, pickerRow.calId, pickerRow.id, `set status: ${status}`, { ow_preview_origin: pickerRow.calId }); } catch {}
      // Create a tracked job from the calendar event with the chosen status — no hours.
      // created_by carries a PREVIEW marker so every preview-made row is one query away.
      await jobsApi.create({
        customer_name: pickerRow.title.replace(/\s*\[.*?\]\s*$/, '').trim(),
        status,
        issue: pickerRow.notes || '',
        customer_address: pickerRow.location || '',
        calendar_event_id: pickerRow.id,
      }, `${userEmail} · PREVIEW`);
      await ignoreAllOrphans([pickerRow.id]);   // off the reconcile list — it's tracked now
      setDone(d => d.filter(r => r.id !== pickerRow.id));
      setReview(d => d.filter(r => r.id !== pickerRow.id));
      setPickerRow(null);
    } catch (e) { setError(e.message || 'Failed to set status'); }
    finally { setBusy(false); }
  };

  const markDone = async () => {
    const rows = [...done, ...review].filter(r => selected.has(r.id));
    if (!rows.length) return;
    if (!confirm(`Mark ${rows.length} event(s) done?\n\nThey'll move onto the Completed calendar and stop showing as open. Nothing is deleted.`)) return;
    setBusy(true);
    try {
      // Stamp (preview audit trail), then move each event onto Completed, then write the ignore flag.
      for (const r of rows) {
        try { await stampEvent(accessToken, r.calId, r.id, 'moved to Completed', { ow_preview_origin: r.calId }); } catch {}
        try { await moveToCompleted(accessToken, r.calId, r.id); } catch (e) { console.warn('move failed', r.id, e); }
      }
      await ignoreAllOrphans(rows.map(r => r.id));
      setDone(d => d.filter(r => !selected.has(r.id)));
      setReview(d => d.filter(r => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e) { setError(e.message || 'Failed to save'); }
    finally { setBusy(false); }
  };

  const Section = ({ title, rows, accent, note }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ color: accent, fontSize: 14, fontWeight: 800 }}>{title} ({rows.length})</div>
        {rows.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => selectAll(rows, true)} style={miniBtn}>Select all</button>
            <button onClick={() => selectAll(rows, false)} style={miniBtn}>Clear</button>
          </div>
        )}
      </div>
      {note && <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 10 }}>{note}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => {
          const isSel = selected.has(r.id);
          const isOpen = expanded.has(r.id);
          return (
            <div key={r.id} style={{ background: '#0c1322', border: `1px solid ${isSel ? accent : '#1e293b'}`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(r.id)} style={{ marginTop: 3, width: 16, height: 16, accentColor: accent, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{r.title}</div>
                  <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>
                    {r.calName} · {fmtDate(r.start)}{r.location ? ` · ${r.location}` : ''}
                  </div>
                  {r.notes && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: isOpen ? 'none' : 54, overflow: 'hidden' }}>
                        {r.notes}
                      </div>
                      {r.notes.length > 120 && (
                        <button onClick={() => toggleExpand(r.id)} style={{ background: 'none', border: 'none', color: accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: '2px 0' }}>
                          {isOpen ? 'less' : 'more'}
                        </button>
                      )}
                    </div>
                  )}
                  {!r.notes && <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>no notes on this event</div>}
                </div>
                <button onClick={() => setPickerRow(r)} title="Set a status — like the board, no hours" style={openBtn}>Set status →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1729', zIndex: 10 }}>
        <button onClick={onBack} style={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#e2e8f0', fontSize: 14, fontWeight: 700, padding: '8px 14px', cursor: 'pointer' }}>← Home</button>
        <span style={{ fontWeight: 800, color: '#00c8e8', fontSize: 15 }}>🧹 Reconcile</span>
        {onOpenPreview && <button onClick={onOpenPreview} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #00c8e8', borderRadius: 8, color: '#00c8e8', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>🔬 Preview log</button>}
        <button onClick={load} disabled={loading} style={{ marginLeft: onOpenPreview ? 8 : 'auto', ...miniBtn }}>{loading ? 'Scanning…' : '↻ Rescan'}</button>
      </div>

      <div style={{ padding: '16px 16px 8px' }}>
        <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.5 }}>
          <b style={{ color: '#00c8e8' }}>June 2026 only · preview build.</b> Every change is stamped <b>OW-PREVIEW</b> on the event (search your calendar for it) and preview-made jobs are tagged in <code>created_by</code>. <b style={{ color: '#22c55e' }}>Check + Mark done</b> = finished → moves to Completed. <b style={{ color: '#00c8e8' }}>Set status →</b> = real but untagged → tag it like the board, no hours. Nothing is deleted.
        </div>
      </div>

      {error && <div style={{ margin: '8px 16px', background: '#2d1416', border: '1px solid #ef4444', borderRadius: 10, padding: 12, color: '#fca5a5', fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Scanning this year's calendars… a few seconds.</div>
      ) : (
        <div style={{ padding: '8px 16px 120px' }}>
          {done.length === 0 && review.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#22c55e', fontSize: 15, fontWeight: 700 }}>Nothing to reconcile — you're clean.</div>
          ) : (
            <>
              <Section title="Looks done" rows={done} accent="#22c55e" note="Has a billed/complete tag — almost certainly done. Pre-checked." />
              <Section title="Needs your eyes" rows={review} accent="#f59e0b" note="Return-flagged or untagged. Read the notes, check the ones that got handled." />
            </>
          )}
        </div>
      )}

      {!loading && (done.length > 0 || review.length > 0) && (
        <div style={{ position: 'sticky', bottom: 0, background: '#0f1729', borderTop: '1px solid #1e293b', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{selected.size} selected</span>
          <button onClick={markDone} disabled={busy || selected.size === 0} style={{ marginLeft: 'auto', background: selected.size ? '#22c55e' : '#1e293b', color: selected.size ? '#06121f' : '#475569', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 800, cursor: selected.size ? 'pointer' : 'default' }}>
            {busy ? 'Saving…' : `Mark ${selected.size} done`}
          </button>
        </div>
      )}

      {pickerRow && (
        <div onClick={() => !busy && setPickerRow(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: '#0f1729', borderTop: '1px solid #1e293b', borderRadius: '16px 16px 0 0', padding: '18px 18px 28px' }}>
            <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>{pickerRow.title.replace(/\s*\[.*?\]\s*$/, '')}</div>
            <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 14 }}>{pickerRow.calName} · pick a status — no hours needed</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {TRIAGE.map(t => (
                <button key={t.status} disabled={busy} onClick={() => applyStatus(t.status)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0c1322', border: `1.5px solid ${t.color}`, borderRadius: 12, padding: '14px 12px', color: '#e2e8f0', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, textAlign: 'left' }}>
                  <span style={{ fontSize: 20 }}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <button onClick={() => !busy && setPickerRow(null)} style={{ width: '100%', marginTop: 12, background: '#1e293b', border: 'none', borderRadius: 10, color: '#94a3b8', padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtn = { background: 'none', border: '1px solid #334155', borderRadius: 7, color: '#94a3b8', padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const openBtn = { flexShrink: 0, alignSelf: 'flex-start', background: 'none', border: '1px solid #00c8e8', borderRadius: 7, color: '#00c8e8', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
