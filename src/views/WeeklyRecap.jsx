// ============================================
// WeeklyRecap — the numbers, plus somewhere to put the story
// ============================================
// Sara's ask: "how many events completed, how many locations visited" as real
// numbers, next to the human version — Vineyard was tense but JR held the
// scope, Jeff Godell landed, Mark Anderson was Austin's first bid-to-complete
// win. The app can only ever supply the first part honestly. The numbers
// below are computed from real rows (time_entries — the same table Event
// Audit and Billing already treat as the source of truth for "did work
// actually happen"), not guessed or inferred.
//
// Scheduled/Rescheduled counts are NEW as of this build — schedule.js didn't
// log who booked or rebooked anything before tonight, so there was no way to
// answer "how many did Shana schedule" for any week before this one. Past
// weeks will show 0 for those two numbers, honestly, with a note saying why.
// From here on they're real.

import { useState, useEffect, useCallback } from 'react';
import { supabase, notesApi } from '../services/supabase.js';

const C = {
  bg: '#0b1220', panel: '#131c2e', line: '#243244', text: '#e7edf5',
  muted: '#8fa1b8', accent: '#00c8e8', green: '#22c55e', amber: '#f59e0b', purple: '#a855f7',
};

// Monday-start week containing `d`.
function mondayOf(d) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0);
  return x;
}
function fmt(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

export default function WeeklyRecap({ userEmail, onBack }) {
  // Defaults to LAST full week, not the current partial one — a recap of
  // "this week" on a Wednesday is half a week and reads as thin.
  const [weekStart, setWeekStart] = useState(() => {
    const m = mondayOf(new Date()); m.setDate(m.getDate() - 7); return m;
  });
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [scheduleActions, setScheduleActions] = useState([]);
  const [focusText, setFocusText] = useState('');
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteFor, setSavingNoteFor] = useState(null);
  const [savedNoteFor, setSavedNoteFor] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startIso = weekStart.toISOString();
      const endIso = weekEnd.toISOString();

      const [{ data: te }, { data: jobs }, { data: hist }] = await Promise.all([
        supabase.from('time_entries')
          .select('id, customer_id, customer_name_raw, event_title, event_start, tech_name, disposition, job_id, archived')
          .gte('event_start', startIso).lt('event_start', endIso)
          .order('event_start', { ascending: true }).limit(1000),
        supabase.from('jobs').select('id, job_type, customer_name'),
        // The recap markers logged by schedule.js — job_history rows with the
        // "📅 RECAP:" prefix. Nothing before this build has these; that's
        // expected, not a bug.
        supabase.from('job_history')
          .select('id, job_id, changed_by, changed_at, notes')
          .gte('changed_at', startIso).lt('changed_at', endIso)
          .ilike('notes', '📅 RECAP:%')
          .limit(1000),
      ]);

      const jobById = Object.fromEntries((jobs || []).map(j => [j.id, j]));
      const live = (te || []).filter(e => !e.archived);
      setEntries(live.map(e => ({ ...e, job: jobById[e.job_id] || null })));
      setScheduleActions(hist || []);
    } catch (e) { console.error('recap load', e); }
    setLoading(false);
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // ── The real numbers ─────────────────────────────────────────────────
  const completed = entries.filter(e => e.disposition === 'bill_it');
  const locationKeys = new Set(entries.map(e => e.customer_id || e.customer_name_raw || e.event_title));
  const serviceCalls = entries.filter(e => e.job?.job_type === 'service' || (!e.job && !e.job_id));

  const byPerson = (verb) => {
    const counts = {};
    scheduleActions
      .filter(h => h.notes?.includes(`RECAP: ${verb}`))
      .forEach(h => { const who = h.changed_by || 'unknown'; counts[who] = (counts[who] || 0) + 1; });
    return counts;
  };
  const scheduledBy = byPerson('Scheduled');
  const rescheduledBy = byPerson('Rescheduled');
  const heldBy = byPerson('Held');
  const hasAnyScheduleData = scheduleActions.length > 0;

  const saveNote = async (jobId) => {
    const text = (noteDrafts[jobId] || '').trim();
    if (!text || !jobId) return;
    setSavingNoteFor(jobId);
    try {
      await notesApi.addNote(jobId, `📝 Weekly recap note: ${text}`, userEmail || 'recap');
      setSavedNoteFor(m => ({ ...m, [jobId]: true }));
    } catch (e) { alert('Could not save note: ' + (e.message || e)); }
    setSavingNoteFor(null);
  };

  const copyRecap = () => {
    const lines = [];
    lines.push(`Weekly Recap — ${fmt(weekStart)} to ${fmt(new Date(weekEnd - 86400000))}`);
    lines.push('');
    lines.push(`✅ ${completed.length} completed  ·  📍 ${locationKeys.size} locations visited  ·  🔧 ${serviceCalls.length} service calls`);
    if (hasAnyScheduleData) {
      const fmtCounts = (obj) => Object.entries(obj).map(([k, v]) => `${k.split('@')[0]}: ${v}`).join(', ') || '—';
      lines.push(`📅 Scheduled — ${fmtCounts(scheduledBy)}`);
      lines.push(`🔁 Rescheduled — ${fmtCounts(rescheduledBy)}`);
    }
    lines.push('');
    if (completed.length) {
      lines.push('Completed this week:');
      completed.forEach(e => lines.push(`  • ${e.job?.customer_name || e.customer_name_raw || e.event_title || 'Unnamed'} (${e.tech_name || 'no tech'})`));
      lines.push('');
    }
    if (focusText.trim()) {
      lines.push('This week\'s focus:');
      lines.push(focusText.trim());
    }
    navigator.clipboard?.writeText(lines.join('\n'));
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, background: C.bg, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: '#1e293b', border: 'none', color: C.muted, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Home</button>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Weekly Recap</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
            style={{ background: 'none', border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(weekStart)} – {fmt(new Date(weekEnd - 86400000))}</div>
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
            disabled={weekEnd > new Date()}
            style={{ background: 'none', border: `1px solid ${C.line}`, color: weekEnd > new Date() ? '#3a4658' : C.text, borderRadius: 8, padding: '6px 12px', cursor: weekEnd > new Date() ? 'default' : 'pointer' }}>→</button>
          <button onClick={copyRecap}
            style={{ marginLeft: 'auto', background: C.accent, border: 'none', color: '#08121f', fontWeight: 800, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
            📋 Copy recap
          </button>
        </div>
      </div>

      <div style={{ padding: 18, maxWidth: 760, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: C.muted, padding: 60 }}>Loading…</div>
        ) : (
          <>
            {/* ── The real numbers ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { n: completed.length, label: 'completed', color: C.green },
                { n: locationKeys.size, label: 'locations visited', color: C.accent },
                { n: serviceCalls.length, label: 'service calls', color: C.amber },
              ].map((s, i) => (
                <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.n}</div>
                  <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* ── Scheduled / rescheduled by person ── */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Scheduled &amp; rescheduled</div>
              {!hasAnyScheduleData ? (
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                  No tracking exists for weeks before this build — booking actions weren't
                  logged by person until now. This will be real starting with the current week.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  {Object.entries(scheduledBy).map(([who, n]) => (
                    <div key={'s' + who}><b style={{ color: C.accent }}>{who.split('@')[0]}</b> scheduled <b>{n}</b> job{n > 1 ? 's' : ''}</div>
                  ))}
                  {Object.entries(rescheduledBy).map(([who, n]) => (
                    <div key={'r' + who}><b style={{ color: C.amber }}>{who.split('@')[0]}</b> rescheduled <b>{n}</b> job{n > 1 ? 's' : ''}</div>
                  ))}
                  {Object.entries(heldBy).map(([who, n]) => (
                    <div key={'h' + who}><b style={{ color: C.purple }}>{who.split('@')[0]}</b> held <b>{n}</b> slot{n > 1 ? 's' : ''}</div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Completed jobs — pick some to add the human story to ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Completed this week ({completed.length})
              </div>
              {completed.length === 0 ? (
                <div style={{ fontSize: 12, color: C.muted }}>Nothing marked done this week.</div>
              ) : completed.map(e => (
                <div key={e.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{e.job?.customer_name || e.customer_name_raw || e.event_title || 'Unnamed'}</div>
                    <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{e.tech_name || 'no tech'}</div>
                  </div>
                  {e.job_id && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <input value={noteDrafts[e.job_id] || ''} onChange={ev => setNoteDrafts(m => ({ ...m, [e.job_id]: ev.target.value }))}
                        placeholder="Add the story — client happy? first win? tight scope call?"
                        style={{ flex: 1, background: '#0f1729', border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 12, outline: 'none' }} />
                      <button onClick={() => saveNote(e.job_id)} disabled={savingNoteFor === e.job_id || !noteDrafts[e.job_id]?.trim()}
                        style={{ background: savedNoteFor[e.job_id] ? '#22c55e33' : '#1e293b', border: `1px solid ${C.line}`, color: savedNoteFor[e.job_id] ? C.green : C.muted,
                                 borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {savedNoteFor[e.job_id] ? 'Saved ✓' : savingNoteFor === e.job_id ? '…' : 'Save to job'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── This week's focus — freeform, not persisted ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>This week's focus</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                Not saved anywhere yet — write it, then hit Copy recap at the top before you leave this page.
              </div>
              <textarea value={focusText} onChange={e => setFocusText(e.target.value)} rows={4}
                placeholder="x, y, z…"
                style={{ width: '100%', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, color: C.text, padding: '10px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
