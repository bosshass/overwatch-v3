// ============================================
// ShortLink — /j/<8 chars> → the job, DIRECTLY
// ============================================
// A raw UUID link runs to 80+ characters and looks like malware in a text
// message; techs don't tap them. This resolves the first 8 hex characters of
// the job's UUID back to the full row.
//
// It matches on a PREFIX, so it verifies there's exactly one hit before
// opening anything. If two jobs ever shared a prefix (they won't at DRH's
// scale, but the code shouldn't assume), it says so rather than guessing.
//
// v2: renders JobDetail DIRECTLY instead of navigate('/board?job=...') and
// hoping BoardView's separate effect catches the query param. That indirection
// was the actual bug — the resolve worked, but the hand-off to the board
// wasn't reliably reopening the card. Rendering the card here removes that
// failure surface entirely: one component, one job, no relay.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
// JobDetail RETIRED here 9.11.1 — this was the last surface still rendering
// it. Every way of opening a ticket (board drawer, My Tasks slide-over, texted
// /j/ link) now renders TicketSheet: one ticket, one look.
import TicketSheet from '../components/TicketSheet.jsx';
import VisualSchedulerModal from '../components/VisualSchedulerModal.jsx';
import { jobsApi, techsApi } from '../services/supabase.js';
import { MergeTool } from './BoardView.jsx';

export default function ShortLink({ accessToken, userEmail, userRole, onUpdate }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [err, setErr] = useState('');
  const [jobId, setJobId] = useState(null);

  useEffect(() => {
    (async () => {
      const c = (code || '').toLowerCase().replace(/[^a-f0-9]/g, '');
      if (c.length < 6) { setErr('That link looks incomplete.'); return; }

      // Postgres won't LIKE a uuid, and PostgREST won't carry an `id::text`
      // cast through a filter — that produced "operator does not exist:
      // uuid ~~ unknown" and killed every /j/ link. Resolve the hex prefix as
      // a uuid RANGE instead; uuid supports >= / <= natively and the PK index
      // serves it. Short codes < 8 chars pad with 0 (low) and f (high).
      const lo = c.padEnd(8, '0');
      const hi = c.padEnd(8, 'f');
      const asUuid = (p, fill) => `${p}-${fill.repeat(4)}-${fill.repeat(4)}-${fill.repeat(4)}-${fill.repeat(12)}`;
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name')
        .gte('id', asUuid(lo, '0'))
        .lte('id', asUuid(hi, 'f'))
        .limit(2);

      if (error) { setErr(error.message); return; }
      if (!data || data.length === 0) { setErr('That job no longer exists.'); return; }
      if (data.length > 1) { setErr('That link is ambiguous — ask the office for a fresh one.'); return; }

      setJobId(data[0].id);
    })();
  }, [code]);

  if (jobId) {
    // Render the real card directly. Closing it goes to the board (with no
    // job param — there's nothing left to hand off, this WAS the destination).
    return (
      <LinkedTicket
        jobId={jobId}
        accessToken={accessToken}
        userEmail={userEmail}
        onUpdate={onUpdate}
        onClose={() => {
          const back = new URLSearchParams(location.search).get('returnTo');
          if (back) { navigate(back, { replace: true }); return; }
          if (window.history.length > 1) { navigate(-1); return; }
          navigate('/board', { replace: true });
        }}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      {err ? (
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{err}</div>
          <button onClick={() => navigate('/')}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
            Go to Overwatch
          </button>
        </div>
      ) : (
        <div style={{ color: '#94a3b8' }}>Opening the job…</div>
      )}
    </div>
  );
}


// Loads the job row and renders THE ticket sheet full-screen. The loader is
// all this route adds — presentation is TicketSheet, identical to the board
// and My Tasks, so a texted link opens the same ticket everyone else sees.
function LinkedTicket({ jobId, accessToken, userEmail, onUpdate, onClose }) {
  const [job, setJob] = useState(null);
  const [techs, setTechs] = useState([]);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
    setJob(data || null);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    techsApi.getAll().then(setTechs).catch(async () => {
      const { data } = await supabase.from('techs').select('*').order('name');
      setTechs(data || []);
    });
  }, []);

  if (!job) return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#94a3b8',
                  display: 'grid', placeItems: 'center', fontSize: 14 }}>Loading ticket…</div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729' }}>
      <TicketSheet
        job={job}
        userEmail={userEmail}
        accessToken={accessToken}
        busy={busy}
        onClose={onClose}
        onAssigned={() => load()}
        onOpenScheduler={() => setScheduling(true)}
        onSchedulePrimary={
          ['ready_to_schedule', 'return_pending', 'scheduled'].includes(job.status)
            ? () => setScheduling(true) : null
        }
        onMove={async (target, note) => {
          setBusy(true);
          try {
            await jobsApi.changeStatus(job.id, target, userEmail || 'unknown', note);
            await load(); onUpdate?.();
          } finally { setBusy(false); }
        }}
        extras={<MergeTool job={job} accessToken={accessToken} userEmail={userEmail}
                  onMerge={() => { load(); onUpdate?.(); }} />}
      />
      {scheduling && (
        <VisualSchedulerModal job={job} techs={techs} accessToken={accessToken} userEmail={userEmail}
          onClose={() => setScheduling(false)}
          onScheduled={() => { setScheduling(false); load(); onUpdate?.(); }} />
      )}
    </div>
  );
}
