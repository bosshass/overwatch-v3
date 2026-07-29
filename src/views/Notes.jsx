// ============================================
// Notes — Shana's notes. Not jobs. Never jobs.
// ============================================
// The board is for work that gets scheduled, dispatched and billed. This is
// for everything else: "call back about the gate code", "Wendys wants a quote
// in the spring", "Barbara prefers afternoons". Those things were being typed
// into a job card because there was nowhere else to put them, which is how the
// board got cluttered enough that Shana stopped opening it.
//
// A note NEVER becomes a job and never appears on any board. It can be tied to
// a customer for context, and when it's marked done Shana is asked whether it
// belongs on that client's permanent record. Either way it archives — nothing
// is deleted, and the archive is searchable.
//
// Backed by the `notes` table (migration 028), NOT job_history. See that
// migration for why customersApi.addNote() was the wrong home.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { CALENDARS } from '../config/calendars.js';
import CustomerPicker from '../components/CustomerPicker.jsx';

const GCAL = 'https://www.googleapis.com/calendar/v3';

const BG = '#0f1729', SURFACE = '#1e293b', LINE = '#334155';
const TEXT = '#e2e8f0', MUTED = '#94a3b8', ACCENT = '#00c8e8';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - new Date(d.toDateString())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 0 && diff <= 6) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Done prompt ──────────────────────────────────────────────────────
// Marking done always archives. The only question is whether it also lands
// on a client's permanent record. "No" is a first-class answer, not a cancel.
function DonePrompt({ note, customers, onCancel, onArchive, saving }) {
  const [customerId, setCustomerId] = useState(note.customer_id || null);

  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1200,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: SURFACE, borderRadius: 14, padding: 20, width: '100%', maxWidth: 460 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Add this to a client record?</div>
        <div style={{ color: MUTED, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
          Either way this note archives and leaves your list. Filing it means it shows up
          on that client's record later.
        </div>

        <div style={{ background: BG, borderRadius: 8, padding: 11, fontSize: 13,
                      color: MUTED, marginBottom: 14, maxHeight: 110, overflowY: 'auto' }}>
          {note.body}
        </div>

        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            disabled={!customerId || saving}
            onClick={() => onArchive({ customerId, onRecord: true })}
            style={{ flex: 1, background: customerId ? '#22c55e' : '#1a2537',
                     color: customerId ? '#0f1729' : MUTED, border: 'none', borderRadius: 8,
                     padding: '11px 0', fontSize: 13, fontWeight: 700,
                     cursor: customerId ? 'pointer' : 'default' }}>
            {saving ? '…' : 'File it & archive'}
          </button>
          <button
            disabled={saving}
            onClick={() => onArchive({ customerId: note.customer_id || null, onRecord: false })}
            style={{ flex: 1, background: 'transparent', color: TEXT, border: `1px solid ${LINE}`,
                     borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            No, just archive
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Notes({ userEmail, onBack, accessToken }) {
  const [notes, setNotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tab, setTab] = useState('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftCustomer, setDraftCustomer] = useState(null);
  const [donePrompt, setDonePrompt] = useState(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [importable, setImportable] = useState(null); // null = not looked yet
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState(new Set());

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notes').select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      setNotes(data || []);
    } catch (e) {
      console.error('notes load', e);
      say('Could not load notes');
    }
    setLoading(false);
  }, []);

  const loadCustomers = useCallback(async () => {
    // merged_into IS NULL — merged duplicates must never be offered as a
    // filing target, or the note lands on a row nobody looks at again.
    const { data } = await supabase
      .from('customers').select('id, name')
      .is('merged_into', null)
      .order('name').limit(1000);
    setCustomers(data || []);
  }, []);

  useEffect(() => { load(); loadCustomers(); }, [load, loadCustomers]);


  // ── One-time import from Shana's calendar ──────────────────────────
  // Quick Notes stored notes as Google Calendar events, which is why they
  // could never be tied to a client, searched properly or archived. Those
  // three things are the entire point of this screen, so that route is done.
  //
  // TWO DELIBERATE LIMITS, both per Sara:
  //   1. Shana's calendar ONLY. Admin Notes and Sales & Acct stay in Google.
  //   2. Today forward ONLY. Past events are history, not live reminders —
  //      dragging years of them in would bury the handful that still matter.
  // Anything already marked [DONE] is skipped, and source_event_id stops a
  // second run from duplicating what a first run already brought over.
  const findImportable = useCallback(async () => {
    if (!accessToken) { setImportable([]); return; }
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const params = new URLSearchParams({
        timeMin: from.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      });
      const res = await fetch(
        `${GCAL}/calendars/${encodeURIComponent(CALENDARS.SHANA)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) { setImportable([]); return; }
      const data = await res.json();

      const { data: already } = await supabase
        .from('notes').select('source_event_id').not('source_event_id', 'is', null);
      const seen = new Set((already || []).map(r => r.source_event_id));

      const rows = (data.items || [])
        .filter(ev => ev.status !== 'cancelled')
        .filter(ev => !/\[DONE\]/i.test(ev.summary || ''))
        .filter(ev => !seen.has(ev.id))
        .map(ev => ({
          id: ev.id,
          title: (ev.summary || '').replace(/\s*\[DONE\]/gi, '').trim() || '(untitled)',
          description: (ev.description || '').trim(),
          when: ev.start?.dateTime || ev.start?.date || null,
        }));
      setImportable(rows);
      setPicked(new Set(rows.map(r => r.id)));
    } catch (e) {
      console.warn('calendar import scan failed', e);
      setImportable([]);
    }
  }, [accessToken]);

  const runImport = async () => {
    const rows = (importable || []).filter(r => picked.has(r.id));
    if (!rows.length) return;
    setImporting(true);
    try {
      const payload = rows.map(r => ({
        body: [r.title, r.description].filter(Boolean).join('\n\n'),
        author_email: 'shanaparks@drhsecurityservices.com',
        status: 'open',
        source_event_id: r.id,
        created_at: r.when ? new Date(r.when).toISOString() : new Date().toISOString(),
      }));
      // Ignore conflicts rather than fail the batch — the unique index on
      // source_event_id means a re-run silently skips what's already here.
      const { error } = await supabase.from('notes').upsert(payload, {
        onConflict: 'source_event_id', ignoreDuplicates: true,
      });
      if (error) throw error;
      setImportable([]);
      await load();
      say(`Imported ${rows.length} ✓`);
    } catch (e) { say('Import failed: ' + (e.message || e)); }
    setImporting(false);
  };

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('notes').insert([{
        body: draft.trim(),
        author_email: userEmail || null,
        customer_id: draftCustomer,
        status: 'open',
      }]);
      if (error) throw error;
      setDraft(''); setDraftCustomer(null);
      await load();
      say('Noted ✓');
    } catch (e) { say('Could not save: ' + (e.message || e)); }
    setSaving(false);
  };

  const archive = async ({ customerId, onRecord }) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('notes').update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        archived_by: userEmail || null,
        customer_id: customerId,
        on_customer_record: onRecord,
      }).eq('id', donePrompt.id);
      if (error) throw error;
      setDonePrompt(null);
      await load();
      say(onRecord ? 'Filed to client record ✓' : 'Archived ✓');
    } catch (e) { say('Could not archive: ' + (e.message || e)); }
    setSaving(false);
  };

  const custName = (id) => customers.find(c => c.id === id)?.name || null;

  const shown = useMemo(() => {
    const rows = notes.filter(n => n.status === tab);
    if (tab === 'open' || !search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter(n =>
      (n.body || '').toLowerCase().includes(s) ||
      (custName(n.customer_id) || '').toLowerCase().includes(s)
    );
  }, [notes, tab, search, customers]);

  const openCount = notes.filter(n => n.status === 'open').length;

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, paddingBottom: 60 }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {onBack && (
            <button onClick={onBack}
              style={{ background: SURFACE, border: 'none', borderRadius: 8, color: TEXT,
                       padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}>←</button>
          )}
          <div style={{ fontSize: 19, fontWeight: 700 }}>📝 Notes</div>
        </div>
        <div style={{ color: MUTED, fontSize: 12 }}>
          Not jobs. These never touch the board.
        </div>
      </div>

      {/* New note */}
      <div style={{ padding: 16 }}>
        <div style={{ background: SURFACE, borderRadius: 12, padding: 12 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="What do you need to remember?"
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${LINE}`,
                     borderRadius: 8, padding: '10px 12px', color: TEXT, fontSize: 14,
                     outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ marginTop: 9 }}>
            <CustomerPicker customers={customers} value={draftCustomer} onChange={setDraftCustomer}
              placeholder="Tie to a client (optional)" />
          </div>
          <button onClick={add} disabled={!draft.trim() || saving}
            style={{ marginTop: 10, width: '100%', background: draft.trim() ? ACCENT : '#1a2537',
                     color: draft.trim() ? '#0f1729' : MUTED, border: 'none', borderRadius: 8,
                     padding: '10px 0', fontSize: 13, fontWeight: 700,
                     cursor: draft.trim() ? 'pointer' : 'default' }}>
            {saving ? '…' : 'Add note'}
          </button>
        </div>
      </div>

      {/* One-time calendar import */}
      <div style={{ padding: '0 16px 12px' }}>
        {importable === null ? (
          <button onClick={findImportable}
            style={{ width: '100%', background: 'transparent', color: MUTED, border: `1px dashed ${LINE}`,
                     borderRadius: 10, padding: '10px 0', fontSize: 12, cursor: 'pointer' }}>
            Check Shana's calendar for notes to bring over
          </button>
        ) : importable.length === 0 ? null : (
          <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
              {importable.length} note{importable.length > 1 ? 's' : ''} on Shana's calendar
            </div>
            <div style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>
              Today forward only. Past calendar notes stay in Google.
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
              {importable.map(r => (
                <label key={r.id}
                  style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 0',
                           borderBottom: `1px solid ${BG}`, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(r.id)}
                    onChange={() => setPicked(prev => {
                      const n = new Set(prev);
                      n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                      return n;
                    })}
                    style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 13, lineHeight: 1.3 }}>
                    {r.title}
                    {r.when && (
                      <span style={{ color: MUTED, fontSize: 10, marginLeft: 6 }}>
                        {new Date(r.when).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={runImport} disabled={importing || picked.size === 0}
                style={{ flex: 1, background: picked.size ? ACCENT : '#1a2537',
                         color: picked.size ? '#0f1729' : MUTED, border: 'none', borderRadius: 8,
                         padding: '9px 0', fontSize: 12, fontWeight: 700,
                         cursor: picked.size ? 'pointer' : 'default' }}>
                {importing ? '…' : `Import ${picked.size}`}
              </button>
              <button onClick={() => setImportable([])}
                style={{ background: 'transparent', color: MUTED, border: `1px solid ${LINE}`,
                         borderRadius: 8, padding: '9px 14px', fontSize: 12, cursor: 'pointer' }}>
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
        {[['open', `Open${openCount ? ` (${openCount})` : ''}`], ['archived', 'Archive']].map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setSearch(''); }}
            style={{ background: tab === k ? ACCENT : SURFACE, color: tab === k ? '#0f1729' : MUTED,
                     border: 'none', borderRadius: 20, padding: '7px 16px', fontSize: 12,
                     fontWeight: 700, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'archived' && (
        <div style={{ padding: '0 16px 12px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search archived notes…"
            style={{ width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${LINE}`,
                     borderRadius: 8, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }}
          />
        </div>
      )}

      {/* List */}
      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 24, textAlign: 'center' }}>
            {tab === 'open' ? 'Nothing open. Nice.' : search ? 'No archived notes match that.' : 'Nothing archived yet.'}
          </div>
        ) : shown.map(n => (
          <div key={n.id}
            style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10,
                     padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{n.body}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {n.customer_id && (
                <span style={{ background: `${ACCENT}22`, color: ACCENT, borderRadius: 20,
                               padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                  {custName(n.customer_id) || 'client'}
                </span>
              )}
              {n.on_customer_record && (
                <span style={{ background: '#22c55e22', color: '#22c55e', borderRadius: 20,
                               padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                  on record
                </span>
              )}
              <span style={{ color: MUTED, fontSize: 10 }}>
                {fmtDate(n.status === 'archived' ? n.archived_at : n.created_at)}
              </span>
              {n.status === 'open' && (
                <button onClick={() => setDonePrompt(n)}
                  style={{ marginLeft: 'auto', background: 'transparent', color: '#22c55e',
                           border: '1px solid #22c55e55', borderRadius: 8, padding: '5px 12px',
                           fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ✓ Done
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {donePrompt && (
        <DonePrompt
          note={donePrompt}
          customers={customers}
          saving={saving}
          onCancel={() => setDonePrompt(null)}
          onArchive={archive}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      background: '#22c55e', color: '#0f1729', padding: '10px 18px', borderRadius: 20,
                      fontSize: 13, fontWeight: 700, zIndex: 2000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
