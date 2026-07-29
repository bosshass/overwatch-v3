// ============================================
// fuzzyMatch — catches duplicate tickets by name
// ============================================
// The recurring disease: the same customer ends up with 2-3 open tickets
// because nobody realized one already existed — sometimes an exact repeat
// (Vinyard Church, twice), sometimes a near-miss spelling (Sainati/Santini,
// JAllen/Jerry Allen). This does simple, dependency-free fuzzy matching
// (token overlap + edit distance) good enough to catch both patterns without
// pulling in a library.
//
// Used in two places:
//   1. JobDetail, on load — checks this job's customer name against every
//      OTHER open job (covers "already on the board" AND "scheduled in the
//      future," since both live in the jobs table under different statuses).
//   2. calendarSync.js's scanForOrphans — checks each orphaned calendar
//      event's derived name against the same open-jobs list, so Event Audit
//      surfaces "this looks like it might already be a job" instead of
//      silently letting a duplicate get created from it.

import { supabase } from '../services/supabase.js';

const STOP_WORDS = new Set(['llc', 'inc', 'llp', 'corp', 'co', 'construction', 'company', 'the', 'and']);

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(t => t && !STOP_WORDS.has(t))
    .join(' ')
    .trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// 0..1, higher = more likely the same customer.
export function nameSimilarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  const overlap = [...ta].filter(t => tb.has(t)).length;
  const tokenScore = overlap / Math.max(ta.size, tb.size, 1);
  const dist = levenshtein(na, nb);
  const editScore = 1 - dist / Math.max(na.length, nb.length, 1);
  return Math.max(tokenScore, editScore);
}

// Calibrated against tonight's real cases, not guessed. At 0.4:
//   Sainati/Santini 0.43, Jeanneret/Jeanerette 0.70, JAllen/Jerry Allen 0.55,
//   Eckstein/"ECKSTEIN, NEIL" 0.62 — all correctly flag.
//   Boyd Lake/Chris Hare 0.30, Anderson/Allen 0.38, Rupert/Goodell 0.14 —
//   all correctly stay quiet (Anderson/Allen sits right at the boundary).
// Known false-positive class: BG Automotive's different physical locations
// score 0.73-0.77 and WILL flag, even though "same name, different cs_number
// = different location, keep both" is an established rule here. That's fine
// — this is an advisory flag for a human glance, not an auto-merge. Missing
// a real duplicate costs days; an extra one-second glance at a legitimate
// multi-site account costs nothing.
export const DUPLICATE_MATCH_THRESHOLD = 0.4;

export function isFuzzyMatch(a, b, threshold = DUPLICATE_MATCH_THRESHOLD) {
  return nameSimilarity(a, b) >= threshold;
}

// Statuses that mean "this ticket is done and doesn't count as a live
// duplicate anymore." Everything else — including scheduled-in-the-future —
// is still a real, open ticket that a second one would collide with.
const CLOSED_STATUSES = ['billed', 'archived', 'dead', 'lost'];

// Finds other OPEN jobs whose customer name fuzzy-matches. Excludes the job
// itself by id. This single query is what covers both "remains on the
// board" and "is scheduled in the future" — both are just open-status rows
// in the same table.
export async function findDuplicateJobs(customerName, excludeJobId) {
  if (!customerName?.trim()) return [];
  const { data, error } = await supabase
    .from('jobs')
    .select('id, customer_name, status, scheduled_for, created_at')
    .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
    .limit(500);
  if (error || !data) return [];
  return data
    .filter(j => j.id !== excludeJobId && isFuzzyMatch(j.customer_name, customerName))
    .map(j => ({ ...j, similarity: nameSimilarity(j.customer_name, customerName) }))
    .sort((a, b) => b.similarity - a.similarity);
}
