import { useState, useEffect, useRef } from 'react';

// Polls /version.json. When the deployed build differs from the one this
// session loaded with, shows an "Install now" banner. Tapping it clears all
// caches, unregisters service workers, and reloads — a clean update.
// Single source of truth: bump "build" in public/version.json per deploy.
export default function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const bootBuild = useRef(null);

  useEffect(() => {
    let stopped = false;

    const fetchBuild = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.build || null;
      } catch {
        return null;
      }
    };

    const check = async () => {
      const latest = await fetchBuild();
      if (stopped || !latest) return;
      if (bootBuild.current == null) {
        bootBuild.current = latest; // first read = the build we're running
        return;
      }
      if (latest !== bootBuild.current) setShow(true);
    };

    check(); // establish baseline immediately
    const interval = setInterval(check, 60000); // re-check every minute
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  const install = async () => {
    setBusy(true);
    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch { /* reload anyway */ }
    location.reload();
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
      background: '#0f1729', borderTop: '1px solid #334155',
      padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.35)',
    }}>
      <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>
        A new version is available.
      </span>
      <button
        onClick={install}
        disabled={busy}
        style={{
          background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
          padding: '10px 18px', fontSize: 14, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Updating…' : 'Install now'}
      </button>
    </div>
  );
}
