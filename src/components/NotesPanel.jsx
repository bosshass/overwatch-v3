// ============================================
// JUC-E V4 - NotesPanel Component
// ============================================
// Embeddable anywhere. Shows notes + quick add.
// Used in: JobDetail, JobCard expanded, everywhere.

import { useState, useEffect, useCallback } from 'react';
import { notesApi, jobsApi, STATUS_INFO } from '../services/supabase.js';
import { appendNoteToJobEvents } from '../services/calendarSync.js';

export default function NotesPanel({ jobId, userEmail, job = null, accessToken = null, compact = false, maxNotes = null }) {
  const [notes, setNotes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  // How many notes render before the feed collapses. Below this, the whole
  // thread shows — see THREAD_LIMIT note below displayNotes.
  const THREAD_LIMIT = 5;
  const [isLoading, setIsLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [expanded, setExpanded] = useState(!compact);
  // What kind of entry this is when you hit save. 'note' = normal job note
  // (unchanged default behavior). 'response' = same job note, tagged so it
  // reads as a logged response rather than an internal note. 'customer_only'
  // = NOT tied to this job at all — a standalone customer-service touch
  // (a call, a question) with nothing to schedule. That creates its own
  // lightweight job_type:'note' row against the customer, so it never shows
  // up as work on the board, but the customer has a real record of the touch.
  const [noteType, setNoteType] = useState('note');
  const [savingCustomerNote, setSavingCustomerNote] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const data = await notesApi.getAllForJob(jobId);
      // Merge-carried entries (from the Board's merge tool folding a duplicate
      // job's history in) are an audit trail, not something a tech needs
      // cluttering their note feed -- they're still in job_history in the
      // database if ever needed directly.
      // Merge-audit entries are history, not something a tech needs cluttering
      // their note feed. Two formats exist in the wild: the older Board-merge
      // carry-over ("↪ from merged job") and JobDetail's own merge tool
      // ("🔗 MERGED FROM JOB #…" / "[MERGED INTO JOB #…]"). All three, gone
      // from the feed; still in job_history in the database if ever needed.
      // ── Merge carry-over ────────────────────────────────────────────
      // Merging PREFIXES the note instead of absorbing it, and it does this
      // every time — so a card merged three times carries
      //   "↪ from merged job (Jul 6): ↪ from merged job: ↪ from merged job: …"
      // in front of one line of actual content. Hiding the whole line (what we
      // did before) threw away the real note with the wrapper. Stripping the
      // chain keeps the content and drops the bookkeeping, which is what a
      // merge should have done in the first place: the note becomes part of
      // this card, nothing more.
      const stripMergePrefix = (t) => {
        let out = (t || '').trim();
        let guard = 0;
        while (guard++ < 10) {
          const next = out.replace(/^↪\s*from merged job(\s*\([^)]*\))?\s*:\s*/i, '');
          if (next === out) break;
          out = next.trim();
        }
        return out;
      };

      // Pure bookkeeping — no human wrote these and nobody needs them in a
      // notes feed. They stay in job_history and behind the Activity toggle.
      const isBookkeeping = (t) => {
        const x = (t || '').trim();
        return !x
            || /^\[MERGED INTO JOB/i.test(x)
            || /^🔗 MERGED FROM JOB/i.test(x)
            || /^Merged into job #/i.test(x)
            || /^Marked as duplicate/i.test(x)
            || /^Job created$/i.test(x)
            || /^Assigned to /i.test(x)
            || /^Assignment email sent/i.test(x)
            || /^Unassigned\b/i.test(x)
            || /^Status changed/i.test(x)
            || /^Moved (to|from) /i.test(x)
            || /^Reconciled —/i.test(x)
            || /^📌 TENTATIVELY assigned/i.test(x);
      };

      const unwrapped = data.map(n => ({ ...n, text: stripMergePrefix(n.text) }));

      // Merging duplicates the same note onto the survivor. Collapse identical
      // text, keeping the earliest — that's when it was actually written.
      const seen = new Set();
      const deduped = unwrapped.filter(n => {
        const k = (n.text || '').trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      setNotes(deduped.filter(n => !isBookkeeping(n.text)));
      setActivity(deduped.filter(n => isBookkeeping(n.text)));
    } catch (e) {
      console.error('Notes load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const handleAddNote = async () => {
    if (!newNote.trim() || isSaving) return;
    setIsSaving(true);
    try {
      if (noteType === 'customer_only') {
        // Not tied to THIS job — a standalone customer-service touch. Create
        // a lightweight note-type job against the customer so it has a real
        // home, but it's job_type:'note' so it never shows as work anywhere
        // (the board excludes note/task job_types from its columns).
        if (!job?.customer_id) {
          alert('This job has no linked customer, so there\'s nowhere to file a customer-only note. Add it as a regular note instead.');
          setIsSaving(false);
          return;
        }
        const created = await jobsApi.create({
          customer_id: job.customer_id,
          customer_name: job.customer_name,
          customer_address: job.customer_address || null,
          customer_phone: job.customer_phone || null,
          job_type: 'note',
          status: 'complete',
          issue: newNote.trim().slice(0, 200),
        }, userEmail);
        await notesApi.addNote(created.id, newNote.trim(), userEmail);
      } else {
        const text = noteType === 'response' ? `💬 Response: ${newNote.trim()}` : newNote.trim();
        await notesApi.addNote(jobId, text, userEmail);
        // Mirror the note onto the linked Google Calendar event(s). Non-fatal:
        // the note is already saved; a calendar failure must not block the UI.
        if (job && accessToken) {
          try { await appendNoteToJobEvents(accessToken, job, text, userEmail); }
          catch (e) { console.warn('Calendar note sync failed (non-fatal):', e); }
        }
      }
      setNewNote('');
      setNoteType('note');
      await loadNotes();
    } catch (e) {
      console.error('Note save error:', e);
      alert('Note failed to save: ' + (e.message || e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSave = async (note) => {
    if (!editText.trim()) return;
    try {
      if (note.source === 'completion') {
        await notesApi.editCompletionNotes(jobId, editText.trim(), userEmail);
      } else {
        await notesApi.editHistoryNote(note.id, editText.trim());
      }
      setEditingId(null);
      await loadNotes();
    } catch (e) {
      console.error('Edit save error:', e);
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  };

  const formatAuthor = (email) => {
    if (!email) return '';
    const names = {
      'drhservicetech1@gmail.com': 'Austin',
      'austin@drhsecurityservices.com': 'Austin',
      'jr@drhsecurityservices.com': 'JR',
      'info@drhsecurityservices.com': 'Sara',
      'sara@jnbllc.com': 'Sara',
      'shanaparks@drhsecurityservices.com': 'Shana',
    };
    return names[email?.toLowerCase()] || email.split('@')[0];
  };

  // Newest comment always on top — sort explicitly so nothing (e.g. the
  // completion-note entry) floats or sticks regardless of source.
  const ordered = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // WAS: ordered.slice(0, 1) — one note, always.
  //
  // The old reasoning was sound for a tech glancing at a card on a truck: the
  // note that matters is usually the last thing somebody said. It is wrong for
  // anyone trying to work out what happened. 1,312 notes exist across 395
  // jobs; 917 of them never rendered. On work that is still open, 24 of the 26
  // jobs carrying notes were hiding some — 219 in total, one of them sitting
  // on 24 notes and showing a single line.
  //
  // What that cost, on one real job (FORT COLLINS NURSERY, 2026-07-28):
  //   Jul 27 1:16pm  Shana — "...east garden motion... JR needs to provide
  //                  next steps."
  //   Jul 28 4:36am  JR    — "...no one logged hours so I can't bill. Please
  //                  confirm"
  // JR could not see the note answering him. It was one tap away behind a grey
  // borderless button, and a tap nobody makes is a tap that does not exist.
  //
  // Now: short threads render whole, long ones still collapse so a card with
  // twenty-nine notes does not become a wall. The truck case is preserved;
  // the conversation case is fixed.
  const displayNotes = maxNotes
    ? ordered.slice(0, maxNotes)
    : (showAllNotes ? ordered : ordered.slice(0, THREAD_LIMIT));

  // Compact mode: just show note count + quick add
  if (compact && !expanded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'none', border: '1px solid #334155', borderRadius: '6px',
            color: notes.length > 0 ? '#00c8e8' : '#64748b',
            padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}
        >
          📝 {notes.length > 0 ? `${notes.length} note${notes.length > 1 ? 's' : ''}` : 'Add note'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#1a2332', borderRadius: '10px', padding: '12px', border: '1px solid #1e293b' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Notes ({notes.length})
        </span>
        {compact && (
          <button
            onClick={() => setExpanded(false)}
            style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Quick add */}
      {newNote.trim() && (
        <div style={{ display: 'flex', gap: '5px', marginBottom: '6px' }}>
          {[
            { v: 'note', label: '📝 Note' },
            { v: 'response', label: '💬 Response' },
            { v: 'customer_only', label: '🗒️ Customer note (no job)' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setNoteType(opt.v)}
              style={{
                fontSize: '11px', fontWeight: 700, padding: '5px 9px', borderRadius: '14px', cursor: 'pointer',
                border: `1px solid ${noteType === opt.v ? '#00c8e8' : '#334155'}`,
                background: noteType === opt.v ? '#00c8e820' : 'transparent',
                color: noteType === opt.v ? '#00c8e8' : '#94a3b8',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginBottom: notes.length > 0 ? '10px' : '0' }}>
        <input
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddNote()}
          placeholder="Add a note..."
          style={{
            flex: 1, background: '#0f1729', border: '1px solid #334155', borderRadius: '8px',
            color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', outline: 'none'
          }}
        />
        <button
          onClick={handleAddNote}
          disabled={!newNote.trim() || isSaving}
          style={{
            background: newNote.trim() ? '#00c8e8' : '#334155',
            color: newNote.trim() ? '#000' : '#64748b',
            border: 'none', borderRadius: '8px', padding: '8px 14px',
            fontSize: '13px', fontWeight: '600', cursor: newNote.trim() ? 'pointer' : 'default',
            opacity: isSaving ? 0.5 : 1
          }}
        >
          {isSaving ? '...' : '+'}
        </button>
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div style={{ color: '#cbd5e1', fontSize: '12px', textAlign: 'center', padding: '8px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {displayNotes.map(note => (
            <div key={note.id} style={{
              background: '#0f1729', borderRadius: '8px', padding: '8px 10px',
              border: note.from_status !== note.to_status ? '1px solid #334155' : '1px solid transparent'
            }}>
              {/* Status change indicator */}
              {note.from_status && note.to_status && note.from_status !== note.to_status && (
                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ color: STATUS_INFO[note.from_status]?.color }}>{STATUS_INFO[note.from_status]?.label}</span>
                  <span>→</span>
                  <span style={{ color: STATUS_INFO[note.to_status]?.color }}>{STATUS_INFO[note.to_status]?.label}</span>
                </div>
              )}

              {editingId === note.id ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditSave(note)}
                    style={{
                      flex: 1, background: '#1a2332', border: '1px solid #00c8e8', borderRadius: '6px',
                      color: '#e2e8f0', padding: '6px 8px', fontSize: '12px', outline: 'none'
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => handleEditSave(note)}
                    style={{ background: '#00c8e8', color: '#000', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
                  >✓</button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                  >×</button>
                </div>
              ) : (
                <>
                  <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.4' }}>{note.text}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      {formatAuthor(note.created_by)} · {formatTime(note.created_at)}
                    </span>
                    {note.editable && (
                      <button
                        onClick={() => { setEditingId(note.id); setEditText(note.text); }}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}
                      >
                        edit
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          {maxNotes && notes.length > maxNotes && (
            <div style={{ color: '#94a3b8', fontSize: '11px', textAlign: 'center', padding: '4px' }}>
              +{notes.length - maxNotes} more
            </div>
          )}

          {/* Only offer the control when something is actually hidden. Below
              THREAD_LIMIT the whole thread is already on screen, so a button
              saying "show 2 earlier notes" next to two visible notes is a lie.
              Given contrast and a filled background because the borderless
              grey version was, demonstrably, not being pressed. */}
          {!maxNotes && ordered.length > THREAD_LIMIT && (
            <button onClick={() => setShowAllNotes(v => !v)}
              style={{ width: '100%', background: '#1e293b', border: '1px solid #334155',
                       borderRadius: 8, color: '#cbd5e1', fontSize: '12px', fontWeight: 700,
                       padding: '10px 0', cursor: 'pointer', marginTop: 6, fontFamily: 'inherit' }}>
              {showAllNotes
                ? '▴ Show recent only'
                : `▾ Show ${ordered.length - THREAD_LIMIT} older note${ordered.length - THREAD_LIMIT === 1 ? '' : 's'}`}
            </button>
          )}

          {/* Audit trail, collapsed. Still here, just not shouting over notes. */}
          {activity.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowActivity(v => !v)}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px',
                         cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit' }}>
                {showActivity ? '▾' : '▸'} Activity ({activity.length})
              </button>
              {showActivity && activity.map(a => (
                <div key={a.id || a.text}
                  style={{ fontSize: '11px', color: '#64748b', padding: '4px 0 4px 10px',
                           borderLeft: '2px solid #1e293b', lineHeight: 1.4 }}>
                  {a.text}
                  <span style={{ opacity: 0.7 }}> · {formatTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
