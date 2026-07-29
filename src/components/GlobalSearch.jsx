import { useState, useEffect, useRef } from 'react';
import { supabase, STATUS_INFO } from '../services/supabase.js';

const TODOS_KEY = 'juce_things_to_do';

function dispositionColor(d) {
  switch (d) {
    case 'bill_it':    return '#22c55e';
    case 'return':     return '#f59e0b';
    case 'estimate':   return '#06b6d4';
    case 'in_progress': return '#3b82f6';
    default:           return '#64748b';
  }
}

function Chip({ color, children }) {
  return (
    <span style={{
      background: `${color}20`, color, border: `1px solid ${color}40`,
      borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600
    }}>
      {children}
    </span>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function ResultCard({ onClick, children }) {
  return (
    <div onClick={onClick} style={{
      background: '#1a1a2e', borderRadius: 10, padding: '12px 14px',
      cursor: 'pointer', border: '1px solid #1e293b',
      transition: 'border-color 0.15s'
    }}>
      {children}
    </div>
  );
}

export default function GlobalSearch({ onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ jobs: [], entries: [], todos: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults({ jobs: [], entries: [], todos: [] }); return; }
    const timer = setTimeout(() => doSearch(q), 280);
    return () => clearTimeout(timer);
  }, [query]);

  const doSearch = async (q) => {
    setLoading(true);

    // PostgREST .or() throws on , ( ) % * ' " \ — strip them so search never 400s.
    const safe = q.replace(/[,()%*'"\\]/g, ' ').replace(/\s+/g, ' ').trim();

    // NOTE: the Supabase query builder is a thenable, NOT a Promise — it has no
    // .catch(). Await each query inside try/catch instead, or one bad query kills
    // the whole search (this was the "search totally broke" bug).
    let jobs = [], entries = [];
    if (safe.length >= 2) {
      try {
        const { data } = await supabase
          .from('jobs')
          .select('id, customer_name, customer_phone, p_number, status, customer_address, created_at')
          .or(`p_number.ilike.%${safe}%,customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%,customer_address.ilike.%${safe}%`)
          .not('status', 'in', '(dead,billed,archived,lost)')
          .order('created_at', { ascending: false })
          .limit(20);
        jobs = (data || []).map(j => ({ ...j, job_number: j.p_number }));
      } catch (e) { console.warn('Job search failed:', e); }

      try {
        const { data } = await supabase
          .from('time_entries')
          .select('id, customer_name_raw, event_title, tech_name, created_at, disposition, materials, notes, project_ref')
          .or(`customer_name_raw.ilike.%${safe}%,event_title.ilike.%${safe}%,materials.ilike.%${safe}%,notes.ilike.%${safe}%,project_ref.ilike.%${safe}%`)
          .order('created_at', { ascending: false })
          .limit(20);
        entries = data || [];
      } catch (e) { console.warn('Entry search failed:', e); }
    }

    const ql = q.toLowerCase();
    let todos = [];
    try {
      const raw = JSON.parse(localStorage.getItem(TODOS_KEY) || '[]');
      todos = raw.filter(i =>
        (i.title     || '').toLowerCase().includes(ql) ||
        (i.location  || '').toLowerCase().includes(ql) ||
        (i.assignedTo|| '').toLowerCase().includes(ql) ||
        (i.materials || '').toLowerCase().includes(ql)
      ).slice(0, 5);
    } catch { /**/ }

    setResults({ jobs, entries, todos });
    setLoading(false);
  };

  const total = results.jobs.length + results.entries.length + results.todos.length;
  const hasQuery = query.trim().length >= 2;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 500, display: 'flex', flexDirection: 'column' }}
    >
      {/* Search bar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#0f1729', padding: '14px 14px 0', borderBottom: '1px solid #1e293b', flexShrink: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ color: '#cbd5e1', fontSize: 18, flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search customers, jobs, materials, notes…"
            style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
              color: '#e2e8f0', fontSize: 15, padding: '10px 14px', outline: 'none',
              fontFamily: 'inherit'
            }}
          />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 22, cursor: 'pointer', padding: 4, flexShrink: 0 }}>✕</button>
        </div>
      </div>

      {/* Results */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ flex: 1, overflowY: 'auto', padding: 14, WebkitOverflowScrolling: 'touch' }}
      >
        {loading && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 32, fontSize: 13 }}>Searching…</div>
        )}

        {!loading && hasQuery && total === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 48, fontSize: 14 }}>
            No results for "{query}"
          </div>
        )}

        {!hasQuery && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 48, fontSize: 13 }}>
            Type at least 2 characters to search
          </div>
        )}

        {results.jobs.length > 0 && (
          <Section label={`Customers / Jobs (${results.jobs.length})`}>
            {results.jobs.map(j => (
              <ResultCard key={j.id} onClick={() => { onNavigate(`/customers?name=${encodeURIComponent(j.customer_name || '')}`); onClose(); }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{j.customer_name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {j.job_number && <Chip color="#3b82f6">{j.job_number}</Chip>}
                  {j.status    && <Chip color={STATUS_INFO[j.status]?.color || '#64748b'}>{STATUS_INFO[j.status]?.icon} {STATUS_INFO[j.status]?.label || j.status}</Chip>}
                  {j.customer_phone && <span style={{ color: '#cbd5e1', fontSize: 11 }}>📞 {j.customer_phone}</span>}
                </div>
                {j.customer_address && (
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>📍 {j.customer_address}</div>
                )}
                <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>Tap to view full history →</div>
              </ResultCard>
            ))}
          </Section>
        )}

        {results.entries.length > 0 && (
          <Section label={`Time Entries (${results.entries.length})`}>
            {results.entries.map(e => (
              <ResultCard key={e.id} onClick={() => { onNavigate(`/customers?name=${encodeURIComponent(e.customer_name_raw || '')}`); onClose(); }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
                  {e.customer_name_raw || e.event_title || '(no name)'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {e.tech_name   && <Chip color="#22c55e">{e.tech_name}</Chip>}
                  {e.disposition && <Chip color={dispositionColor(e.disposition)}>{e.disposition.replace('_', ' ')}</Chip>}
                  {(e.project_ref || extractProjRef(e.event_title)) && (
                    <Chip color="#3b82f6">{e.project_ref || extractProjRef(e.event_title)}</Chip>
                  )}
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>
                    {new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {e.materials && (
                  <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 3 }}>
                    🔧 {e.materials.length > 70 ? e.materials.slice(0, 70) + '…' : e.materials}
                  </div>
                )}
                {e.notes && (
                  <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>
                    {e.notes.length > 80 ? e.notes.slice(0, 80) + '…' : e.notes}
                  </div>
                )}
              </ResultCard>
            ))}
          </Section>
        )}

        {results.todos.length > 0 && (
          <Section label={`Things To Do (${results.todos.length})`}>
            {results.todos.map(t => (
              <ResultCard key={t.id} onClick={() => { onNavigate('/people'); onClose(); }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{t.title}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {t.assignedTo && <Chip color="#f59e0b">{t.assignedTo}</Chip>}
                  {t.status     && <Chip color="#475569">{t.status}</Chip>}
                  {t.location   && <span style={{ color: '#cbd5e1', fontSize: 11 }}>📍 {t.location.slice(0, 40)}</span>}
                </div>
                {t.materials && (
                  <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 3 }}>🔧 {t.materials.slice(0, 70)}</div>
                )}
              </ResultCard>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function extractProjRef(title) {
  const mP = (title || '').match(/\[P-(\d+)\]/i);
  if (mP) return `P-${mP[1]}`;
  const mS = (title || '').match(/\[S-(\d+)\]/i);
  if (mS) return `S-${mS[1]}`;
  const mProj = (title || '').match(/\[PROJ-(\d+)\]/i);
  return mProj ? `PROJ-${mProj[1]}` : null;
}
