// ============================================
// Overwatch — FieldVisits (real notes on the board card)
// ============================================
// Tech notes live in THREE places in this app:
//   1. time_entries.notes  — written when a tech dispositions on Work Today
//   2. job.issue (📝 lines) — appended/imported field notes (often duplicated)
//   3. job_history          — only status stubs ("Assigned to X", "Job created")
// The card's NotesPanel reads #3, so it shows actions, not notes. This pulls the
// real notes from #1 and #2, de-duplicates them, and shows them on the card.

import { dispo } from '../utils/billing.js';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { reasonLabel, reasonColor, isRealCost } from '../config/archiveReasons.js';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function hoursFromMin(min) {
  if (min == null) return null;
  const h = Number(min) / 60;
  return isFinite(h) ? `${h.toFixed(1)}h` : null;
}

// Pull 📝-tagged notes out of the issue field. Splits on the 📝 marker, dedupes
// exact repeats (the data has them), and parses an optional "[date tech]" header.
function parseIssueNotes(issue) {
  if (!issue || issue.indexOf('📝') === -1) return [];
  const chunks = issue.split('📝').slice(1);
  const seen = new Set();
  const out = [];
  for (const raw of chunks) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;          // drop exact duplicates
    seen.add(key);
    const m = text.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    out.push(m ? { meta: m[1].trim(), body: m[2].trim() } : { meta: null, body: text });
  }
  return out;
}
const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const FIELDS =
  'id, event_title, event_start, tech_name, total_minutes, disposition, materials, notes, customer_name_raw, calendar_event_id, customer_id, created_at, archived, archived_at, archived_by, archive_reason';

const PREVIEW = 3;

export default function FieldVisits({ job }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setShowAll(false);
      const byId = {};
      try {
        if (job?.calendar_event_id) {
          const r = await supabase.from('time_entries').select(FIELDS).eq('calendar_event_id', job.calendar_event_id);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
        if (job?.customer_id) {
          const r = await supabase.from('time_entries').select(FIELDS).eq('customer_id', job.customer_id).limit(100);
          if (!r.error) for (const row of (r.data || [])) byId[row.id] = row;
        }
      } catch { /* leave what we have */ }
      const rows = Object.values(byId).sort(
        (a, b) => new Date(b.event_start || b.created_at) - new Date(a.event_start || a.created_at)
      );
      if (!cancelled) { setEntries(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [job?.calendar_event_id, job?.customer_id]);

  // 📝 notes from the issue field, minus any that duplicate a visit's note text.
  const issueNotes = useMemo(() => {
    const parsed = parseIssueNotes(job?.issue);
    const visitNoteSet = new Set(entries.map(e => norm(e.notes)).filter(Boolean));
    return parsed.filter(n => !visitNoteSet.has(norm(n.body)));
  }, [job?.issue, entries]);

  const visitsWithNotes = useMemo(() => entries.filter(e => e.notes || e.materials), [entries]);
  const total = visitsWithNotes.length + issueNotes.length;

  const shownVisits = showAll ? visitsWithNotes : visitsWithNotes.slice(0, PREVIEW);
  const shownIssue  = showAll ? issueNotes : issueNotes.slice(0, Math.max(0, PREVIEW - shownVisits.length));

  if (loading) return null;
  if (total === 0) return null;

  const wrap   = { marginBottom: 16 };
  const header = { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 };
  const card   = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };

  return (
    <div style={wrap}>
      <div style={header}>
        <span>📝 Field notes</span>
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>({total})</span>
      </div>

      {/* notes captured on Work Today (time_entries) */}
      {shownVisits.map(e => {
        const d = dispo(e.disposition);
        return (
          <div key={e.id} style={{ ...card, opacity: e.archived ? 0.78 : 1, borderColor: e.archived ? (isRealCost(e.archive_reason) ? '#f59e0b55' : '#47556955') : '#1e293b' }}>
            {e.archived && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                background: `${reasonColor(e.archive_reason)}1a`, border: `1px solid ${reasonColor(e.archive_reason)}55`,
                borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: reasonColor(e.archive_reason) }}>
                  🗑️ NOT BILLED — {reasonLabel(e.archive_reason).toUpperCase()}
                </span>
                {isRealCost(e.archive_reason) && (
                  <span style={{ fontSize: 11, color: '#fbbf24' }}>· DRH absorbed this cost</span>
                )}
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {e.archived_by ? `· ${String(e.archived_by).split('@')[0]}` : ''}
                  {e.archived_at ? ` · ${new Date(e.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </span>
              </div>
            )}
            {e.event_title && <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e2e8f0', marginBottom: 6 }}>{e.event_title}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', marginBottom: (e.materials || e.notes) ? 8 : 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${d.color}20`, color: d.color, border: `1px solid ${d.color}40` }}>{d.label}</span>
              {e.tech_name && <span>👷 {e.tech_name}</span>}
              {e.event_start && <span>📅 {fmtDateTime(e.event_start)}</span>}
              {hoursFromMin(e.total_minutes) && <span>⏱ {hoursFromMin(e.total_minutes)}</span>}
            </div>
            {e.materials && <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>🔧 {e.materials}</div>}
            {e.notes && <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{e.notes}</div>}
          </div>
        );
      })}

      {/* 📝 notes recovered from the issue field */}
      {shownIssue.map((n, idx) => (
        <div key={`issue-${idx}`} style={card}>
          {n.meta && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>👷 {n.meta}</div>
          )}
          <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{n.body}</div>
        </div>
      ))}

      {total > PREVIEW && (
        <button onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', color: '#00c8e8', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }}>
          {showAll ? 'Show less' : `View all ${total} notes →`}
        </button>
      )}
    </div>
  );
}
