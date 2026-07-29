// StuckAlerts — panel for dashboard + blocking gate for JR
import { useState, useEffect, useRef } from 'react';
import { fetchStuckAlerts, shouldShowGate, acknowledgeAlerts } from '../utils/alertEngine.js';

// ── Dashboard Panel ──────────────────────────────────────────────────────────
export function StuckAlertsPanel({ accessToken }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchStuckAlerts(accessToken)
      .then(a => setAlerts(a))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading || alerts.length === 0) return null;

  const shown = expanded ? alerts : alerts.slice(0, 3);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        color: '#f87171', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8
      }}>
        🚨 Stuck / Unactioned ({alerts.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((a, i) => (
          <AlertRow key={i} alert={a} />
        ))}
      </div>
      {alerts.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 8, background: 'none', border: 'none',
            color: '#cbd5e1', fontSize: 12, cursor: 'pointer', padding: 0
          }}
        >
          {expanded ? '▲ Show less' : `▼ Show ${alerts.length - 3} more`}
        </button>
      )}
    </div>
  );
}

function AlertRow({ alert }) {
  const borderColor = alert.type === 'unactioned' ? '#f59e0b'
    : alert.type === 'return' ? '#f87171'
    : '#a78bfa';

  return (
    <div style={{
      background: '#1e293b',
      border: `1px solid ${borderColor}30`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 10, padding: '10px 14px',
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{alert.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
          {alert.label}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {alert.customer}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>
          {alert.detail}
        </div>
      </div>
      <div style={{
        color: alert.hoursOld > alert.threshold * 1.5 ? '#f87171' : '#f59e0b',
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right'
      }}>
        {alert.hoursOld}h old
      </div>
    </div>
  );
}

// ── JR Blocking Gate ─────────────────────────────────────────────────────────
export function StuckAlertGate({ accessToken, userEmail, onDismiss }) {
  const [alerts, setAlerts] = useState(null); // null = loading
  const [dismissed, setDismissed] = useState(false);
  const frameRef = useRef(0);
  const [shake, setShake] = useState(0); // bump to retrigger animation

  useEffect(() => {
    fetchStuckAlerts(accessToken)
      .then(a => setAlerts(a))
      .catch(() => setAlerts([]));
  }, [accessToken]);

  // Retrigger shake every 3 seconds
  useEffect(() => {
    if (dismissed || alerts === null) return;
    const id = setInterval(() => setShake(n => n + 1), 3000);
    return () => clearInterval(id);
  }, [dismissed, alerts]);

  if (dismissed) return null;
  if (alerts === null) return null; // still loading — don't block yet
  if (alerts.length === 0) {
    // No alerts — dismiss immediately
    acknowledgeAlerts(userEmail);
    onDismiss?.();
    return null;
  }

  const handleAck = () => {
    acknowledgeAlerts(userEmail);
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <>
      <style>{`
        @keyframes jrPulse {
          0%   { box-shadow: 0 0 0 0 rgba(248,113,113,0.8); }
          50%  { box-shadow: 0 0 40px 20px rgba(248,113,113,0.3); }
          100% { box-shadow: 0 0 0 0 rgba(248,113,113,0); }
        }
        @keyframes jrShake {
          0%,100% { transform: translateX(0) rotate(0deg); }
          10%     { transform: translateX(-8px) rotate(-2deg); }
          20%     { transform: translateX(8px) rotate(2deg); }
          30%     { transform: translateX(-6px) rotate(-1deg); }
          40%     { transform: translateX(6px) rotate(1deg); }
          50%     { transform: translateX(-4px); }
          60%     { transform: translateX(4px); }
          70%     { transform: translateX(-2px); }
        }
        @keyframes jrFlash {
          0%,49%  { opacity: 1; }
          50%,100% { opacity: 0.3; }
        }
        @keyframes jrBounce {
          0%,100% { transform: translateY(0); }
          30%     { transform: translateY(-12px); }
          50%     { transform: translateY(-6px); }
          70%     { transform: translateY(-10px); }
        }
        @keyframes jrSpin {
          0%   { transform: rotate(0deg) scale(1); }
          25%  { transform: rotate(-15deg) scale(1.2); }
          75%  { transform: rotate(15deg) scale(1.2); }
          100% { transform: rotate(0deg) scale(1); }
        }
        @keyframes jrGlow {
          0%,100% { text-shadow: 0 0 8px #f87171, 0 0 20px #f87171; }
          50%     { text-shadow: 0 0 20px #fbbf24, 0 0 40px #fbbf24, 0 0 60px #fbbf24; }
        }
        .jr-shake { animation: jrShake 0.6s ease-in-out; }
        .jr-flash { animation: jrFlash 0.8s ease-in-out infinite; }
        .jr-bounce { animation: jrBounce 0.8s ease-in-out infinite; }
        .jr-glow  { animation: jrGlow 1.5s ease-in-out infinite; }
        .jr-pulse { animation: jrPulse 1.5s ease-in-out infinite; }
        .jr-spin  { animation: jrSpin 2s ease-in-out infinite; }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #0f0a0a 0%, #1a0505 50%, #0f0a0a 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start',
        padding: '40px 20px 30px', overflow: 'auto',
      }}>
        {/* Flashing header */}
        <div className="jr-flash jr-bounce" style={{ marginBottom: 8 }}>
          <div className="jr-glow" style={{
            fontSize: 64, textAlign: 'center', lineHeight: 1,
            color: '#f87171',
          }}>
            🚨
          </div>
        </div>

        <div className="jr-flash" style={{
          fontSize: 26, fontWeight: 900, color: '#f87171',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          textAlign: 'center', marginBottom: 4,
          textShadow: '0 0 12px #f87171',
        }}>
          ATTENTION REQUIRED
        </div>

        <div style={{
          fontSize: 13, color: '#f59e0b', textAlign: 'center',
          marginBottom: 24, letterSpacing: '0.03em',
        }}>
          {alerts.length} item{alerts.length !== 1 ? 's' : ''} need{alerts.length === 1 ? 's' : ''} action before you continue
        </div>

        {/* Alert cards */}
        <div
          key={shake}
          className="jr-shake"
          style={{
            width: '100%', maxWidth: 420,
            display: 'flex', flexDirection: 'column', gap: 10,
            marginBottom: 28,
          }}
        >
          {alerts.map((a, i) => (
            <GateAlertCard key={i} alert={a} />
          ))}
        </div>

        {/* Ack button */}
        <button
          onClick={handleAck}
          className="jr-pulse"
          style={{
            background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
            color: '#fff', border: 'none', borderRadius: 14,
            padding: '18px 40px', fontSize: 17, fontWeight: 800,
            cursor: 'pointer', letterSpacing: '0.05em',
            textTransform: 'uppercase', width: '100%', maxWidth: 420,
          }}
        >
          I See It — I'm On It
        </button>

        <div style={{ marginTop: 14, color: '#94a3b8', fontSize: 11, textAlign: 'center' }}>
          This will reappear in 6 hours if items remain unresolved.
        </div>
      </div>
    </>
  );
}

function GateAlertCard({ alert }) {
  const borderColor = alert.type === 'unactioned' ? '#f59e0b'
    : alert.type === 'return' ? '#f87171'
    : '#a78bfa';
  const overdue = alert.hoursOld > alert.threshold * 1.5;

  return (
    <div style={{
      background: '#1e0a0a',
      border: `2px solid ${borderColor}60`,
      borderLeft: `5px solid ${borderColor}`,
      borderRadius: 12, padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <span style={{ fontSize: 24, lineHeight: 1 }}>{alert.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: borderColor, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
          {alert.label}
        </div>
        <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {alert.customer}
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12 }}>
          {alert.detail}
        </div>
      </div>
      <div style={{
        color: overdue ? '#f87171' : '#f59e0b',
        fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
        textAlign: 'right',
        textShadow: overdue ? '0 0 8px #f87171' : 'none',
      }}>
        {alert.hoursOld}h
        <br />
        <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 400 }}>old</span>
      </div>
    </div>
  );
}
