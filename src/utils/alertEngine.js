// Alert engine — fetches real-time stuck items from Supabase + GCal
// Used by both the dashboard panel and JR's blocking gate.

import { supabase } from '../services/supabase.js';
import { CALENDARS } from '../config/calendars.js';
import { STALE_HOURS, hoursSince } from './staleness.js';
import { missingLabel } from './completeness.js';
import { assigneeOf } from './ownership.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Tags that mean the job has been acted on
const ACTIONED_TAGS = [
  '[COMPLETED]', '[BILLED]', '[TO BILL]', '[RETURN NEEDED]',
  '[ESTIMATE NEEDED]', '[IN PROGRESS]', '[IGNORE]', '[IGNORED]',
  '[DONE]', '[INVOICE]', '[INVOICED]', '[SCHEDULED]',
];

function hoursOld(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

export async function fetchStuckAlerts(accessToken) {
  const alerts = [];

  // ── 0a. Work not attached to a real customer ────────────────
  // Sara's rule: techs are NEVER blocked in the field for this — but the
  // moment a job is finished without a customer UUID it surfaces here, and
  // it says exactly what's missing rather than a useless "incomplete".
  try {
    const { data } = await supabase
      .from('jobs')
      .select('id, customer_name, customer_phone, customer_address, issue, status, tech_name, created_at, updated_at')
      .is('customer_id', null)
      .not('status', 'in', '(billed,archived,dead,lost)')
      .order('created_at', { ascending: true })
      .limit(50);

    (data || []).forEach(j => alerts.push({
      type:      'orphan',
      icon:      '🔗',
      label:     'NOT LINKED TO A CUSTOMER',
      customer:  j.customer_name || 'Unnamed',
      detail:    missingLabel(j) || 'needs a customer link',
      hoursOld:  Math.round(hoursSince(j.created_at)),
      threshold: 0,
    }));
  } catch { /**/ }

  // ── 0b. Board jobs with no update in 72h ────────────────────
  // The 72-hour rule, same threshold the Board card rails use
  // (src/utils/staleness.js). A job nobody has touched in 3 days is a
  // job nobody is working — surface it here instead of hoping someone
  // notices the amber rail.
  try {
    const cutoff = new Date(Date.now() - STALE_HOURS * 3600000).toISOString();
    const { data } = await supabase
      .from('jobs')
      .select('id, customer_name, issue, status, tech_name, updated_at, created_at')
      .not('status', 'in', '(complete,billed,archived,dead,lost,won)')
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .limit(50);

    (data || []).forEach(j => alerts.push({
      type:      'stale',
      icon:      '⏱',
      label:     'NO UPDATE IN 72H',
      customer:  j.customer_name || 'Unknown customer',
      detail:    `${assigneeOf(j) || 'Unassigned'} · ${j.issue || 'no issue noted'}`,
      hoursOld:  Math.round(hoursSince(j.updated_at || j.created_at)),
      threshold: STALE_HOURS,
    }));
  } catch { /**/ }

  // ── 1. Returns past 3 days (72h) ────────────────────────────
  try {
    const cutoff = new Date(Date.now() - 72 * 3600000).toISOString();
    const { data } = await supabase
      .from('return_cards')
      .select('id, customer_name_raw, reason, created_at, flagged_by_name')
      .eq('status', 'pending_schedule')
      .lt('created_at', cutoff);

    (data || []).forEach(r => alerts.push({
      type:      'return',
      icon:      '🔄',
      label:     'RETURN NOT SCHEDULED',
      customer:  r.customer_name_raw || 'Unknown customer',
      detail:    r.reason || 'Return needed',
      hoursOld:  Math.round(hoursOld(r.created_at)),
      threshold: 72,
    }));
  } catch { /**/ }

  // ── 2. Estimates with no follow-up past 48h ─────────────────
  try {
    const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
    const { data } = await supabase
      .from('time_entries')
      .select('id, customer_name_raw, event_title, tech_name, created_at')
      .eq('disposition', 'estimate')
      .eq('billed', false)
      .lt('created_at', cutoff);

    (data || []).forEach(e => alerts.push({
      type:      'estimate',
      icon:      '💰',
      label:     'ESTIMATE NOT FOLLOWED UP',
      customer:  e.customer_name_raw || e.event_title || 'Unknown',
      detail:    `Flagged by ${e.tech_name || 'tech'} — no action taken`,
      hoursOld:  Math.round(hoursOld(e.created_at)),
      threshold: 48,
    }));
  } catch { /**/ }

  // ── 3. Unactioned jobs on tech calendars past 36h ───────────
  if (accessToken) {
    const twoWeeksAgo  = new Date(Date.now() - 14 * 24 * 3600000);
    const thirtySevenH = new Date(Date.now() - 37 * 3600000);

    const techCals = [
      { id: CALENDARS.AUSTIN, name: 'Austin' },
      { id: CALENDARS.JR,     name: 'JR'     },
      { id: CALENDARS.TECH3,  name: 'Brian'  },
    ];

    await Promise.all(techCals.map(async cal => {
      try {
        const params = new URLSearchParams({
          timeMin: twoWeeksAgo.toISOString(),
          timeMax: thirtySevenH.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '50',
        });
        const res = await fetch(
          `${GCAL}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) return;
        const data = await res.json();
        (data.items || []).forEach(ev => {
          if (ev.status === 'cancelled' || !ev.summary?.trim()) return;
          const upper = ev.summary.toUpperCase();
          if (ACTIONED_TAGS.some(tag => upper.includes(tag))) return;
          const start = ev.start?.dateTime || ev.start?.date;
          alerts.push({
            type:      'unactioned',
            icon:      '⚠️',
            label:     'JOB NOT ACTIONED',
            customer:  ev.summary,
            detail:    `${cal.name}'s calendar — no time logged`,
            hoursOld:  Math.round(hoursOld(start)),
            threshold: 36,
          });
        });
      } catch { /**/ }
    }));
  }

  return alerts;
}

// ── Acknowledgment helpers ───────────────────────────────────
const ACK_PREFIX  = 'juce_alert_ack_';
const ACK_INTERVAL = 6 * 3600000; // 6 hours

export function shouldShowGate(userEmail) {
  if (!userEmail) return false;
  const key  = ACK_PREFIX + userEmail.toLowerCase().replace(/[@.]/g, '_');
  const last = parseInt(localStorage.getItem(key) || '0');
  return Date.now() - last > ACK_INTERVAL;
}

export function acknowledgeAlerts(userEmail) {
  const key = ACK_PREFIX + userEmail.toLowerCase().replace(/[@.]/g, '_');
  localStorage.setItem(key, Date.now().toString());
}
