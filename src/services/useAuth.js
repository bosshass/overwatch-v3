// ============================================================================
// useAuth.js — Google sign-in and token life.
//
// PORTED FROM 9.14.0, which fixed the "it logs me out mid-task" bug everyone
// reported. Keeping the fix; changing only what has to change for v3.
//
// The v9 bug: refresh used a hidden iframe pointed at Google. Google blocks
// itself in iframes, so the load never completed, the 8s timeout always fired,
// silentRefresh() always resolved false, and the 401 handler signed the user
// out. Every single time a token died. Google Identity Services does this
// without an iframe, so it actually works.
//
// Two behaviours worth keeping:
//   1. Renew at 80% of the token's REAL lifetime (from expires_in, not a
//      made-up 36 hours). Waiting for a 401 means the user always eats one
//      failed action first.
//   2. Session expiry PROMPTS, never force-signs-out. Losing an operator's
//      half-finished work to a background timer is never the right trade.
//
// CHANGED FOR V3: storage keys are ow_v3_*, not juce_v4_*. If v3 ever takes
// over the production domain, nobody inherits a stale v9 session.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const K = {
  token: 'ow_v3_token',
  email: 'ow_v3_email',
  tokenExpiry: 'ow_v3_token_expiry',
  session: 'ow_v3_session_expiry',
};

const clearStorage = () => Object.values(K).forEach(k => localStorage.removeItem(k));

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(K.token));
  const [email, setEmail] = useState(() => localStorage.getItem(K.email));
  const [ready, setReady] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const isSignedIn = Boolean(token && email);

  // ── Sign in ────────────────────────────────────────────────────────────
  const signIn = useCallback(() => {
    if (!CLIENT_ID) {
      alert('VITE_GOOGLE_CLIENT_ID is not set — check the Vercel env vars.');
      return;
    }
    // Preserve a deep link (/board?job=…) across the round trip so an assign
    // link lands where it pointed instead of dumping the user on '/'.
    const here = window.location.pathname + window.location.search;
    if (here && here !== '/') sessionStorage.setItem('ow_v3_post_login', here);

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', window.location.origin);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('prompt', 'select_account');
    window.location.href = url.toString();
  }, []);

  const signOut = useCallback(() => {
    clearStorage();
    setToken(null);
    setEmail(null);
    setNeedsReconnect(false);
  }, []);

  // ── Catch the OAuth redirect ───────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) { setReady(true); return; }

    const params = new URLSearchParams(hash.substring(1));
    const t = params.get('access_token');
    const lifeMs = (Number(params.get('expires_in')) || 3600) * 1000;
    if (!t) { setReady(true); return; }

    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then(r => r.json())
      .then(d => {
        if (!d.email) throw new Error('Google returned no email');
        localStorage.setItem(K.token, t);
        localStorage.setItem(K.email, d.email);
        localStorage.setItem(K.tokenExpiry, new Date(Date.now() + lifeMs).toISOString());
        // Session is a separate, longer clock than the token.
        localStorage.setItem(K.session, new Date(Date.now() + 36 * 3600 * 1000).toISOString());
        setToken(t);
        setEmail(d.email);

        const back = sessionStorage.getItem('ow_v3_post_login');
        sessionStorage.removeItem('ow_v3_post_login');
        window.history.replaceState({}, '', back || '/');
      })
      .catch(() => window.history.replaceState({}, '', '/'))
      .finally(() => setReady(true));
  }, []);

  // ── Silent refresh via GIS (no iframe) ─────────────────────────────────
  const clientRef = useRef(null);
  const getClient = useCallback(() => {
    if (clientRef.current) return clientRef.current;
    const g = window.google?.accounts?.oauth2;
    if (!g) return null;
    clientRef.current = g.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      prompt: '',
      callback: () => {},
    });
    return clientRef.current;
  }, []);

  const silentRefresh = useCallback(() => new Promise(resolve => {
    const client = getClient();
    if (!client) return resolve(false);
    const done = ok => { clearTimeout(timer); resolve(ok); };
    const timer = setTimeout(() => done(false), 10000);
    client.callback = resp => {
      if (resp?.access_token) {
        const lifeMs = (Number(resp.expires_in) || 3600) * 1000;
        localStorage.setItem(K.token, resp.access_token);
        localStorage.setItem(K.tokenExpiry, new Date(Date.now() + lifeMs).toISOString());
        setToken(resp.access_token);
        done(true);
      } else done(false);
    };
    try { client.requestAccessToken({ prompt: '', login_hint: email }); }
    catch { done(false); }
  }), [getClient, email]);

  // Renew BEFORE it breaks — at 20% of life remaining.
  useEffect(() => {
    if (!isSignedIn) return;
    const tick = async () => {
      const exp = localStorage.getItem(K.tokenExpiry);
      if (!exp) return;
      const msLeft = new Date(exp).getTime() - Date.now();
      if (msLeft < 3600 * 1000 * 0.2) await silentRefresh();
    };
    tick();
    const iv = setInterval(tick, 4 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isSignedIn, silentRefresh]);

  // Session expiry prompts. It does not sign anyone out.
  useEffect(() => {
    if (!isSignedIn) return;
    const check = () => {
      const exp = localStorage.getItem(K.session);
      if (!exp || new Date(exp) <= new Date()) setNeedsReconnect(true);
    };
    check();
    const iv = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isSignedIn]);

  return { token, email, isSignedIn, ready, needsReconnect, signIn, signOut, silentRefresh };
}
