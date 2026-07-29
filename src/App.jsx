// ============================================
// Overwatch - Main App (React Router)
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { CALENDARS, TECH_COLORS } from './config/calendars.js';
import TechCalendar from './views/TechCalendar.jsx';
import OpsHome from './views/OpsHome.jsx';
import People from './views/People.jsx';
import OwnerDashboard from './views/OwnerDashboard.jsx';
import CommandCenter from './views/CommandCenter.jsx';
import TechWorkToday from './views/TechWorkToday.jsx';
import ReconcileView from './views/ReconcileView.jsx';
import PreviewChanges from './views/PreviewChanges.jsx';
import BoardView from './views/BoardView.jsx';
import Notes from './views/Notes.jsx';
import Tour, { shouldShowTour, tourKey } from './components/Tour.jsx';
import Scheduler from './views/Scheduler.jsx';
import Projects from './views/Projects.jsx';
import NewJobModal from './components/NewJobModal.jsx';
import JobFinishSheet from './components/JobFinishSheet.jsx';
import HelpBot from './components/HelpBot.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import CustomerHistory from './views/CustomerHistory.jsx';
import CustomerAudit from './views/CustomerAudit.jsx';
import WeeklyRecap from './views/WeeklyRecap.jsx';
import Unbilled from './views/Unbilled.jsx';
import ShortLink from './views/ShortLink.jsx';
import { StuckAlertGate } from './components/StuckAlerts.jsx';
import { shouldShowGate } from './utils/alertEngine.js';
import BuildLog from './components/BuildLog.jsx';
import { jobDeepLink } from './config/appBase.js';

const APP_VERSION = '9.17.2';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';


// True when the URL is carrying a deep link (?cal=&job=, ?job=, ?customerId=).
// The default-view redirect must NEVER clobber one — the pathname of a deep
// link is still '/', which is exactly why it used to.
// The KPI dashboard names who is and isn't actioning work. That's a
// conversation Sara has deliberately — not a screen the team wanders into.
const KPI_EMAILS = ['sara@jnbllc.com', 'admin@jnbservice.com'];
function canSeeKPIs(email) {
  return KPI_EMAILS.includes((email || '').toLowerCase());
}

function hasDeepLink() {
  const p = new URLSearchParams(window.location.search);
  return p.has('cal') || p.has('job') || p.has('customerId');
}

const USER_CONFIG = {
  'drhservicetech1@gmail.com':       { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: 'work' },
  'austin@drhsecurityservices.com':   { name: 'Austin', role: 'tech',     defaultCalendar: 'Austin', defaultView: 'work' },
  // ── JR has two logins ──────────────────────────────────────────────────
  // info@ was a SHARED login that prompted "who are you?" (Sara / JR / Shana).
  // It isn't shared — it's JR's. The identity prompt is gone; it just signs
  // him in as himself. Sara reaches the app on admin@jnbservice.com and
  // sara@jnbllc.com, Shana on shanaparks@, so nobody loses a way in.
  'info@drhsecurityservices.com':     { name: 'JR',     role: 'operator', defaultCalendar: 'JR', defaultView: 'board' },
    // jr@ lands on HOME, not /work — he's the owner, and the tour we show him is
  // about My Tasks and the warning banner, both of which live there. NOTE his
  // role is still 'tech', so Admin Tools and the operator screens stay hidden
  // on this login. That is the unresolved question from earlier: info@ makes
  // him an operator, jr@ makes him a tech, and it's the same person.
  'jr@drhsecurityservices.com':       { name: 'JR',     role: 'tech',     defaultCalendar: 'JR', defaultView: null },
  'brian@drhsecurityservices.com':    { name: 'Brian',  role: 'tech',     defaultCalendar: 'Brian', defaultView: 'work' },
  'sara@jnbllc.com':                  { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: 'board' },
  'shanaparks@drhsecurityservices.com': { name: 'Shana', role: 'operator', defaultCalendar: 'Shana', defaultView: 'board' },
  'admin@jnbservice.com':             { name: 'Sara',   role: 'operator', defaultCalendar: null, defaultView: 'board' },
  'trevor@drhsecurityservices.com':    { name: 'Trevor', role: 'tech',     defaultCalendar: 'Installations', defaultView: 'work' },
  'subs@drhsecurityservices.com':      { name: 'Subs',   role: 'tech',     defaultCalendar: 'Subs', defaultView: 'work' },
  'accounting@drhsecurityservices.com': { name: 'Accounting', role: 'operator', defaultCalendar: null, defaultView: 'board', superAdmin: true },
};

// Identity options for shared logins like info@
const IDENTITY_OPTIONS = [
  { key: 'Sara', label: 'Sara', defaultCalendar: null, defaultView: 'board' },
  { key: 'JR', label: 'JR', defaultCalendar: null, defaultView: 'board' },
  { key: 'Shana', label: 'Shana', defaultCalendar: 'Shana', defaultView: 'board' },
];

const CALENDAR_OPTIONS = [
  { key: null, label: 'All Calendars' },
  { key: 'Austin', label: 'Austin' },
  { key: 'JR', label: 'JR' },
  { key: 'Brian', label: 'Brian' },
  { key: 'Sara', label: 'Sara' },
  { key: 'Shana', label: 'Shana' },
  { key: 'Subs', label: 'Subs' },
  { key: 'Service Queue', label: 'Service Queue' },
  { key: 'Installations', label: 'Installations' },
];

function getUserConfig(email) {
  return USER_CONFIG[email?.toLowerCase()] || { name: email?.split('@')[0] || 'User', role: 'tech', defaultCalendar: null, defaultView: null };
}

// ── VIEW AS (super admin) ───────────────────────────────────────────────
// accounting@ is the super admin: it can render any other user's view without
// having their password. This is a LENS, not a login.
//
// HARD RULE: view-as changes what you SEE. It never changes what gets WRITTEN.
// Every write still carries the real signed-in email, so job_history,
// time_entries.tech_email, and the audit trail stay truthful. If this ever
// starts stamping the impersonated user's address on writes, that is a bug —
// an accounting login silently authoring records as a field tech is exactly
// the thing an audit trail exists to prevent.
//
// sessionStorage, not localStorage: the lens dies with the tab. You cannot
// walk away and leave the app pretending to be someone else.
const VIEW_AS_KEY = 'ow_view_as';

