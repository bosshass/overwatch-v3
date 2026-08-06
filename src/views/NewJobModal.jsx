import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

// ============================================================================
// NewJobModal — create a job.
//
// Lands in Needs action by default, because a brand new job almost never has
// everything it needs. If priority AND estimated_hours are both filled in at
// creation, it can go straight to Open — the same gate as everywhere else,
// checked here so a card cannot be born already violating it.
//
// Customer is REQUIRED. v9 allowed jobs with a typed customer_name and no
// customer_id, which is where 'homeless' jobs came from — work that existed
// but belonged to nobody and never appeared on a customer record.
// ============================================================================

export default function NewJobModal({ actor, presetCustomer, onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState(presetCustomer || null);
  const [f, setF] = useState({
    issue: '', notes: '',
    priority: '', estimated_hours: '', due_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    supabase.from('customers')
      .select('id, name, address, phone, is_monitored')
      .is('merged_into', null)
      .order('name')
      .limit(500)
      .then(({ data }) => setCustomers(data || []));
  }, []);

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const matches = q.trim().length < 2 ? [] : customers.filter(c => {
    const s = q.toLowerCase();
    return (c.name || '').toLowerCase().includes(s)
        || (c.id || '').toLowerCase().includes(s)
        || (c.cs_number || '').includes(s)
        || (c.address || '').toLowerCase().includes(s);
  }).slice(0, 8);

  // Same gate as lanes.js — a job may only start in Open if it qualifies.
  const qualifiesForOpen = Boolean(f.priority) && f.estimated_hours !== '';

  const create = async () => {
    if (!customer) { setErr('Pick a customer'); return; }
    setBusy(true); setErr(null);

    const { data, error } = await supabase.from('jobs').insert({
      customer_id: customer.id,
      customer_name: customer.name,
      customer_address: customer.address,
      customer_phone: customer.phone,
      status: qualifiesForOpen ? 'ready_to_schedule' : 'new',
      priority: f.priority || null,
      estimated_hours: f.estimated_hours === '' ? null : Number(f.estimated_hours),
      due_date: f.due_date || null,
      issue: f.issue || null,
      notes: f.notes || null,
    }).select().single();

    if (error) { setBusy(false); setErr(error.message); return; }

    await supabase.from('job_history').insert({
      job_id: data.id, kind: 'move', from_status: null,
      to_status: data.status, notes: 'Created', changed_by: actor || null,
    });

    setBusy(false);
    onCreated?.(data);
    onClose?.();
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div style={S.title}>New job</div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        <label style={S.label}>Customer</label>
        {customer ? (
          <div style={S.picked}>
            <div>
              <div style={S.pickedName}>{customer.name}</div>
              <div style={S.pickedSub}>
                {customer.id}{customer.address && ` · ${customer.address}`}
              </div>
            </div>
            {!presetCustomer && (
              <button style={S.change} onClick={() => { setCustomer(null); setQ(''); }}>
                change
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              style={S.input}
              placeholder="Search name, code, CS number, address…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {matches.map(c => (
              <button key={c.id} style={S.result} onClick={() => setCustomer(c)}>
                <span style={S.resName}>{c.name}</span>
                <span style={S.resSub}>{c.id}{c.address && ` · ${c.address}`}</span>
              </button>
            ))}
            {q.trim().length >= 2 && matches.length === 0 && (
              <div style={S.noneFound}>No customer matches that.</div>
            )}
          </>
        )}

        <div style={S.rule} />

        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Priority</label>
            <div style={S.chips}>
              {['low', 'normal', 'high', 'emergency'].map(p => (
                <button key={p} onClick={() => set('priority', p)}
                  style={{ ...S.chip, ...(f.priority === p ? S.chipOn : {}) }}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Estimated hours</label>
            <input type="number" step="0.5" min="0" style={S.input}
                   value={f.estimated_hours}
                   onChange={e => set('estimated_hours', e.target.value)} />
          </div>
          <div style={S.col}>
            <label style={S.label}>Due date</label>
            <input type="date" style={S.input} value={f.due_date}
                   onChange={e => set('due_date', e.target.value)} />
          </div>
        </div>

        <div style={S.rule} />

        <label style={S.label}>What's the issue</label>
        <textarea style={S.area} rows={3} value={f.issue}
                  onChange={e => set('issue', e.target.value)} />

        <div style={S.spacer} />

        <div style={S.footer}>
          <div style={{ ...S.dest, ...(qualifiesForOpen ? S.destOk : {}) }}>
            {qualifiesForOpen
              ? 'Starts in Open — ready to schedule.'
              : 'Starts in Needs action. Add priority and hours to start it in Open.'}
          </div>
          <button style={{ ...S.create, ...(!customer ? S.createOff : {}) }}
                  disabled={!customer || busy} onClick={create}>
            {busy ? 'Creating…' : customer ? 'Create job' : 'Pick a customer first'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  // Sheet, not a floating box. TicketSheet is the surface people open dozens of
  // times a day and it slides from the right at full height; a centered 440px
  // card for the second-most-used surface is a different mental model for the
  // same kind of task. Same shell, same width, same scroll behaviour.
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex',
              justifyContent: 'flex-end', zIndex: 60 },
  modal: { background: '#111c2e', width: 'min(460px, 100%)', height: '100%',
           display: 'flex', flexDirection: 'column',
           padding: '18px 18px 0', overflowY: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingBottom: 4 },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  label: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
           display: 'block', marginTop: 16, marginBottom: 6 },
  input: { width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
           borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  area: { width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e293b',
          borderRadius: 8, padding: '9px 10px', fontSize: 14, fontFamily: 'inherit',
          resize: 'vertical' },
  result: { width: '100%', textAlign: 'left', background: '#0b1220', border: 0,
            borderBottom: '1px solid #1e293b', padding: '9px 10px', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 2 },
  resName: { color: '#e2e8f0', fontSize: 14 },
  resSub: { color: '#64748b', fontSize: 11 },
  noneFound: { color: '#64748b', fontSize: 12, padding: '10px 2px' },
  picked: { background: '#0b1220', border: '1px solid #3b82f6', borderRadius: 8,
            padding: '10px 12px', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', gap: 8 },
  pickedName: { color: '#f1f5f9', fontSize: 14, fontWeight: 600 },
  pickedSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  change: { background: 'transparent', border: 0, color: '#38bdf8', fontSize: 12,
            textDecoration: 'underline', cursor: 'pointer' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { background: '#1e293b', color: '#94a3b8', border: 0, borderRadius: 14,
          padding: '5px 12px', fontSize: 12, cursor: 'pointer' },
  chipOn: { background: '#2563eb', color: '#fff' },
  row: { display: 'flex', gap: 10 },
  col: { flex: 1 },

  // Divider between the three fields that decide the lane and everything else.
  rule: { height: 1, background: '#1e293b', margin: '18px 0 2px' },

  // Eats leftover height so the footer sits at the bottom on a tall screen and
  // is simply pushed down on a short one. No fixed positioning, no overlap.
  spacer: { flex: 1, minHeight: 16 },

  footer: { position: 'sticky', bottom: 0, background: '#111c2e',
            paddingTop: 12, paddingBottom: 16, marginTop: 'auto' },
  dest: { color: '#64748b', fontSize: 12, lineHeight: 1.4, marginBottom: 10,
          paddingLeft: 2 },
  destOk: { color: '#4ade80' },
  create: { width: '100%', background: '#22c55e', color: '#06240f', border: 0,
            borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  createOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
};
