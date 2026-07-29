// ============================================================================
// supabaseClient.js
//
// NO FALLBACK. This is deliberate and it is the most important line in the file.
//
// v9 shipped this:
//   const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
//     || 'https://wolhqelloeypafmmvapn.supabase.co';
//
// Which meant a build with missing env vars came up looking perfectly healthy,
// pointed straight at DRH production, and started writing to Shana's live data.
// Silently. That is how v3 could have destroyed the thing it was replacing.
//
// Here it throws. A misconfigured deploy is a white screen and a console error,
// which is loud, obvious, and harmless.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Set them in Vercel (Production + Preview + Development) or .env.local. ' +
    'There is no fallback — that is on purpose.'
  );
}

// Guardrail: v3 must never talk to the v9 production project.
if (url.includes('wolhqelloeypafmmvapn')) {
  throw new Error(
    'v3 is pointed at DRH PRODUCTION (wolhqelloeypafmmvapn). Refusing to start. ' +
    'v3 belongs on wppwofsbwymzaeyapwhs.'
  );
}

export const supabase = createClient(url, anonKey);
export const SUPABASE_URL = url;
