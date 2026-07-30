import { useState, useEffect } from 'react';
import { sendSms, smsDiag, formatPhone, isSendable } from '../services/sms';

// ============================================================================
// SmsCheck.jsx — /sms. Deliberately NOT in the nav.
//
// This screen exists to answer one question fast: is the Twilio connection
// live, and if not, which of the six things is wrong. v9's version of this
// only had a Send button, so a failure looked identical whether the token was
// mistyped, the number was unverified, or the campaign was unregistered.
//
// Reachable by typing /sms. Once texting is wired into the real workflow this
// screen stays as the place to check the pipe without messaging a customer.
// ============================================================================

export default function SmsCheck() {
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('Overwatch v3 test — no action needed.');
  const [dryRun, setDryRun] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const check = async () => {
    setLoading(true);
    try { setDiag(await smsDiag()); }
    catch (e) { setDiag({ ok: false, error: e.message }); }
    setLoading(false);
  };

  useEffect(() => { check(); }, []);

  const send = async () => {
    setSending(true);
    setResult(null);
    try { setResult(await sendSms({ to, body, dryRun })); }
    catch (e) { setResult({ ok: false, error: e.message }); }
    setSending(false);
  };

  const rows = diag?.env
    ? Object.entries(diag.env).map(([name, v]) => {
        let note = 'not set';
        let good = false;
        if (v.set) {
          good = v.looksRight !== false && !v.whitespace;
          note = v.whitespace
            ? 'set — HAS STRAY WHITESPACE, re-paste it'
            : v.looksRight === false
            ? 'set — wrong shape'
            : v.value
            ? v.value
            : v.tail
            ? `set — …${v.tail}`
            : `set — ${v.length} chars`;
        }
        return { name, good, note, required: !name.includes('FROM') && !name.includes('SERVICE') };
      })
    : [];

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <h2 style={S.h2}>SMS connection</h2>
        <button style={S.reload} onClick={check} disabled={loading}>
          {loading ? 'checking…' : 'Re-check'}
        </button>
      </div>

      {loading && <div style={S.dim}>Reading configuration…</div>}

      {!loading && diag && !diag.ok && (
        <div style={S.bad}>{diag.error || 'Diagnostics failed.'}</div>
      )}

      {!loading && diag?.ok && (
        <>
          <div style={S.card}>
            <div style={S.cardTitle}>Environment</div>
            {rows.map(r => (
              <div key={r.name} style={S.row}>
                <span style={S.dot}>{r.good ? '🟢' : r.note === 'not set' && !r.required ? '⚪' : '🔴'}</span>
                <code style={S.key}>{r.name}</code>
                <span style={r.good ? S.ok : S.warn}>{r.note}</span>
              </div>
            ))}
            <div style={S.foot}>
              Sender: {diag.sender || <span style={S.warn}>none configured</span>}
              {'  ·  '}signed in as {diag.caller}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>Twilio</div>
            {diag.twilio?.reachable ? (
              <div style={S.row}>
                <span style={S.dot}>🟢</span>
                <span style={S.ok}>
                  Credentials accepted — {diag.twilio.friendlyName} ({diag.twilio.accountType},
                  {' '}{diag.twilio.accountStatus})
                </span>
              </div>
            ) : (
              <>
                <div style={S.row}>
                  <span style={S.dot}>🔴</span>
                  <span style={S.warn}>
                    {diag.twilio?.message || diag.twilio?.note || 'Not reachable'}
                    {diag.twilio?.code ? ` (code ${diag.twilio.code})` : ''}
                  </span>
                </div>
                {diag.twilio?.hint && <div style={S.hint}>{diag.twilio.hint}</div>}
              </>
            )}
            {diag.twilio?.accountType === 'Trial' && (
              <div style={S.hint}>
                Trial account — it will only text numbers added as Verified Caller IDs, and every
                message carries a trial prefix. Fine for this screen, not for customers.
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>Test send</div>
            <input
              style={S.input}
              placeholder="719 555 0134"
              value={to}
              onChange={ev => setTo(ev.target.value)}
            />
            {to && (
              <div style={isSendable(to) ? S.willDial : S.warn}>
                {isSendable(to) ? `will send to ${formatPhone(to)}` : 'not a valid US number yet'}
              </div>
            )}
            <textarea
              style={S.area}
              rows={3}
              value={body}
              onChange={ev => setBody(ev.target.value)}
            />
            <label style={S.checkLine}>
              <input type="checkbox" checked={dryRun} onChange={ev => setDryRun(ev.target.checked)} />
              Dry run — validate everything, do not actually send
            </label>
            <button
              style={{ ...S.send, ...(dryRun ? {} : S.sendLive) }}
              disabled={sending || !isSendable(to) || !body.trim()}
              onClick={send}
            >
              {sending ? 'sending…' : dryRun ? 'Dry run' : 'Send for real'}
            </button>

            {result && (
              <div style={result.ok ? S.good : S.bad}>
                {result.ok
                  ? result.dryRun
                    ? `Dry run passed — would send to ${result.to} via ${result.sender}.`
                    : `Accepted by Twilio — ${result.status}, sid ${result.sid}. "Accepted" is not "delivered"; check the phone.`
                  : `${result.error}${result.code ? ` (code ${result.code})` : ''}`}
                {result.hint && <div style={S.hint}>{result.hint}</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const S = {
  wrap: { padding: '18px 16px', maxWidth: 640, margin: '0 auto', color: '#e2e8f0' },
  head: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  h2: { fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: 0, flex: 1 },
  reload: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
            padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  dim: { color: '#64748b', fontSize: 13 },
  card: { background: '#111c2e', border: '1px solid #1e293b', borderRadius: 10,
          padding: '14px 16px', marginBottom: 12 },
  cardTitle: { color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
               textTransform: 'uppercase', marginBottom: 10 },
  row: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, marginBottom: 6,
         flexWrap: 'wrap' },
  dot: { fontSize: 11 },
  key: { color: '#cbd5e1', fontSize: 12 },
  ok: { color: '#4ade80', fontSize: 12 },
  warn: { color: '#fca5a5', fontSize: 12 },
  hint: { color: '#fcd34d', fontSize: 12, lineHeight: 1.5, marginTop: 8,
          background: '#1c1608', borderLeft: '3px solid #f59e0b', padding: '8px 10px',
          borderRadius: 4 },
  foot: { color: '#64748b', fontSize: 11, marginTop: 10, borderTop: '1px solid #1e293b',
          paddingTop: 8 },
  input: { width: '100%', background: '#0b1220', color: '#f1f5f9', border: '1px solid #1e293b',
           borderRadius: 6, padding: '9px 10px', fontSize: 14, boxSizing: 'border-box' },
  area: { width: '100%', background: '#0b1220', color: '#f1f5f9', border: '1px solid #1e293b',
          borderRadius: 6, padding: '9px 10px', fontSize: 13, marginTop: 8,
          boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  willDial: { color: '#4ade80', fontSize: 11, marginTop: 5 },
  checkLine: { display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8',
               fontSize: 12, margin: '12px 0' },
  send: { background: '#334155', color: '#e2e8f0', border: 0, borderRadius: 7,
          padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  sendLive: { background: '#dc2626', color: '#fff' },
  good: { color: '#4ade80', fontSize: 12, marginTop: 12, lineHeight: 1.5 },
  bad: { color: '#fca5a5', fontSize: 12, marginTop: 12, lineHeight: 1.5 },
};
