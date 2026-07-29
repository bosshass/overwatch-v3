// ============================================
// JobFinishSheet — canonical "tech finishes a job" UI
// ============================================
// One bottom sheet, four dispositions, four canonical tags:
//   • [BILL IT]      — disposition: 'bill_it'
//   • [RETURN]       — disposition: 'return' (also writes a return_card)
//   • [IN PROGRESS]  — disposition: 'in_progress' (multi-day work, stays open)
//   • [ESTIMATE]     — disposition: 'estimate' (sales handoff)
//
// REPLACES (deleted): CompletionModal.jsx, JobCompleteModal.jsx, TimeCaptureModal.jsx
//
// Required gates: valid time entry + notes. Return also requires a reason.
// (Linked customer used to be a hard gate — dropped because that association
// should already exist upstream; it's still captured when present, just not
// a blocker.)
// Writes ONE row to time_entries; for 'return' also writes ONE row to return_cards.
// Patches the calendar event TITLE only (description is owned by CustomerLookup).
//
// Props:
//   event           { id, title, calendarId, start, end, description, location, techName }
//   accessToken     Google OAuth bearer (required to PATCH calendar)
//   userEmail       signed-in user's email (becomes time_entry.tech_email)
//   userName        signed-in user's display name (fallback for tech_name)
//   prefillCustomer optional pre-linked customer (skips the lookup if provided)
//   onFinished      called after a successful disposition: (disposition, newTitle) => void
//   onCancel        called when the user dismisses the sheet
//   mode            optional; 'full' (default) shows all 4 buttons. 'bill-only' shows only Bill It.
//   inline          optional; when true, renders JUST the form (no overlay, no header) for use
//                   inside an existing sheet (e.g. TechWorkToday's rich detail sheet).

import { useState, useEffect } from 'react';
import { timeEntriesApi, returnCardsApi, jobsApi, supabase, JOB_STATUS } from '../services/supabase.js';
import { resolveJobForEvent } from '../utils/jobResolve.js';
import TimeEntryBlock, { emptyTimeEntry, isValidTimeEntry, timeEntryToPayload } from './TimeEntryBlock.jsx';
import CustomerLookup from './CustomerLookup.jsx';
import { dispo, DISPO_KEYS } from '../utils/billing.js';

const GCAL = 'https://www.googleapis.com/calendar/v3';

// Canonical tags. Parsers in Billing/Queue/Board/Scheduler accept these PLUS legacy
// synonyms ([COMPLETED], [TO BILL], [RETURN NEEDED], etc.) for backward compatibility.
const TAG = {
  bill_it:     '[BILL IT]',
  return:      '[RETURN]',
  in_progress: '[IN PROGRESS]',
  estimate:    '[ESTIMATE]',
};

// Strip any existing leading/trailing tags from the title before applying a new one.
function cleanTitle(title) {
  return (title || '').replace(/\s*\[.*?\]/g, '').trim();
}

