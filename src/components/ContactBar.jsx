import { useState } from 'react';
import { telHref, smsHref, canContact, templatesFor, logContact } from '../services/contact';

// ============================================================================
// ContactBar — Call and Text, on a driveway, one-handed.
//
// One component in both places (TicketSheet for the operator, MyWork for the
// tech) so the templates and the logging cannot drift apart. v9's problem was
// always two copies of a thing where one got fixed.
//
// The Text button opens a picker rather than sending immediately: the tech
// chooses which message, sees it, and their own OS sends it. Nothing goes out
// of this app without a human reading it first.
// ============================================================================

export default function ContactBar({
  job, customer, actor, techName, scheduledFor, compact = false, onLogged,
}) {
  const [picking, setPicking] = useState(false);
  const phone = customer?.phone;
  const ok = canContact(phone);

  if (!ok) {
    return <div style={S.none}>No phone on file for this customer</div>;
  }

  const templates = templatesFor({ job, customer, actor, techName, scheduledFor });

  const onCall = () => {
    logContact(job, { kind: 'call', to: phone, actor }).then(() => onLogged?.());
  };

  const onText = t => {
    // Log first, then hand off. If the OS swallows the app on handoff the
    // record already exists; a log written after navigation may never run.
    logContact(job, { kind: 'text', to: phone, body: t.body, label: t.label, actor })
      .then(() => onLogged?.());
    window.location.href = smsHref(phone, t.body);
    setPicking(false);
  };

  return (
    <>
      <div style={S.row}>
        <a href={telHref(phone)} onClick={onCall} style={{ ...S.btn, ...S.call }}>
          {compact ? 'Call' : `Call ${phone}`}
        </a>
        <button style={{ ...S.btn, ...S.text }} onClick={() => setPicking(true)}>
          Text
        </button>
      </div>

      {picking && (
        <div style={S.backdrop} onClick={() => setPicking(false)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={S.sheetHead}>
              <span style={S.sheetTitle}>Text {phone}</span>
              <button style={S.x} onClick={() => setPicking(false)}>✕</button>
            </div>
            <div style={S.note}>
              Sends from your own phone. You can edit it before it goes.
            </div>
            {templates.map(t => (
              <button key={t.key} style={S.tmpl} onClick={() => onText(t)}>
                <div style={S.tmplLabel}>{t.label}</div>
                <div style={S.tmplBody}>{t.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const S = {
  row: { display: 'flex', gap: 8, margin: '10px 0' },
  btn: { flex: 1, textAlign: 'center', padding: '12px 10px', borderRadius: 9,
         fontSize: 14, fontWeight: 700, textDecoration: 'none', border: 0,
         cursor: 'pointer' },
  call: { background: '#166534', color: '#dcfce7' },
  text: { background: '#1d4ed8', color: '#dbeafe' },
  none: { color: '#64748b', fontSize: 12, margin: '10px 0' },

  backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,15,.7)', zIndex: 90,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { background: '#111c2e', borderRadius: '14px 14px 0 0', width: '100%',
           maxWidth: 520, padding: '14px 14px 22px', maxHeight: '82vh',
           overflowY: 'auto', border: '1px solid #1e293b' },
  sheetHead: { display: 'flex', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, flex: 1 },
  x: { background: 'transparent', color: '#64748b', border: 0, fontSize: 18,
       cursor: 'pointer' },
  note: { color: '#64748b', fontSize: 11, marginBottom: 12 },
  tmpl: { display: 'block', width: '100%', textAlign: 'left', background: '#0b1220',
          border: '1px solid #1e293b', borderRadius: 9, padding: '11px 12px',
          marginBottom: 8, cursor: 'pointer' },
  tmplLabel: { color: '#93c5fd', fontSize: 12, fontWeight: 700, marginBottom: 4 },
  tmplBody: { color: '#cbd5e1', fontSize: 12, lineHeight: 1.45 },
};
