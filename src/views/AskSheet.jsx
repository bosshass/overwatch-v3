import { useState, useEffect } from 'react';
import { askSomeone, answerQuestion } from '../services/jobs';
import { supabase } from '../services/supabaseClient';

// ============================================================================
// AskSheet — put a job in front of a person without booking them a truck.
//
// ASSIGNING IS NOT SCHEDULING. Until now the only way to make a job somebody's
// problem was to schedule them onto it, which meant inventing a calendar event
// for work that has no visit: "is this covered under monitoring?", "find out
// who owns the building", "call them back and confirm the panel model".
//
// Two modes:
//   ask     — send it to someone
//   answer  — you were asked; reply, and optionally hand it on
//
// Handing on creates a NEW question rather than editing the old one, so the
// trail reads as a conversation instead of a field that keeps changing.
// ============================================================================

export default function AskSheet({ job, question, actor, onClose, onDone }) {
  const answering = !!question;

  const [techs, setTechs] = useState([]);
  const [who, setWho]     = useState(null);
  const [body, setBody]   = useState('');
  const [hand, setHand]   = useState(false);
  const [handTo, setHandTo] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  useEffect(() => {
    supabase.from('techs').select('id, name, color, kind')
      .eq('is_active', true).order('display_order')
      .then(({ data }) => setTechs(data || []));
  }, []);

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = answering
      ? await answerQuestion(question.id, body, actor,
          hand ? { handTo, followUp: body } : {})
      : await askSomeone(job.id, who, body, actor);
    setBusy(false);
    if (!res.ok) { setErr(res.reason); return; }
    onDone?.();
    onClose?.();
  };

  const ready = answering
    ? body.trim() && (!hand || handTo)
    : who && body.trim();

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>

        <div style={S.head}>
          <div>
            <div style={S.title}>{answering ? 'Your answer' : 'Ask someone'}</div>
            <div style={S.sub}>
              {job?.customer?.name || job?.customer_name || 'This job'}
            </div>
          </div>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        {answering && (
          <div style={S.asked}>
            <div style={S.askedLabel}>
              {(question.asked_by || 'someone').split('@')[0]} asked
            </div>
            <div style={S.askedBody}>{question.body}</div>
          </div>
        )}

        {!answering && (
          <>
            <label style={S.label}>Who</label>
            <div style={S.people}>
              {techs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setWho(t.id)}
                  style={{ ...S.person, ...(who === t.id ? S.personOn : {}) }}
                >
                  <span style={{ ...S.dot, background: t.color || '#64748b' }} />
                  {t.name}
                </button>
              ))}
            </div>
          </>
        )}

        <label style={S.label}>
          {answering ? 'What did you find out?' : 'What do you need from them?'}
        </label>
        <textarea
          style={S.area} rows={4} maxLength={800}
          placeholder={answering
            ? 'Owner is Sandalwood Property Group, contact is Dana — 970…'
            : 'Is this covered under the monitoring agreement, or do we bill it?'}
          value={body} onChange={e => setBody(e.target.value)}
        />

        {answering && (
          <>
            <button style={S.handToggle} onClick={() => setHand(h => !h)}>
              <span style={{ ...S.check, ...(hand ? S.checkOn : {}) }}>{hand ? '✓' : ''}</span>
              Someone else needs to pick this up
            </button>
            {hand && (
              <div style={S.people}>
                {techs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setHandTo(t.id)}
                    style={{ ...S.person, ...(handTo === t.id ? S.personOn : {}) }}
                  >
                    <span style={{ ...S.dot, background: t.color || '#64748b' }} />
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <button
          style={{ ...S.go, ...(ready && !busy ? {} : S.goOff) }}
          disabled={!ready || busy}
          onClick={submit}
        >
          {busy ? 'Saving…' : answering ? (hand ? 'Answer and hand on' : 'Answer') : 'Send it'}
        </button>

        <div style={S.foot}>
          No calendar event, no hours. It lands in their My work and comes back
          when they have dealt with it.
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,16,.72)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 70 },
  sheet: { background: '#0f1a2b', width: '100%', maxWidth: 520, maxHeight: '92vh',
           overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '0 18px 20px',
           border: '1px solid #1e293b', borderBottom: 0 },

  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '18px 0 12px' },
  title: { color: '#f1f5f9', fontSize: 19, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 12.5, marginTop: 3 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18,
       cursor: 'pointer', padding: 4 },

  err: { background: '#7f1d1d', color: '#fecaca', fontSize: 12.5,
         padding: '8px 12px', borderRadius: 8, marginBottom: 12 },

  asked: { background: '#141f33', border: '1px solid #24344c', borderRadius: 10,
           padding: '12px 14px', marginBottom: 16 },
  askedLabel: { color: '#64748b', fontSize: 11.5 },
  askedBody: { color: '#e2e8f0', fontSize: 14.5, lineHeight: 1.5, marginTop: 6,
               whiteSpace: 'pre-wrap' },

  label: { display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 14, marginBottom: 7 },
  people: { display: 'flex', flexWrap: 'wrap', gap: 7 },
  person: { display: 'flex', alignItems: 'center', gap: 7, background: '#111c2e',
            color: '#cbd5e1', border: '1px solid #1e293b', borderRadius: 8,
            padding: '8px 12px', fontSize: 13.5, cursor: 'pointer' },
  personOn: { background: '#122a2c', borderColor: '#14b8a6', color: '#f1f5f9' },
  dot: { width: 8, height: 8, borderRadius: '50%', flex: 'none' },

  area: { width: '100%', background: '#0f1b2e', color: '#e2e8f0',
          border: '1px solid #1e293b', borderRadius: 9, padding: '11px 12px',
          fontSize: 14.5, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' },

  handToggle: { display: 'flex', alignItems: 'center', gap: 9, background: 'transparent',
                color: '#94a3b8', border: 0, padding: '14px 0 6px', fontSize: 13,
                cursor: 'pointer' },
  check: { width: 18, height: 18, borderRadius: 5, border: '1px solid #334155',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           fontSize: 12, flex: 'none' },
  checkOn: { background: '#14b8a6', borderColor: '#14b8a6', color: '#04201d' },

  go: { width: '100%', background: '#14b8a6', color: '#03201c', border: 0,
        borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 700,
        cursor: 'pointer', marginTop: 18 },
  goOff: { background: '#1e293b', color: '#475569', cursor: 'default' },
  foot: { color: '#475569', fontSize: 11.5, textAlign: 'center', marginTop: 10,
          lineHeight: 1.5 },
};