export default function JobFinishSheet({
  event,
  accessToken,
  userEmail,
  userName,
  prefillCustomer = null,
  onFinished,
  onCancel,
  mode = 'full',
  inline = false,
}) {
  const [notes, setNotes]               = useState('');
  const [materials, setMaterials]       = useState('');
  const [photoLink, setPhotoLink]       = useState('');
  const [timeEntry, setTimeEntry]       = useState(emptyTimeEntry());
  const [linkedCustomer, setLinkedCust] = useState(prefillCustomer);
  const [returnReason, setReturnReason] = useState('');
  const [returnExpanded, setRetExp]     = useState(false);
  const [acting, setActing]             = useState(false);
  const [error, setError]               = useState('');
  // v9.4.0: disposition is now a SELECTION made up top (before notes), and a
  // single "Finish job" button commits it. Previously the 4 disposition
  // buttons were buried under Notes+Materials and doubled as the submit,
  // so the tech had to scroll past everything to say what happened.
  const [selectedDispo, setSelectedDispo] = useState(null);

  // If the parent passes a different prefill customer mid-life, follow it.
  useEffect(() => { if (prefillCustomer) setLinkedCust(prefillCustomer); }, [prefillCustomer]);

  const eventDate     = event?.start ? new Date(event.start) : new Date();
  const timeValid     = isValidTimeEntry(timeEntry, eventDate);
  const notesValid    = notes.trim().length >= 3;   // required: no blank completions
  // Linking a customer is no longer a hard gate — that association should
  // already exist upstream (calendar sync / registry match), and forcing
  // the tech to do it manually every single time was pure friction. It's
  // still shown and still gets saved when present; it just can't block
  // finishing a job anymore.
  const canFinish     = notesValid && !acting;

  // ── Calendar PATCH ────────────────────────────────────────────────
  // Patches the title and, when the tech left notes/materials, APPENDS them to
  // the event description so the worker's notes live on the calendar — not just
  // in Overwatch. Append-only: never overwrites the existing description.
  const patchTitle = async (newTitle) => {
    const body = { summary: newTitle };

    const noteText = notes.trim();
    const matText  = materials.trim();
    if (noteText || matText) {
      const stamp = new Date()
        .toLocaleString('en-US', {
          timeZone: 'America/Denver',
          month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        })
        .replace(',', '').replace(' AM', 'a').replace(' PM', 'p');
      const who = event.techName || userName || 'Tech';
      const parts = [];
      if (noteText) parts.push(noteText);
      if (matText)  parts.push(`Materials: ${matText}`);
      const line = `📝 [${stamp} ${who}] ${parts.join(' — ')}`;

      // Read the event's CURRENT description straight from Google so we never
      // clobber the customer-info block (which CustomerLookup owns) — append only.
      let current = event.description || '';
      try {
        const getUrl = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
        const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (getRes.ok) {
          const live = await getRes.json();
          current = live.description || '';
        }
      } catch { /* fall back to the passed-in description */ }

      body.description = current ? `${current}\n${line}` : line;
    }

    const url = `${GCAL}/calendars/${encodeURIComponent(event.calendarId)}/events/${event.id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar patch failed: ${res.status}`);
  };

  // ── Adopt-on-disposition (Option C) ───────────────────────────────
  // Every disposition must land on a real jobs row. If this calendar event
  // was booked outside Overwatch (no jobs row), adopt it now: create the row
  // from the event and stamp calendar_event_id. Dedupe on calendar_event_id
  // so we never make a ghost. Returns the job id.
  const DISPOSITION_STATUS = {
    bill_it:     JOB_STATUS.TO_BILL,
    estimate:    JOB_STATUS.NEEDS_ESTIMATE,
    in_progress: JOB_STATUS.SCHEDULED,   // stays open / active
    return:      JOB_STATUS.RETURN_PENDING,
    // "Couldn't do it" — no access, wrong parts, customer turned the tech away.
    // Previously there was no button for this, so techs picked "In progress"
    // and the job sat in Scheduled looking like it was still happening.
    blocked:     JOB_STATUS.BLOCKED,
  };
  // was a private label map — a fourth copy. utils/billing.js owns this.
  const DISPO_LABEL = Object.fromEntries(DISPO_KEYS.map(k => [k, dispo(k).label]));
  const ensureJobForEvent = async (disposition) => {
    const base = cleanTitle(event.title);
    const target = DISPOSITION_STATUS[disposition] || JOB_STATUS.SCHEDULED;
    // ONE resolver, shared with Unbilled and the home tile. See utils/jobResolve.
    const existing = await resolveJobForEvent(event.id);

    if (existing) {
      // Already tracked — move it to the disposition's status AND put the
      // tech's real field notes on the card (job_history), not just a stub.
      const histNote = notes.trim()
        ? `${DISPO_LABEL[disposition] || disposition}: ${notes.trim()}`
        : `${disposition} disposition from Work Today`;
      await jobsApi.changeStatus(existing.id, target, userEmail, histNote);
      return existing.id;
    }
    // LAST CHANCE before we manufacture a duplicate. An event that was moved
    // between calendars, or recreated by hand, gets a brand-new Google id — so
    // the id lookups above all miss even though the job is sitting right there
    // on the board. Match on the same customer, same day, still-open, before
    // creating anything. This is the "why did a second card appear" bug.
    if (event.start) {
      try {
        const day = new Date(event.start);
        const from = new Date(day); from.setHours(0, 0, 0, 0);
        const to   = new Date(day); to.setHours(23, 59, 59, 999);
        let q = supabase.from('jobs').select('id, status')
          .gte('scheduled_date', from.toISOString())
          .lte('scheduled_date', to.toISOString())
          .not('status', 'in', '(billed,archived,dead,lost)')
          .limit(1);
        q = linkedCustomer?.id
          ? q.eq('customer_id', linkedCustomer.id)
          : q.ilike('customer_name', `%${(base || '').slice(0, 24)}%`);
        const { data: near } = await q;
        if (near && near[0]) {
          // Found it. Bind this event id on so the miss can't repeat, then
          // move it — do NOT create a second row.
          await supabase.from('jobs')
            .update({ calendar_event_id: event.id }).eq('id', near[0].id);
          const histNote = notes.trim()
            ? `${DISPO_LABEL[disposition] || disposition}: ${notes.trim()}`
            : `${disposition} disposition from Work Today`;
          await jobsApi.changeStatus(near[0].id, target, userEmail, histNote);
          return near[0].id;
        }
      } catch (e) { console.warn('ensureJobForEvent: same-day match failed', e); }
    }

    // Genuinely untracked — adopt the calendar event into a new jobs row.
    const created = await jobsApi.create({
      customer_name:     linkedCustomer?.name || base,
      customer_id:       linkedCustomer?.id || undefined,
      status:            target,
      issue:             notes.trim() || base || '',
      customer_address:  event.location || '',
      scheduled_date:    event.start ? new Date(event.start).toISOString() : undefined,
      calendar_event_id: event.id,
      scheduled_event_id: event.id,   // both, so the next lookup cannot miss
    }, `${userEmail} · adopted from calendar`);
    return created?.id || null;
  };

  // ── Supabase write — every disposition routes through this ────────
  const writeTimeEntry = async (disposition) => {
    const payload = timeEntryToPayload(timeEntry, eventDate);
    return timeEntriesApi.create({
      customer_id:        linkedCustomer?.id || null,
      customer_name_raw:  linkedCustomer?.name || cleanTitle(event.title) || null,
      calendar_event_id:  event.id,
      calendar_id:        event.calendarId,
      event_title:        event.title,
      event_start:        event.start ? new Date(event.start).toISOString() : null,
      tech_email:         userEmail || null,
      tech_name:          event.techName || userName || null,
      time_in:            payload.time_in,
      time_out:           payload.time_out,
      total_minutes:      payload.total_minutes,
      entry_method:       payload.entry_method,
      disposition,
      notes:              [notes.trim(), photoLink.trim() ? `📎 Photos: ${photoLink.trim()}` : ''].filter(Boolean).join('\n\n') || null,
      materials:          materials.trim() || null,
    });
  };

  // ── Disposition handlers ──────────────────────────────────────────
  const finish = async (disposition, extra = {}) => {
    if (!canFinish || !event) return;
    setActing(true);
    setError('');
    try {
      const base = cleanTitle(event.title);
      const newTitle = `${base} ${TAG[disposition]}`;
      await patchTitle(newTitle);
      const entry = await writeTimeEntry(disposition);

      // Adopt-on-disposition: ensure a jobs row exists for THIS event and
      // move it to the right status — for every disposition, not just estimate.
      // This captures appointments booked directly on Google Calendar.
      try {
        await ensureJobForEvent(disposition);
      } catch (err) {
        console.warn('adopt-on-disposition failed (time entry still saved):', err);
      }

      if (disposition === 'return') {
        await returnCardsApi.create({
          customer_id:          linkedCustomer?.id || null,
          customer_name_raw:    linkedCustomer?.name || base || null,
          original_event_id:    event.id,
          original_calendar_id: event.calendarId,
          original_event_title: event.title,
          original_location:    event.location || null,
          flagged_by_email:     userEmail || null,
          flagged_by_name:      event.techName || userName || null,
          reason:               extra.reason || null,
          time_entry_id:        entry?.id || null,
        });
      }

      onFinished?.(disposition, newTitle);
    } catch (e) {
      console.error(`${disposition} failed:`, e);
      setError(e.message || 'Failed to save — try again.');
      setActing(false);
    }
  };

  // Single commit path. In 'bill-only' mode the disposition is forced.
  const effectiveDispo = mode === 'full' ? selectedDispo : 'bill_it';
  const needsReason    = effectiveDispo === 'return';
  const reasonOk       = !needsReason || returnReason.trim().length > 0;
  const readyToFinish  = canFinish && !!effectiveDispo && reasonOk;

  const handleFinish = () => {
    if (!effectiveDispo) { setError('Pick how the job ended first.'); return; }
    if (needsReason && !returnReason.trim()) {
      setError('Add a reason for the return visit.');
      return;
    }
    finish(effectiveDispo, needsReason ? { reason: returnReason.trim() } : {});
  };

  if (!event) return null;

  // ── Scope of work — what the tech is walking into ──────────────────
  // Pulled straight off the calendar event description, stripped of the
  // machine noise (deep link, CUSTOMER_ID stamp) and of previously-appended
  // field notes (📝 lines). Shown IN FULL — no "Show more" truncation. This
  // is the single most important thing on the screen and it used to be
  // collapsed behind a link.
  const scope = (event.description || '')
    .replace(/📱.*|Open in (JUC-E|Overwatch).*/g, '')
    .replace(/CUSTOMER_ID:\s*[A-Za-z0-9\-_]+\s*/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('📝'))
    .join('\n')
    .trim();

  // Same five destinations as the board and My Tasks, in the words a tech
  // would use. The labels used to be this sheet's own invention — "Needs
  // estimate" here, "Estimates" on the board, "Won" in the mover — so the same
  // move had three names depending on which screen you were standing in.
  // `means` is the question the tech is actually answering.
  const DISPOS = [
    { key: 'bill_it',     label: '✅ Done — To Bill',     accent: '#166534', tint: '#f0fdf4',
      means: 'Finished. Hours go to Billing.' },
    { key: 'return',      label: '🔄 Return Visit',       accent: '#d97706', tint: '#fffbeb',
      means: 'Work started — I have to come back. Asks why.' },
    { key: 'in_progress', label: '📅 Still Scheduled',    accent: '#1d4ed8', tint: '#eff6ff',
      means: 'Multi-day job. Not finished, still booked.' },
    { key: 'estimate',    label: '📋 Estimates',          accent: '#7e22ce', tint: '#faf5ff',
      means: 'Scope changed — this needs pricing.' },
    { key: 'blocked',     label: '📝 New / Notes',        accent: '#b91c1c', tint: '#fef2f2',
      means: "Couldn't do it — no access, wrong parts, customer turned me away." },
  ];

  // ── The actual form content (customer + time + notes + materials + buttons) ──
  const formContent = (
    <>
      {/* NOT LINKED TO A CUSTOMER — loud, first, and never blocking.
          Blocking a tech in the field creates worse problems than a dirty row,
          so they can still finish. But this job stays flagged on the Board and
          lands in JR's alert panel until someone matches it. */}
      {!linkedCustomer && (
        <div style={{ background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:12, padding:'10px 12px', marginBottom:12 }}>
          <div style={{ fontSize:14, fontWeight:800, color:'#92400e', marginBottom:2 }}>
            ⚠️ Not linked to a customer
          </div>
          <div style={{ fontSize:13, color:'#a16207', lineHeight:1.45 }}>
            Pick the client below so this bills correctly. If they aren't in the
            system yet, finish anyway — it'll be flagged for the office.
          </div>
        </div>
      )}

      {/* SCOPE OF WORK — the hero. Full text, no truncation, no "Show more". */}
      {scope && (
        <div style={scopeBox}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
            📋 Scope of work
          </div>
          <div style={{ fontSize: 14, color: '#1e3a8a', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {scope}
          </div>
        </div>
      )}

      {/* HOW DID IT END — moved ABOVE notes. Pick first, then write. */}
      {mode === 'full' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: selectedDispo ? '#16a34a' : '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            How did it end? {selectedDispo ? '✓' : '— required'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 10 }}>
            {DISPOS.map(d => {
              const on = selectedDispo === d.key;
              return (
                <button key={d.key}
                  onClick={() => { setSelectedDispo(d.key); setError(''); if (d.key !== 'return') setReturnReason(''); }}
                  style={{
                    padding: '13px 8px', borderRadius: 12, cursor: 'pointer',
                    background: on ? d.tint : '#ffffff',
                    border: on ? `2px solid ${d.accent}` : '1.5px solid #e5e7eb',
                    color: on ? d.accent : '#475569',
                    fontSize: 14, fontWeight: on ? 800 : 600, textAlign: 'left',
                  }}>
                  <span style={{ display: 'block' }}>{d.label}</span>
                  {/* The question the tech is answering, in their words. A label
                      alone made them guess which button meant "couldn't get in". */}
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500,
                                 color: on ? d.accent : '#94a3b8', marginTop: 3, lineHeight: 1.3 }}>
                    {d.means}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Return reason — only when Return is the pick */}
          {needsReason && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Why is a return visit needed?
              </div>
              <textarea
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="Missing part, customer not home, needs follow-up…"
                autoFocus
                style={{
                  width: '100%', padding: 8, fontSize: 15, color: '#1B2A4A',
                  background: '#ffffff', border: '1px solid #fcd34d', borderRadius: 8,
                  resize: 'none', height: 54, boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Notes (required — blocks finish until filled) */}
      <div style={{ fontSize: 11, fontWeight: 700, color: notesValid ? '#16a34a' : '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        📝 Notes — required {notesValid ? '✓' : ''}
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="What was done / what's needed — required to finish"
        style={{ ...textareaStyle, background: notesValid ? '#f9fafb' : '#fef2f2', border: `1.5px solid ${notesValid ? '#e5e7eb' : '#fca5a5'}` }}
      />

      {/* Materials */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        🔧 Materials
      </div>
      <textarea
        value={materials}
        onChange={e => setMaterials(e.target.value)}
        placeholder="Parts, supplies, equipment used or needed..."
        style={{ ...textareaStyle, background: '#fffbeb', border: '1px solid #fcd34d', height: 56 }}
      />

      {/* Time entry */}
      <TimeEntryBlock
        value={timeEntry}
        onChange={setTimeEntry}
        eventDate={eventDate}
        required={false}
      />

      {/* Customer link — optional, saved when set */}
      <CustomerLookup
        event={event}
        accessToken={accessToken}
        value={linkedCustomer}
        onChange={setLinkedCust}
      />

      {error && <div style={errorBox}>{error}</div>}

      {/* Single commit button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        <button onClick={handleFinish} disabled={!readyToFinish} style={btnFinish(readyToFinish)}>
          {acting ? 'Saving…'
            : !effectiveDispo ? 'Pick an outcome above'
            : !notesValid ? 'Add notes to finish'
            : needsReason && !reasonOk ? 'Add a return reason'
            : 'Finish job'}
        </button>
        <button onClick={onCancel} style={btnCancel}>Cancel</button>
      </div>
    </>
  );

  // Inline mode — caller (e.g. TechWorkToday) provides its own overlay/sheet/header.
  if (inline) return formContent;

  // Standalone mode — render the full overlaid bottom sheet with a basic header.
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ color: '#1B2A4A', fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {cleanTitle(event.title) || '(untitled job)'}
            </div>
            {event.start && (
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                {new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
            {event.location && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>📍 {event.location}</div>}
          </div>
          <button onClick={onCancel} style={closeBtn}>×</button>
        </div>

        <div style={hr} />

        {formContent}
      </div>
    </div>
  );
}

// ── ReturnButtonWithReason ────────────────────────────────────────
// Inline-expands a reason field before firing onConfirm, since
// every return_card needs a reason to be useful in the Scheduler/Board view.
function ReturnButtonWithReason({ canFinish, acting, expanded, setExpanded, reason, setReason, onConfirm }) {
  const ready = canFinish && reason.trim().length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => canFinish && setExpanded(true)}
        disabled={!canFinish}
        style={btnReturnCollapsed(canFinish)}
      >
        🔄 Return Visit
      </button>
    );
  }

  return (
    <div style={{ background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Why is a return visit needed?
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Missing part, customer not home, needs follow-up…"
        autoFocus
        style={{
          width: '100%', padding: 8, fontSize: 13, color: '#1B2A4A',
          background: '#ffffff', border: '1px solid #fcd34d', borderRadius: 8,
          resize: 'none', height: 50, marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setExpanded(false)} style={{ flex: 1, padding: 8, background: 'none', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: 12, cursor: 'pointer' }}>
          Back
        </button>
        <button onClick={onConfirm} disabled={!ready} style={{
          flex: 2, padding: 8,
          background: ready ? '#d97706' : '#fde68a',
          border: 'none', borderRadius: 8,
          color: ready ? '#ffffff' : '#92400e',
          fontSize: 13, fontWeight: 700,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}>
          {acting ? 'Saving…' : 'Confirm Return'}
        </button>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 41, 0.75)',
  zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};
const sheet = {
  background: '#ffffff', borderRadius: '20px 20px 0 0',
  padding: '20px 18px calc(28px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 480,
  maxHeight: '92vh', maxHeight: '92dvh', overflowY: 'auto',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
};
const hr = { height: 1, background: '#e5e7eb', margin: '12px 0' };
const closeBtn = {
  background: 'none', border: 'none', color: '#9ca3af',
  fontSize: 28, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
};
const textareaStyle = {
  width: '100%', padding: 12,
  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12,
  color: '#1B2A4A', fontSize: 16, resize: 'none', height: 72,
  marginBottom: 10, boxSizing: 'border-box', fontFamily: 'inherit',
};
const hintBox = {
  padding: '10px 12px', background: '#fffbeb', border: '1px solid #fcd34d',
  borderRadius: 12, fontSize: 13, color: '#92400e', textAlign: 'center', marginBottom: 4,
};
const errorBox = {
  padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 12, fontSize: 13, color: '#b91c1c', marginBottom: 4,
};
const btnInProgress = (on) => ({
  padding: 15, background: on ? '#ecfeff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#67e8f9' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#155e75' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnReturnCollapsed = (on) => ({
  padding: 15, background: on ? '#fffbeb' : '#f1f5f9',
  border: `1.5px solid ${on ? '#fbbf24' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#92400e' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnEstimate = (on) => ({
  padding: 15, background: on ? '#f5f3ff' : '#f1f5f9',
  border: `1.5px solid ${on ? '#c4b5fd' : '#cbd5e1'}`, borderRadius: 12,
  color: on ? '#5b21b6' : '#94a3b8', fontSize: 16, fontWeight: 700,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnBillIt = (on) => ({
  padding: 16, background: on ? '#1B2A4A' : '#cbd5e1', border: 'none',
  borderRadius: 12, color: '#ffffff', fontSize: 16, fontWeight: 800,
  cursor: on ? 'pointer' : 'not-allowed',
});
const btnCancel = {
  padding: 13, background: 'none', border: '1px solid #e5e7eb',
  borderRadius: 12, color: '#9ca3af', fontSize: 15, cursor: 'pointer',
};

const scopeBox = {
  background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12,
  padding: '10px 12px', marginBottom: 12,
};
const btnFinish = (on) => ({
  padding: 16, background: on ? '#1B2A4A' : '#cbd5e1', border: 'none',
  borderRadius: 12, color: '#ffffff', fontSize: 16, fontWeight: 800,
  cursor: on ? 'pointer' : 'not-allowed',
});
