// ============================================
// CustomerLookup
// ============================================
// Surfaces in the finish sheet. Three jobs:
//  1. Auto-match the event to a customer row (from description tag or fuzzy name match)
//  2. Let the user search and confirm a match manually
//  3. Let the user create a new customer with just a name (all else optional)
//
// When a customer is LINKED, we:
//  - Write CUSTOMER_ID:<drh_id> into the event description (one line, idempotent)
//  - Optionally set event.location if currently blank
//  - Show the last 5 time_entries for that customer
//
// Parent passes: event, accessToken, value (linked customer or null), onChange

import { useEffect, useMemo, useState } from 'react';
import { customersApi, timeEntriesApi, supabase } from '../services/supabase.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// ── helpers ──────────────────────────────────────────────────
const CUSTOMER_ID_RE = /CUSTOMER_ID:\s*([A-Za-z0-9\-_]+)/;

function extractStoredCustomerId(description) {
  const m = (description || '').match(CUSTOMER_ID_RE);
  return m ? m[1] : null;
}

function cleanEventTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function fmtMinutes(min) {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Write CUSTOMER_ID tag into the event description (idempotent)
async function tagEventWithCustomerId(accessToken, calendarId, eventId, currentDescription, currentLocation, customer) {
  const tag = `CUSTOMER_ID: ${customer.drh_id || customer.id}`;
  let newDesc = currentDescription || '';
  if (CUSTOMER_ID_RE.test(newDesc)) {
    newDesc = newDesc.replace(CUSTOMER_ID_RE, tag);
  } else {
    newDesc = newDesc ? `${tag}\n${newDesc}` : tag;
  }
  const body = { description: newDesc };
  if (!currentLocation && customer.address) body.location = customer.address;
  await fetch(`${GCAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return newDesc;
}

// ── component ────────────────────────────────────────────────
export default function CustomerLookup({ event, accessToken, value, onChange }) {
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState('idle'); // 'idle' | 'searching' | 'creating'
  const [createForm, setCreateForm] = useState({ name: '', phone: '', address: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cleanTitle = useMemo(() => cleanEventTitle(event?.title), [event]);

  // ── 1. Auto-match on mount ─────────────────────────────────
  useEffect(() => {
    if (!event || value) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        // Step A: check event description for stored ID
        const storedId = extractStoredCustomerId(event.description);
        if (storedId) {
          // It could be a drh_id (DRH-0270) or raw UUID. Try by drh_id first.
          let { data: byDrh } = await supabase
            .from('customers').select('*').eq('drh_id', storedId).maybeSingle();
          if (!byDrh) {
            const { data: byId } = await supabase
              .from('customers').select('*').eq('id', storedId).maybeSingle();
            byDrh = byId;
          }
          if (byDrh && !cancelled) {
            onChange(byDrh);
            setLoading(false);
            return;
          }
        }
        // Step B: fuzzy search by event title
        if (cleanTitle && cleanTitle.length >= 2) {
          const matches = await customersApi.search(cleanTitle);
          if (!cancelled) {
            if (matches.length === 1) {
              // single match — auto-confirm
              onChange(matches[0]);
            } else if (matches.length > 1) {
              // multiple — surface to user to pick
              setResults(matches);
              setMode('searching');
              setQuery(cleanTitle);
            } else {
              setMode('idle');
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Lookup failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  // ── 2. Load history when a customer gets linked ─────────────
  useEffect(() => {
    if (!value?.id) { setHistory([]); return; }
    let cancelled = false;
    timeEntriesApi.getForCustomer(value.id, 5)
      .then(rows => { if (!cancelled) setHistory(rows); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [value?.id]);

  // ── 3. Live search ──────────────────────────────────────────
  const runSearch = async (q) => {
    setQuery(q);
    if (!q || q.length < 2) { setResults([]); return; }
    try {
      const matches = await customersApi.search(q);
      setResults(matches);
    } catch (e) { setError(e.message); }
  };

  // ── 4. Confirm/link a customer ──────────────────────────────
  const link = async (customer) => {
    setSaving(true);
    setError('');
    try {
      await tagEventWithCustomerId(
        accessToken,
        event.calendarId,
        event.id,
        event.description,
        event.location,
        customer
      );
      onChange(customer);
      setMode('idle');
      setResults([]);
    } catch (e) {
      setError(e.message || 'Failed to link customer');
    } finally {
      setSaving(false);
    }
  };

  // ── 5. Unlink ───────────────────────────────────────────────
  const unlink = () => {
    onChange(null);
    setMode('idle');
    setResults([]);
  };

  // ── 6. Create new customer (loose) ──────────────────────────
  const submitCreate = async () => {
    if (!createForm.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const created = await customersApi.createLoose(createForm);
      await tagEventWithCustomerId(
        accessToken,
        event.calendarId,
        event.id,
        event.description,
        event.location,
        created
      );
      onChange(created);
      setMode('idle');
      setCreateForm({ name: '', phone: '', address: '', email: '' });
    } catch (e) {
      setError(e.message || 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  // ── render ──────────────────────────────────────────────────
  return (
    <div style={{
      background: value ? '#f0fdf4' : '#fef3c7',
      border: `1px solid ${value ? '#86efac' : '#fcd34d'}`,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
          Customer {value ? <span style={{ color: '#16a34a' }}>✓ linked</span> : <span style={{ color: '#b45309' }}>· required</span>}
        </div>
        {loading && <div style={{ fontSize: 11, color: '#9ca3af' }}>Looking up...</div>}
      </div>

      {/* LINKED STATE */}
      {value && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#14532d' }}>
            {value.name}
            {value.drh_id && <span style={{ marginLeft: 8, fontSize: 11, color: '#16a34a', fontWeight: 600 }}>{value.drh_id}</span>}
          </div>
          <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
            {value.phone && <span>📞 {value.phone}</span>}
            {value.phone && value.address && <span> · </span>}
            {value.address && <span>📍 {value.address}</span>}
          </div>

          {history.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', marginBottom: 4 }}>
                Recent visits
              </div>
              {history.map(h => (
                <div key={h.id} style={{ fontSize: 12, color: '#4b5563', padding: '2px 0' }}>
                  {fmtDate(h.created_at)} · {h.tech_name || 'Tech'} · {fmtMinutes(h.total_minutes)}
                  {h.disposition === 'bill_it' && !h.billed && <span style={{ marginLeft: 6, color: '#d97706', fontSize: 10 }}>unbilled</span>}
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={unlink}
            style={{
              marginTop: 10, padding: '6px 10px', background: 'none',
              border: '1px solid #86efac', borderRadius: 6, color: '#15803d',
              fontSize: 11, cursor: 'pointer',
            }}>
            Change customer
          </button>
        </>
      )}

      {/* NOT LINKED — search mode */}
      {!value && mode !== 'creating' && (
        <>
          <input
            value={query}
            onChange={e => runSearch(e.target.value)}
            placeholder={`Search customers (tried "${cleanTitle}")`}
            autoFocus={mode === 'searching'}
            style={{
              width: '100%', padding: '10px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: 'border-box',
              background: '#fff', color: '#1B2A4A',
            }}
          />
          {results.length > 0 && (
            <div style={{ maxHeight: 160, overflowY: 'auto', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              {results.map(c => (
                <button
                  key={c.id} type="button" onClick={() => link(c)} disabled={saving}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 10px', background: '#fff', border: 'none',
                    borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#1B2A4A' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {c.phone && <span>{c.phone}</span>}
                    {c.phone && c.address && <span> · </span>}
                    {c.address && <span>{c.address.split(',')[0]}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setMode('creating')}
            style={{
              marginTop: 8, padding: '8px 12px', background: '#fff',
              border: '1px dashed #d97706', borderRadius: 8, color: '#b45309',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%',
            }}>
            + Add new customer (not in DB)
          </button>
        </>
      )}

      {/* NOT LINKED — create mode */}
      {!value && mode === 'creating' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            value={createForm.name}
            onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="Name (required)"
            autoFocus
            style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', color: '#1B2A4A' }}
          />
          <input
            value={createForm.phone}
            onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
            placeholder="Phone (optional)"
            style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', color: '#1B2A4A' }}
          />
          <input
            value={createForm.address}
            onChange={e => setCreateForm({ ...createForm, address: e.target.value })}
            placeholder="Address (optional)"
            style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', color: '#1B2A4A' }}
          />
          <input
            value={createForm.email}
            onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
            placeholder="Email (optional)"
            style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', color: '#1B2A4A' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => setMode('idle')} disabled={saving}
              style={{ flex: 1, padding: 10, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={submitCreate} disabled={saving || !createForm.name.trim()}
              style={{
                flex: 2, padding: 10, background: '#d97706', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Saving...' : 'Save & link'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#b91c1c' }}>
          {error}
        </div>
      )}
    </div>
  );
}