// Everyone a super admin can look through. Derived from USER_CONFIG so adding
// a person to the app adds them here automatically. Deduped BY PERSON — JR has
// two logins (info@ and jr@) and Sara has two; the switcher lists humans, not
// mailboxes. Where a person has both an operator and a tech login, the operator
// one wins, since that's the fuller view.
const VIEW_AS_OPTIONS = Object.entries(USER_CONFIG)
  .filter(([, c]) => c.name)
  .reduce((acc, [email, c]) => {
    const existing = acc.find(o => o.name === c.name);
    if (!existing) acc.push({ email, name: c.name, role: c.role });
    else if (existing.role !== 'operator' && c.role === 'operator') {
      existing.email = email; existing.role = c.role;
    }
    return acc;
  }, [])
  .sort((a, b) => a.name.localeCompare(b.name));

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('tech');
  const [isLoading, setIsLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [defaultCalendar, setDefaultCalendar] = useState(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillLog, setBackfillLog] = useState([]);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // First-run tour. Fires once per person per build for the people whose day
  // actually changed; see components/Tour.jsx.
  const [showTour, setShowTour] = useState(false);
  const [tourTopic, setTourTopic] = useState(null);
  const [viewAs, setViewAs] = useState(() => {
    try { return sessionStorage.getItem(VIEW_AS_KEY) || null; } catch { return null; }
  });
  const [showAlertGate, setShowAlertGate] = useState(false);
  const [showBuildLog, setShowBuildLog] = useState(false);
  // Google session went stale. NOT a sign-out — the app stays put and the
  // user taps once to reconnect.
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [forceReload, setForceReload] = useState(false);
  const [forceReloadSeconds, setForceReloadSeconds] = useState(20);

  // Deep link detection — ?cal=X&job=Y at root
  const urlParams = new URLSearchParams(location.search);
  const deepLinkCal = urlParams.get('cal');
  const deepLinkJob = urlParams.get('job');

  const runBackfill = async () => {
    const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
    const CALS = [
      { id: 'c_5d027121360fc0b02d470d2ad10e0be5924428877a0957110de3f71eaf922f0b@group.calendar.google.com', name: 'Tentatively Scheduled' },
      { id: 'drhservicetech1@gmail.com', name: 'Austin' },
      { id: 'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com', name: 'JR' },
      { id: 'shanaparks@drhsecurityservices.com', name: 'Shana' },
      { id: 'c_c84c0a24e2a7386cb519b21569fbb4b17a19214ce33744a63e06394f8c57339f@group.calendar.google.com', name: 'Installations' },
      { id: 'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com', name: 'Sales & Accounting' },
    ];
    setBackfillRunning(true);
    setBackfillLog([]);
    const addLog = (msg, type='info') => setBackfillLog(prev => [...prev, { msg, type }]);
    const now = new Date();
    const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    let patched = 0, skipped = 0, errors = 0;
    for (const cal of CALS) {
      addLog(`📅 ${cal.name}`, 'cal');
      try {
        const params = new URLSearchParams({ timeMin, timeMax: now.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) { const e = await res.json(); addLog(`  ⚠️ ${res.status}: ${e.error?.message}`, 'err'); errors++; continue; }
        const events = (await res.json()).items || [];
        addLog(`  ${events.length} events found`, 'dim');
        for (const event of events) {
          if (event.status === 'cancelled') continue;
          const desc = event.description || '';
          if (desc.includes('juc-e-v2.vercel.app') && !desc.includes('overwatch.highsidesecurity.com')) { skipped++; continue; }
          const deepLink = jobDeepLink(cal.id, event.id);
          const stripped = desc.replace(/\n*🔗 OPEN IN OVERWATCH:.*$/s, '').replace(/\n*📱 Open in Overwatch:.*$/s, '').trimEnd();
          const newDesc = (stripped ? stripped + '\n\n' : '') + `📱 Open in Overwatch: ${deepLink}`;
          const pr = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(cal.id)}/events/${event.id}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newDesc })
          });
          if (pr.ok) { addLog(`  ✅ ${event.summary || '(no title)'}`, 'ok'); patched++; }
          else { addLog(`  ❌ ${event.summary}`, 'err'); errors++; }
          await new Promise(r => setTimeout(r, 150));
        }
      } catch(e) { addLog(`  ❌ ${e.message}`, 'err'); errors++; }
    }
    addLog(`─────────────────────`, 'dim');
    addLog(`✅ Patched: ${patched}  ⏭ Skipped: ${skipped}  ❌ Errors: ${errors}`, 'info');
    setBackfillRunning(false);
  };

  // ── AUTH: Check stored session ──────────────────────────────────────────
  useEffect(() => {
    const storedVersion = localStorage.getItem('juce_v4_version');
    if (storedVersion && storedVersion !== APP_VERSION) {
      // New build — show the changelog as an overlay, but DO NOT skip the
      // session + identity restore below. Falling through keeps the user signed
      // in and routed correctly underneath (fixes info@ -> JR identity not
      // firing on version bumps).
      setShowBuildLog(true);
    }
    localStorage.setItem('juce_v4_version', APP_VERSION);

    const storedToken = localStorage.getItem('juce_v4_token');
    const storedEmail = localStorage.getItem('juce_v4_email');
    const storedExpiry = localStorage.getItem('juce_v4_expiry');

    if (storedToken && storedEmail && storedExpiry) {
      const expiry = new Date(storedExpiry);
      if (expiry > new Date()) {
        const config = getUserConfig(storedEmail);
        setAccessToken(storedToken);
        setUserEmail(storedEmail);
        setUserRole(config.role);
        setIsSignedIn(true);

        // Check if user needs to pick identity (shared login like info@)
        if (config.needsIdentity) {
          const savedIdentity = localStorage.getItem(`juce_identity_${storedEmail}`);
          if (savedIdentity) {
            const identity = IDENTITY_OPTIONS.find(i => i.key === savedIdentity);
            if (identity) {
              setUserName(identity.key);
              setDefaultCalendar(identity.defaultCalendar);
              if (identity.defaultView && window.location.pathname === '/' && !hasDeepLink()) {
                window.history.replaceState(null, '', `/${identity.defaultView}`);
              }
            } else {
              setShowIdentityPicker(true);
            }
          } else {
            setShowIdentityPicker(true);
          }
        } else {
          setUserName(config.name);

          const savedDefault = localStorage.getItem(`juce_default_cal_${storedEmail}`);
          if (savedDefault !== null) {
            setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
          } else {
            setDefaultCalendar(config.defaultCalendar);
            setShowSetup(true);
          }
          
          // Navigate to user's default view if at root — but NOT if the URL is
          // carrying a deep link. This line was silently eating every deep link.
          if (config.defaultView && window.location.pathname === '/' && !hasDeepLink()) {
            window.history.replaceState(null, '', `/${config.defaultView}`);
          }
        }
      } else {
        clearStorage();
      }
    }
    setIsLoading(false);
  }, []);

  // ── LIVE VERSION POLL ────────────────────────────────────────────────────
  // The check above only ever runs once, on load — someone who has a tab
  // open for hours never gets caught by it, no matter how many versions ship
  // underneath them. This polls the real deployed version every 45s and
  // force-reloads EVERYONE still on an old build, with a full warning first.
  useEffect(() => {
    const checkForNewVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
          setForceReload(true);
        }
      } catch (e) { /* network hiccup, non-fatal, just try again next interval */ }
    };
    const interval = setInterval(checkForNewVersion, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!forceReload) return;
    if (forceReloadSeconds <= 0) { window.location.reload(); return; }
    const t = setTimeout(() => setForceReloadSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [forceReload, forceReloadSeconds]);

  const clearStorage = () => {
    localStorage.removeItem('juce_v4_token');
    localStorage.removeItem('juce_v4_email');
    localStorage.removeItem('juce_v4_expiry');
  };

  // ── AUTH: Google Sign In ────────────────────────────────────────────────
  const handleSignIn = useCallback(() => {
    // Remember where the user was actually trying to go — e.g. a /board?job=...
    // deep link from an assign-to SMS/email — so sign-in can send them there
    // instead of unconditionally dropping them at '/' or their default view.
    const here = window.location.pathname + window.location.search;
    if (here && here !== '/') {
      sessionStorage.setItem('ow_post_login_path', here);
    }
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', window.location.origin);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'select_account');
    window.location.href = authUrl.toString();
  }, []);

  // ── AUTH: Handle OAuth redirect ─────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');

      if (token) {
        // A deep link (e.g. /board?job=...) that required a fresh sign-in —
        // consume it now so it takes priority over the normal defaultView
        // redirect below. Left in place (not removed) only in the rare
        // needsIdentity-without-saved-identity branch, since that case has to
        // pause for an identity pick first and isn't wired to resume the
        // deep link automatically yet.
        const pendingPath = sessionStorage.getItem('ow_post_login_path');

        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            const email = data.email;
            // Session lasts 36 hours — token refresh happens silently
            const expiry = new Date(Date.now() + 36 * 60 * 60 * 1000);
            const config = getUserConfig(email);

            localStorage.setItem('juce_v4_token', token);
            localStorage.setItem('juce_v4_email', email);
            localStorage.setItem('juce_v4_expiry', expiry.toISOString());

            setAccessToken(token);
            setUserEmail(email);
            setUserRole(config.role);
            setIsSignedIn(true);

            // Check if user needs to pick identity (shared login like info@)
            if (config.needsIdentity) {
              const savedIdentity = localStorage.getItem(`juce_identity_${email}`);
              if (savedIdentity) {
                const identity = IDENTITY_OPTIONS.find(i => i.key === savedIdentity);
                if (identity) {
                  setUserName(identity.key);
                  setDefaultCalendar(identity.defaultCalendar);
                  sessionStorage.removeItem('ow_post_login_path');
                  const dest = pendingPath || (identity.defaultView ? `/${identity.defaultView}` : '/');
                  window.history.replaceState(null, '', dest);
                  if (dest !== '/') navigate(dest);
                } else {
                  setShowIdentityPicker(true);
                  window.history.replaceState(null, '', '/');
                }
              } else {
                setShowIdentityPicker(true);
                window.history.replaceState(null, '', '/');
              }
            } else {
              setUserName(config.name);
              
              const savedDefault = localStorage.getItem(`juce_default_cal_${email}`);
              if (savedDefault !== null) {
                setDefaultCalendar(savedDefault === 'null' ? null : savedDefault);
              } else {
                setDefaultCalendar(config.defaultCalendar);
                setShowSetup(true);
              }

              // QuickGuide's own first-login trigger REMOVED 9.11.13 along with
              // the component — it used a separate flag (juce_guide_${email})
              // from Tour's own auto-launch (shouldShowTour, elsewhere in this
              // file), so removing it doesn't touch Tour's first-login firing.

              // Deep link takes priority over the normal default-view redirect.
              sessionStorage.removeItem('ow_post_login_path');
              const dest = pendingPath || (config.defaultView ? `/${config.defaultView}` : '/');
              window.history.replaceState(null, '', dest);
              if (dest !== '/') navigate(dest);
            }
          })
          .catch(err => console.error('Auth error:', err));
      }
    }
  }, []);

  const handleSignOut = useCallback(() => {
    clearStorage();
    setAccessToken(null);
    setUserEmail('');
    setUserName('');
    setIsSignedIn(false);
    navigate('/');
  }, [navigate]);

  const handleBuildLogDismiss = useCallback(() => {
    // Just acknowledge the changelog. Keep the session and identity intact so
    // the user (especially info@ -> JR) stays signed in and on their routed
    // screen instead of being bounced to a re-login as anonymous info@.
    localStorage.setItem('juce_v4_version', APP_VERSION);
    setShowBuildLog(false);
  }, []);

  // ── AUTH: Silent token refresh ────────────────────────────────────────
  // WHAT WAS HERE, AND WHY IT COULD NEVER WORK
  //   The old version opened a HIDDEN IFRAME pointed at
  //   accounts.google.com/o/oauth2/v2/auth with prompt=none. Google serves
  //   X-Frame-Options: DENY on that endpoint and has for years, so the iframe
  //   could not load, the 8s timeout always fired, and silentRefresh() always
  //   resolved false. The 401 handler then called handleSignOut().
  //
  //   Net effect: the moment the Google token died, whoever was using the app
  //   got thrown to the login screen mid-task. Every time. That is the "closes
  //   on its own and makes me log in again" everyone reported.
  //
  //   Google Identity Services does this properly, without an iframe.
  const tokenClientRef = useRef(null);
  const getTokenClient = useCallback(() => {
    if (tokenClientRef.current) return tokenClientRef.current;
    const g = window.google?.accounts?.oauth2;
    if (!g) return null;
    tokenClientRef.current = g.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      prompt: '',              // silent when Google still trusts the session
      callback: () => {},      // replaced per-call below
    });
    return tokenClientRef.current;
  }, []);

  const silentRefresh = useCallback(() => {
    return new Promise((resolve) => {
      const client = getTokenClient();
      if (!client) return resolve(false);
      const done = (ok) => { clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => done(false), 10000);
      client.callback = (resp) => {
        if (resp?.access_token) {
          // Store the REAL lifetime Google gives us, not a made-up 36 hours.
          const lifeMs = (Number(resp.expires_in) || 3600) * 1000;
          localStorage.setItem('juce_v4_token', resp.access_token);
          localStorage.setItem('juce_v4_token_expiry', new Date(Date.now() + lifeMs).toISOString());
          setAccessToken(resp.access_token);
          done(true);
        } else done(false);
      };
      try { client.requestAccessToken({ prompt: '', login_hint: userEmail }); }
      catch { done(false); }
    });
  }, [getTokenClient, userEmail]);

  // ── AUTH: refresh BEFORE it breaks ────────────────────────────────────
  // Waiting for a 401 means the user always eats one failed action. Renew at
  // 80% of the token's real life instead, so nothing they do ever hits a dead
  // token in the first place.
  useEffect(() => {
    if (!isSignedIn) return;
    const tick = async () => {
      const exp = localStorage.getItem('juce_v4_token_expiry');
      if (!exp) return;
      const msLeft = new Date(exp).getTime() - Date.now();
      const life = 3600 * 1000;
      if (msLeft < life * 0.2) await silentRefresh();
    };
    tick();
    const iv = setInterval(tick, 4 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isSignedIn, silentRefresh]);

  // ── ALERT GATE: show for JR every 6 hours ──────────────────────────────
  useEffect(() => {
    if (!isSignedIn || !userEmail) return;
    if (userEmail.toLowerCase() === 'jr@drhsecurityservices.com') {
      if (shouldShowGate(userEmail)) {
        setShowAlertGate(true);
      }
    }
  }, [isSignedIn, userEmail]);

  // ── AUTH: Session expiry check (36hr) ───────────────────────────────────
  useEffect(() => {
    if (!isSignedIn) return;
    const check = () => {
      const expiry = localStorage.getItem('juce_v4_expiry');
      if (!expiry || new Date(expiry) <= new Date()) {
        // Was a hard handleSignOut(). Prompt instead — losing an operator's
        // in-progress work to a background timer is never the right trade.
        setNeedsReconnect(true);
      }
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, [isSignedIn, handleSignOut]);

  // ── AUTH: 401 interceptor — try silent refresh before signing out ──────
  useEffect(() => {
    if (!isSignedIn) return;
    let refreshing = false;
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      if (res.status === 401 && !refreshing) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('googleapis.com')) {
          refreshing = true;
          const ok = await silentRefresh();
          refreshing = false;
          if (ok) {
            // Retry the failed request with new token
            const newToken = localStorage.getItem('juce_v4_token');
            const [input, init = {}] = args;
            const newInit = { ...init, headers: { ...init.headers, Authorization: `Bearer ${newToken}` } };
            return origFetch(input, newInit);
          } else {
            // WAS handleSignOut(). Blowing the session away on one failed
            // refresh is what threw people to the login screen mid-task and
            // lost whatever they were typing. Surface a banner instead: the
            // app stays exactly where it is and reconnecting is one tap.
            setNeedsReconnect(true);
          }
        }
      }
      return res;
    };
    return () => { window.fetch = origFetch; };
  }, [isSignedIn, silentRefresh, handleSignOut]);

  // ── ROLE CHECKS ─────────────────────────────────────────────────────────
  const RESTRICTED_EMAILS = ['drhservicetech1@gmail.com', 'austin@drhsecurityservices.com', 'brian@drhsecurityservices.com', 'trevor@drhsecurityservices.com', 'subs@drhsecurityservices.com'];
  const isRestricted = RESTRICTED_EMAILS.includes(userEmail?.toLowerCase());
  useEffect(() => {
    if (userEmail && shouldShowTour(userEmail)) setShowTour(true);
  }, [userEmail]);

  const isOperator = getUserConfig(userEmail).role === 'operator';

  // Super admin + the lens they're currently looking through.
  const isSuperAdmin = getUserConfig(userEmail).superAdmin === true;
  const viewAsConfig = viewAs ? getUserConfig(viewAs) : null;
  // effectiveName drives which VIEW renders. userEmail (unchanged) drives every write.
  const effectiveName = viewAsConfig?.name || userName;

  const applyViewAs = (email) => {
    if (email) sessionStorage.setItem(VIEW_AS_KEY, email);
    else sessionStorage.removeItem(VIEW_AS_KEY);
    setViewAs(email || null);
    // Land on the viewed user's home so the switch is immediately visible
    // instead of leaving them on a screen that person would never open.
    const dest = email ? (getUserConfig(email).defaultView || '') : '';
    navigate(`/${dest}`);
  };

  // ── LOADING ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1729' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/overwatch-logo.png" alt="Overwatch" style={{ width: 84, height: 84, marginBottom: 16, borderRadius: 16 }} />
          <div style={{ color: '#00c8e8', fontSize: '14px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // ── FORCE RELOAD (new version detected while this tab was already open) ──
  // Highest priority in the whole app -- overrides everything, including the
  // changelog screen below, because staying on stale code is the actual risk
  // here (this is exactly what "code drift between deployed and live" looks
  // like from the user's side).
  if (forceReload) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: '#7f1d1d',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px', textAlign: 'center', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 'clamp(48px, 15vw, 72px)', marginBottom: 12 }}>🚨</div>
        <div style={{ fontSize: 'clamp(26px, 8vw, 40px)', fontWeight: 900, color: '#fff', marginBottom: 14, lineHeight: 1.15 }}>
          NEW VERSION AVAILABLE
        </div>
        <div style={{ fontSize: 'clamp(14px, 4.2vw, 18px)', color: '#fecaca', marginBottom: 28, maxWidth: 480 }}>
          Overwatch has updated. This tab is running an old version and needs to reload
          to stay in sync with everyone else.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#fff', color: '#7f1d1d', border: 'none', borderRadius: 14,
            padding: 'clamp(14px, 4vw, 18px) clamp(24px, 8vw, 40px)', fontSize: 'clamp(17px, 5vw, 22px)', fontWeight: 800, cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)', marginBottom: 20, width: '100%', maxWidth: 340,
          }}>
          🔄 Reload Now
        </button>
        <div style={{ fontSize: 'clamp(13px, 3.5vw, 15px)', color: '#fecaca' }}>
          Reloading automatically in <span style={{ fontWeight: 800, fontSize: 'clamp(16px, 4.5vw, 20px)', color: '#fff' }}>{forceReloadSeconds}</span>s…
        </div>
      </div>
    );
  }

  // ── BUILD LOG ───────────────────────────────────────────────────────────
  // Skip this gate for /j/ deep links. The gate forces a full "new build,
  // sign in again" ceremony BEFORE any routing happens at all — meaning
  // every deep link tap since the last visit hit this instead of the card,
  // any time APP_VERSION had changed (which, during an active patch cycle,
  // is most of the time). A text-message link's whole purpose is instant,
  // single-card access; the normal board/login flow still gets the gate.
  const isDeepLink = window.location.pathname.startsWith('/j/');
  if (showBuildLog && !isDeepLink) {
    return <BuildLog version={APP_VERSION} onDismiss={handleBuildLogDismiss} />;
  }

  // ── LOGIN ───────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    const teal = '#2bb3b3';
    const Reticle = ({ size, style }) => (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', opacity: 0.28, pointerEvents: 'none', ...style }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke={teal} strokeWidth="0.7" strokeDasharray="1 3.2" />
        <circle cx="50" cy="50" r="35" fill="none" stroke={teal} strokeWidth="0.6" />
        <circle cx="50" cy="50" r="31" fill="none" stroke={teal} strokeWidth="0.5" strokeDasharray="2 5" />
      </svg>
    );

    return (
      <div style={{
        minHeight: '100vh', minHeight: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'radial-gradient(120% 80% at 50% 0%, #0d1422 0%, #070a11 60%, #05070c 100%)',
        padding: 'calc(56px + env(safe-area-inset-top)) 28px calc(28px + env(safe-area-inset-bottom))',
        position: 'relative', overflow: 'hidden', textAlign: 'center',
      }}>
        {/* ambient reticles */}
        <Reticle size={210} style={{ top: 70, right: -60 }} />
        <Reticle size={150} style={{ top: 230, right: 30 }} />
        <Reticle size={190} style={{ bottom: 120, left: -70 }} />
        <Reticle size={120} style={{ bottom: 30, left: 30 }} />

        {/* logo */}
        <img src="/overwatch-logo.png" alt="Overwatch" style={{
          width: 190, height: 'auto', marginBottom: 26, zIndex: 1,
          filter: 'drop-shadow(0 14px 34px rgba(0,0,0,0.5))',
        }} />

        {/* wordmark */}
        <h1 style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 46, fontWeight: 800, color: '#fff', letterSpacing: 4,
          margin: 0, lineHeight: 1, zIndex: 1,
        }}>OVERWATCH</h1>
        <div style={{ width: 132, height: 3, background: teal, borderRadius: 2, margin: '18px 0 16px', zIndex: 1 }} />
        <p style={{ fontSize: 15, color: '#8b97a6', letterSpacing: 3, fontWeight: 600, margin: 0, zIndex: 1 }}>
          DRH SECURITY COMMAND CENTER
        </p>

        {/* shield */}
        <svg width="58" height="58" viewBox="0 0 24 24" fill="none" style={{ margin: '48px 0 26px', zIndex: 1 }}>
          <path d="M12 2.5l7 2.6v5.4c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V5.1l7-2.6z" stroke={teal} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8.8 12.2l2.2 2.2 4-4.4" stroke={teal} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 14px', zIndex: 1 }}>
          Smart Security. Real Clarity.
        </h2>
        <p style={{ fontSize: 16, color: '#aeb8c4', margin: 0, lineHeight: 1.55, maxWidth: 360, zIndex: 1 }}>
          Always sign in with Google.<br />
          One clean login for field, office, and owner visibility.
        </p>

        {/* push button toward the bottom */}
        <div style={{ flex: 1, minHeight: 28 }} />

        <button onClick={handleSignIn} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: '17px 24px', fontSize: 17, fontWeight: 700,
          background: '#fff', color: '#1B2A4A', border: 'none', borderRadius: 14,
          cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          width: '100%', maxWidth: 380, minHeight: 58, zIndex: 1,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <p style={{ marginTop: 22, color: '#6b7787', fontSize: 13, lineHeight: 1.5, zIndex: 1 }}>
          By continuing, you agree to the<br />
          <span style={{ color: teal }}>Terms of Service</span> and <span style={{ color: teal }}>Privacy Policy</span>.
        </p>
      </div>
    );
  }

  // ── DEEP LINK: ?cal=X&job=Y → JobFinishSheet ─────────────────────────
  if (deepLinkCal && deepLinkJob) {
    return (
      <DeepLinkFinish
        calendarId={deepLinkCal}
        eventId={deepLinkJob}
        accessToken={accessToken}
        userEmail={userEmail}
        userName={getUserConfig(userEmail).name}
        onDone={() => navigate('/')}
      />
    );
  }

  // ── VIEW SHELL (shared nav bar for full-screen views) ───────────────────
  const ViewShell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 100, background: '#0f1729'
      }}>
        <button onClick={() => navigate('/')} style={{
          background: '#1e293b', border: 'none', borderRadius: 8,
          color: '#e2e8f0', fontSize: 14, fontWeight: 700,
          padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
        }}>← Home</button>
        <img src="/overwatch-logo.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
        <span style={{ fontWeight: 700, color: '#00c8e8', fontSize: 14 }}>Overwatch</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>V{APP_VERSION}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {isSuperAdmin && (
            <select
              value={viewAs || ''}
              onChange={e => applyViewAs(e.target.value || null)}
              style={{ background: viewAs ? '#f59e0b' : '#1e293b', color: viewAs ? '#0f1729' : '#e2e8f0',
                       border: '1px solid #334155', borderRadius: 6, padding: '5px 8px',
                       fontSize: 11, fontWeight: viewAs ? 700 : 400, cursor: 'pointer' }}>
              <option value="">View as: me</option>
              {VIEW_AS_OPTIONS.map(o => (
                <option key={o.email} value={o.email}>{o.name} ({o.role})</option>
              ))}
            </select>
          )}
          <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>{userName}</span>

          {/* 🔗 BACKFILL REMOVED from the header 9.9.44. It kicked off a bulk
              data operation and sat one tap from every screen, next to the help
              button, labelled with nothing but a chain emoji. Nobody should be
              able to trigger a mass rewrite by mis-tapping. It is still
              reachable — see Admin Tools — just not by accident. */}

          {/* RETIRED QuickGuide 9.11.13 — 450 lines describing a PIN-entry
              screen, an "Office" tab, and a "Stats" tab that don't exist in
              this app anymore. It was a genuinely different, much older
              onboarding flow that nobody had touched while everything else
              moved on, so the "?" was teaching people to look for buttons
              that were never there. Points at Tour now — the walkthrough
              that's actually been kept in sync with the app tonight. */}
          <button onClick={() => setShowTour(true)} title="How this works"
            style={{ background: '#00c8e815', border: '1px solid #00c8e8', borderRadius: 10,
                     color: '#00c8e8', width: 38, height: 38, fontSize: 20, fontWeight: 800,
                     cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}
          >?</button>
          <button onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >Out</button>
        </div>
      </div>
      {viewAs && (
        <div style={{ background: '#f59e0b', color: '#0f1729', padding: '7px 16px', fontSize: 12,
                      fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>
            Viewing as {viewAsConfig?.name} — you are still signed in as {userEmail}. Anything you save is recorded under your own name.
          </span>
          <button onClick={() => applyViewAs(null)}
            style={{ background: '#0f1729', color: '#f59e0b', border: 'none', borderRadius: 6,
                     padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Back to me
          </button>
        </div>
      )}
      <div style={{ paddingBottom: 70 }}>
        {children}
      </div>
    </div>
  );

  // ── ROUTE GUARDS ────────────────────────────────────────────────────────
  const OperatorOnly = ({ children }) => isOperator ? children : <Navigate to="/" replace />;

  // ── ROUTES ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Session went stale. This REPLACES the old behaviour of calling
          handleSignOut() out from under whoever was mid-task. The app stays
          exactly where it is; reconnecting is one tap and puts you back. */}
      {needsReconnect && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 4000,
                      background: '#78350f', borderBottom: '1px solid #f59e0b',
                      padding: '10px 14px', display: 'flex', alignItems: 'center',
                      gap: 12, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <span style={{ color: '#fcd34d', fontSize: 13, fontWeight: 700, flex: 1 }}>
            Google session expired — your work is still here.
          </span>
          <button onClick={async () => {
                    const ok = await silentRefresh();
                    if (ok) setNeedsReconnect(false);
                    else handleSignIn();   // full flow, returns to this page
                  }}
            style={{ background: '#f59e0b', border: 'none', borderRadius: 8,
                     color: '#08121f', fontWeight: 800, fontSize: 13,
                     padding: '8px 16px', cursor: 'pointer', flexShrink: 0 }}>
            Reconnect
          </button>
        </div>
      )}
      {/* Tour sits ABOVE Routes on purpose. Rendering it inside ViewShell meant
          it never fired on the home screen, which is exactly where a first-time
          user lands. */}
      {showTour && (
        <Tour email={userEmail} startKey={tourTopic} onClose={() => { setShowTour(false); setTourTopic(null); }} onNavigate={navigate} />
      )}
      <Routes>
        <Route path="/" element={
          <OpsHome userName={userName} isOperator={isOperator} isRestricted={isRestricted} accessToken={accessToken} userEmail={userEmail} onNavigate={navigate} onSignOut={handleSignOut} onBackfill={() => { setShowBackfill(true); setBackfillLog([]); }} onSearch={() => setShowSearch(true)} onShowTour={(topic) => { setTourTopic(topic || null); setShowTour(true); }} />
        } />

        <Route path="/calendar" element={<ViewShell><TechCalendar accessToken={accessToken} userEmail={userEmail} defaultCalendar={defaultCalendar} isRestricted={isRestricted} isOperator={isOperator} userName={getUserConfig(userEmail).name} /></ViewShell>} />

        <Route path="/work" element={
          <TechWorkToday 
            accessToken={accessToken} 
            userEmail={userEmail} 
            userName={getUserConfig(userEmail).name} 
            onBack={() => navigate('/')} 
            showAllTechs={!isRestricted}
          />
        } />
        {/* Triage Queue REMOVED 9.9.30. Nothing linked to it, its scheduling
            path was one of the duplicate schedulers, and the board's Triage
            column already does this job. */}
        {/* /billing REMOVED 9.9.31. It counted job_assignments — dispatch
            records, i.e. who was SUPPOSED to show up — instead of time_entries,
            the hours actually logged. That is why it said 18 when 2 was true.
            /unbilled is the real billing screen. */}

        <Route path="/newjob" element={
          <div style={{ minHeight: '100vh', background: '#0f1729' }}>
            <NewJobModal accessToken={accessToken} userEmail={userEmail} onClose={() => navigate('/')} onCreated={() => navigate('/')} />
          </div>
        } />

        <Route path="/lifeline" element={
          <ViewShell>
            <div style={{ padding: 24, textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔴</div>
              <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Lifeline</div>
              <div style={{ color: '#cbd5e1', fontSize: 14 }}>Coming soon.</div>
            </div>
          </ViewShell>
        } />

        {/* Operator-only */}
        <Route path="/command" element={<OperatorOnly><ViewShell><CommandCenter accessToken={accessToken} userEmail={userEmail} /></ViewShell></OperatorOnly>} />
        {/* People — one screen for who owns what. /workspace and /office both
            land here: My Tasks was always just People filtered to you, and
            OfficeHub was the same idea reading a table nobody filled in. */}
        <Route path="/people" element={<ViewShell><People userEmail={userEmail} userName={effectiveName} accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/people/:who" element={<ViewShell><People userEmail={userEmail} userName={effectiveName} accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/office" element={<Navigate to="/people" replace />} />
        <Route path="/dashboard" element={<OperatorOnly><ViewShell><OwnerDashboard accessToken={accessToken} userEmail={userEmail} userRole="operator" /></ViewShell></OperatorOnly>} />
        <Route path="/board" element={<ViewShell><BoardView accessToken={accessToken} userEmail={userEmail} userName={userName} onBack={() => navigate('/')} /></ViewShell>} />
        {/* Role-based workspaces. /workspace resolves to whoever is signed in
            — or, for a super admin using View as, to whoever they're viewing.
            userEmail stays the REAL signed-in address so writes are truthful. */}
        <Route path="/workspace" element={<Navigate to="/people" replace />} />
        <Route path="/workspace/:who" element={<Navigate to="/people" replace />} />
        {/* Notes are NOT jobs and deliberately have no board presence. */}
        <Route path="/notes" element={<ViewShell><Notes userEmail={userEmail} accessToken={accessToken} onBack={() => navigate('/people')} /></ViewShell>} />
        <Route path="/scheduler" element={<ViewShell><Scheduler accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell>} />
        <Route path="/projects" element={<OperatorOnly><ViewShell><Projects accessToken={accessToken} onBack={() => navigate('/')} /></ViewShell></OperatorOnly>} />
        <Route path="/customers" element={<ViewShell><CustomerHistory onBack={() => navigate(urlParams.get('returnTo') || '/')} accessToken={accessToken} userEmail={userEmail} initialCustomerId={urlParams.get('customerId')} /></ViewShell>} />
        <Route path="/audit" element={<OperatorOnly><ViewShell><CustomerAudit onBack={() => navigate('/')} accessToken={accessToken} /></ViewShell></OperatorOnly>} />
        <Route path="/recap" element={<OperatorOnly><WeeklyRecap onBack={() => navigate('/')} userEmail={userEmail} /></OperatorOnly>} />
        <Route path="/j/:code" element={<ShortLink accessToken={accessToken} userEmail={userEmail} userRole={getUserConfig(userEmail).role} onUpdate={() => {}} />} />
        <Route path="/unbilled" element={<OperatorOnly><ViewShell><Unbilled onBack={() => navigate('/')} userEmail={userEmail} /></ViewShell></OperatorOnly>} />

        {/* Admin */}
        {/* /admin/gap REMOVED 9.10.2. Nothing linked to it, and its link tool
            fabricated FAKE calendar_event_ids (manual-<timestamp>) and set
            status='scheduled' by hand — inventing exactly the ghost bookings
            the rest of this build exists to kill. */}
        <Route path="/admin/reconcile" element={<OperatorOnly><ReconcileView accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/')} onOpenFinish={(calId, jobId) => navigate(`/?cal=${encodeURIComponent(calId)}&job=${encodeURIComponent(jobId)}`)} onOpenPreview={() => navigate('/admin/preview')} /></OperatorOnly>} />
        <Route path="/admin/preview" element={<OperatorOnly><PreviewChanges accessToken={accessToken} userEmail={userEmail} onBack={() => navigate('/admin/reconcile')} /></OperatorOnly>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global bottom nav — present on every screen, not just Home.
          Active tab reflects the REAL current path now, not a hardcoded guess. */}
      {isSignedIn && (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'rgba(7,17,31,0.97)', borderTop:'1px solid #1d2f48', display:'flex', zIndex:150, backdropFilter:'blur(14px)', paddingBottom:'env(safe-area-inset-bottom)' }}>
          {[
            { icon:'⌂', label:'Home',  path:'/' },
            { icon:'✓', label:'Today', path:'/work' },
            { icon:'▤', label:'Board', path:'/board' },
            { icon:'👤', label:'People',  path:'/people' },
            { icon:'📅', label:'Cal',  path:'/calendar' },
          ].map(t => {
            const active = t.path === '/' ? location.pathname === '/' : location.pathname.startsWith(t.path);
            return (
              <button key={t.path} onClick={() => navigate(t.path)}
                style={{ flex:1, padding:'10px 0 6px', background:'none', border:'none', color: active ? '#00c8e8' : '#8ea0b8', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                <span style={{ fontSize:20 }}>{t.icon}</span>
                <span style={{ fontSize:10, fontWeight:700 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Global Search */}
      {showSearch && (
        <GlobalSearch onClose={() => setShowSearch(false)} onNavigate={navigate} />
      )}

      {/* JR Alert Gate */}
      {showAlertGate && (
        <StuckAlertGate
          accessToken={accessToken}
          userEmail={userEmail}
          onDismiss={() => setShowAlertGate(false)}
        />
      )}

      {/* Modals (render on top of any route) */}
      {showIdentityPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>👋</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', textAlign: 'center', margin: '0 0 4px 0' }}>Who are you?</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 20px 0' }}>Select your identity for this session</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {IDENTITY_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => {
                    localStorage.setItem(`juce_identity_${userEmail}`, opt.key);
                    setUserName(opt.key);
                    setDefaultCalendar(opt.defaultCalendar);
                    setShowIdentityPicker(false);
                    // A deep link (e.g. /board?job=...) that triggered a fresh
                    // sign-in gets parked here until an identity is picked —
                    // this is the shared-login (info@) path JR actually uses,
                    // so resuming it here is what makes his text-message
                    // ticket links actually land on the right card.
                    const pendingPath = sessionStorage.getItem('ow_post_login_path');
                    sessionStorage.removeItem('ow_post_login_path');
                    const dest = pendingPath || (opt.defaultView ? `/${opt.defaultView}` : null);
                    if (dest) {
                      window.history.replaceState(null, '', dest);
                      navigate(dest);
                    }
                  }}
                  style={{
                    background: '#0f1729',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: '12px',
                    padding: '16px 20px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSetup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%' }}>
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🛡️</div>
            <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', textAlign: 'center', margin: '0 0 4px 0' }}>Welcome, {userName}!</h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: '0 0 20px 0' }}>Pick your default calendar view for this device.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {CALENDAR_OPTIONS.map(opt => (
                <button key={opt.key || 'all'} onClick={() => setDefaultCalendar(opt.key)} style={{
                  background: defaultCalendar === opt.key ? '#00c8e820' : '#0f1729',
                  color: defaultCalendar === opt.key ? '#00c8e8' : '#94a3b8',
                  border: `1px solid ${defaultCalendar === opt.key ? '#00c8e8' : '#334155'}`,
                  borderRadius: '10px', padding: '12px 16px', fontSize: '14px',
                  fontWeight: defaultCalendar === opt.key ? '700' : '500', cursor: 'pointer', textAlign: 'left'
                }}>
                  {opt.key === null ? '📅 ' : ''}{opt.label}
                  {opt.key === defaultCalendar && defaultCalendar !== null && ' ✓'}
                  {opt.key === null && defaultCalendar === null && ' ✓'}
                </button>
              ))}
            </div>
            <button onClick={() => { localStorage.setItem(`juce_default_cal_${userEmail}`, defaultCalendar === null ? 'null' : defaultCalendar); setShowSetup(false); }}
              style={{ width: '100%', background: '#00c8e8', color: '#000', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
              Save & Go
            </button>
          </div>
        </div>
      )}

      {showBackfill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ color: '#00c8e8', fontSize: '16px', fontWeight: '700', margin: 0 }}>🔗 Backfill Deep Links</h2>
              <button onClick={() => setShowBackfill(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '12px', margin: '0 0 16px 0' }}>Patches "📱 Open in Overwatch" into all non-completed events from the last 60 days.</p>
            <button onClick={runBackfill} disabled={backfillRunning}
              style={{ background: backfillRunning ? '#334155' : '#00c8e8', color: backfillRunning ? '#64748b' : '#000', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: backfillRunning ? 'not-allowed' : 'pointer', marginBottom: '12px' }}>
              {backfillRunning ? 'Running...' : 'Run Backfill'}
            </button>
            <div style={{ flex: 1, overflowY: 'auto', background: '#0f1729', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.8' }}>
              {backfillLog.length === 0 && <span style={{ color: '#94a3b8' }}>Log will appear here...</span>}
              {backfillLog.map((entry, i) => (
                <div key={i} style={{ color: entry.type === 'ok' ? '#22c55e' : entry.type === 'err' ? '#ef4444' : entry.type === 'cal' ? '#00c8e8' : entry.type === 'dim' ? '#475569' : '#e2e8f0' }}>{entry.msg}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <HelpBot userEmail={userEmail} currentView={location.pathname} userName={getUserConfig(userEmail).name} userRole={getUserConfig(userEmail).role} />
    </>
  );
}

// ── HOME SCREEN ───────────────────────────────────────────────────────────
// Legacy HomeScreen REMOVED 9.9.30 — OpsHome replaced it and nothing had
// rendered this in months. ~120 lines of dead nav config that still listed
// screens which no longer exist.

// ── DEEP LINK FINISH ────────────────────────────────────────────────
// Tech opens "📱 Open in Overwatch" link from a calendar event description.
// We fetch the event from Google Calendar and hand it to JobFinishSheet.
// JobFinishSheet writes the time entry, return card if needed, and patches the title.
function DeepLinkFinish({ calendarId, eventId, accessToken, userEmail, userName, onDone }) {
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId || !eventId || !accessToken) return;
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        setEvent({
          id: data.id,
          title: data.summary || '(no title)',
          calendarId,
          start: data.start?.dateTime || data.start?.date,
          end: data.end?.dateTime || data.end?.date,
          description: data.description || '',
          location: data.location || '',
        });
      })
      .catch(e => setError(e.message || 'Could not load job'));
  }, [calendarId, eventId, accessToken]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ color: '#e2e8f0', fontSize: 16 }}>Could not load this job.</div>
        <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center' }}>{error}</div>
        <button onClick={onDone} style={{ marginTop: 12, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 20px', cursor: 'pointer' }}>
          Back to home
        </button>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#cbd5e1', fontSize: 14 }}>Loading job…</div>
      </div>
    );
  }

  return (
    <JobFinishSheet
      event={event}
      accessToken={accessToken}
      userEmail={userEmail}
      userName={userName}
      mode="full"
      onFinished={onDone}
      onCancel={onDone}
    />
  );
}
