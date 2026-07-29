import { useState, useEffect } from 'react';
import { useAuth } from './services/useAuth';
import CommandCenter from './views/CommandCenter';
import BoardView from './views/BoardView';
import CustomersView from './views/CustomersView';
import MyWork from './views/MyWork';
import NewJobModal from './views/NewJobModal';
import { VERSION } from './version';

// ============================================================================
// App.jsx — auth gate, routing, nav. Deliberately small.
//
// v9's App.jsx was 900+ lines and held routing, auth, version polling, the
// alert gate, user config and role logic all in one file. Auth lives in
// useAuth.js now; this file decides what to render and nothing else.
//
// No People route — that screen is not in v3 (see lanes.js note 9).
// ============================================================================

const ROUTES = [
  { path: '/', label: 'Home' },
  { path: '/board', label: 'Board' },
  { path: '/my-work', label: 'My work' },
  { path: '/customers', label: 'Customers' },
];

export default function App() {
  const { email, isSignedIn, ready, needsReconnect, signIn, signOut } = useAuth();
  const [path, setPath] = useState(window.location.pathname);
  const [newJob, setNewJob] = useState(null);   // null | {} | { customer }
  const [bump, setBump] = useState(0);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = to => {
    const [p, hash] = to.split('#');
    window.history.pushState({}, '', to);
    setPath(p);
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 50);
  };

  if (!ready) return <div className="ow-full" style={S.center}>…</div>;

  if (!isSignedIn) {
    return (
      <div className="ow-full" style={S.center}>
        <div style={S.loginCard}>
          <div style={S.brand}>Overwatch</div>
          <div style={S.v3}>v3</div>
          <p style={S.loginMsg}>Sign in with your work Google account.</p>
          <button style={S.signIn} onClick={signIn}>Sign in with Google</button>
          <div style={S.env}>Test environment — not production data</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ow-full" style={S.shell}>
      <nav style={S.nav}>
        <span style={S.navBrand}>Overwatch <span style={S.navV3}>v3</span></span>
        {ROUTES.map(r => (
          <button
            key={r.path}
            onClick={() => navigate(r.path)}
            style={{ ...S.navLink, ...(path === r.path ? S.navLinkOn : {}) }}
          >
            {r.label}
          </button>
        ))}
        <button style={S.newBtn} onClick={() => setNewJob({})}>+ Job</button>
        <span style={S.spacer} />
        <span style={S.navVer}>{VERSION}</span>
        <button style={S.signOut} onClick={signOut}>Sign out</button>
      </nav>

      {needsReconnect && (
        <div style={S.reconnect}>
          Your session is old. Nothing is lost — reconnect when convenient.
          <button style={S.reconnectBtn} onClick={signIn}>Reconnect</button>
        </div>
      )}

      {path === '/board'
        ? <BoardView key={bump} actor={email} />
        : path === '/my-work'
        ? <MyWork key={bump} actor={email} />
        : path === '/customers'
        ? <CustomersView key={bump} onNewJob={c => setNewJob({ customer: c })} />
        : <CommandCenter key={bump} email={email} onNavigate={navigate} />}

      {newJob && (
        <NewJobModal
          actor={email}
          presetCustomer={newJob.customer}
          onClose={() => setNewJob(null)}
          onCreated={() => { setBump(b => b + 1); navigate('/board'); }}
        />
      )}
    </div>
  );
}

const S = {
  shell: { background: '#0b1220' },
  center: { background: '#0b1220',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' },
  loginCard: { background: '#111c2e', padding: '32px 28px', borderRadius: 14,
               textAlign: 'center', maxWidth: 340 },
  brand: { color: '#f1f5f9', fontSize: 26, fontWeight: 800, letterSpacing: -0.5 },
  v3: { color: '#14b8a6', fontSize: 12, fontWeight: 700, marginTop: 2 },
  loginMsg: { color: '#94a3b8', fontSize: 13, margin: '18px 0' },
  signIn: { background: '#2563eb', color: '#fff', border: 0, borderRadius: 8,
            padding: '10px 18px', fontSize: 14, cursor: 'pointer', width: '100%' },
  env: { color: '#64748b', fontSize: 11, marginTop: 16 },
  nav: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
         background: '#111c2e', borderBottom: '1px solid #1e293b', flexWrap: 'wrap' },
  navBrand: { color: '#f1f5f9', fontWeight: 700, fontSize: 15, marginRight: 10 },
  navV3: { color: '#14b8a6', fontSize: 11, fontWeight: 700 },
  navLink: { background: 'transparent', color: '#94a3b8', border: 0, borderRadius: 6,
             padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  navLinkOn: { background: '#1e293b', color: '#f1f5f9' },
  spacer: { flex: 1 },
  newBtn: { background: '#22c55e', color: '#06240f', border: 0, borderRadius: 6,
            padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  navVer: { color: '#475569', fontSize: 11, marginRight: 10 },
  signOut: { background: 'transparent', color: '#64748b', border: '1px solid #1e293b',
             borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' },
  reconnect: { background: '#78350f', color: '#fde68a', padding: '8px 16px',
               fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 },
  reconnectBtn: { background: '#f59e0b', color: '#1a1200', border: 0, borderRadius: 6,
                  padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};
