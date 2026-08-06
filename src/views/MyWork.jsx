import { useState, useEffect, useCallback } from 'react';
import { fetchMyDay, addNote, fetchNotes, dispositionsFor, reviewStates } from '../services/jobs';
import { supabase } from '../services/supabaseClient';
import { fetchEvents, localDay } from '../services/calendar';
import FinishSheet from './FinishSheet';
import MaterialsSheet from './MaterialsSheet';
import MyHours from './MyHours';

// ============================================================================
// MyWork — what one tech is doing today, and everything they need to do it.
//
// One screen, one job at a time: see the day, tap the stop, call the customer,
// get directions, leave a note, declare disposition. Nothing about the board,
// nothing about billing, nothing about other people's work.
//
// DRIVEN BY ASSIGNMENTS, NOT CALENDAR EVENTS. techs.calendar_id in this data is
// a shared team calendar — Tech One and Tech Two point at the same one — so an
// event cannot tell you whose work it is. job_assignments can. Calendar events
// for the day are shown underneath as context (meetings, internal time, things
// booked outside Overwatch) and are explicitly not actionable.
//
// OPERATOR MODE: if the signed-in email is not in the techs table, this becomes
// a picker over techs. Sara signs in as info@drhsecurityservices.com while the
// techs are separate accounts — without this the screen would just be empty for
// the person most likely to be looking at it.
//
// Mobile first. This is the one screen used one-handed in a truck.
// ============================================================================

export default function MyWork({ actor }) {
  const [techs, setTechs] = useState([]);
  const [techId, setTechId] = useState(null);
  const [isOperatorMode, setIsOperatorMode] = useState(false);

  const [day, setDay] = useState(() => localDay(new Date()));
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [openStop, setOpenStop] = useState(null);
  const [finishStop, setFinishStop] = useState(null);
  const [materialsJob, setMaterialsJob] = useState(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  // assignmentId -> what was declared. A stop that has one cannot declare again.
  const [declared, setDeclared] = useState({});
  const [reviews, setReviews] = useState({});

  // ── The tail ─────────────────────────────────────────────────────────────
  // Work does not end when the tech taps Done. Hours get entered later, often
  // in batch; materials get remembered in the truck; and the office may kick
  // something back. Those are open items on jobs that have already moved on,
  // so they cannot live in the day's stop list — a job finished on Monday is
  // not on Thursday's screen, but its missing materials still are.
  const [attention, setAttention] = useState([]);

  const [events, setEvents] = useState([]);
  const [calNote, setCalNote] = useState(null);

  // ── Who am I ─────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('techs').select('*').eq('is_active', true).order('display_order')
      .then(({ data }) => {
        const list = data || [];
        setTechs(list);
        const me = list.find(
          t => t.email && actor && t.email.toLowerCase() === String(actor).toLowerCase()
        );
        if (me) { setTechId(me.id); setIsOperatorMode(false); }
        else { setIsOperatorMode(true); setTechId(list[0]?.id || null); }
      });
  }, [actor]);

  const tech = techs.find(t => t.id === techId) || null;

  // ── The day's work ───────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!techId) return;
    setLoading(true); setErr(null);
    try {
      const list = await fetchMyDay(techId, day);
      setStops(list);
      const aIds = list.map(s2 => s2.id);
      const [d, r] = await Promise.all([dispositionsFor(aIds), reviewStates(aIds)]);
      setDeclared(d); setReviews(r);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [techId, day]);

  useEffect(() => { load(); }, [load]);

  const loadAttention = useCallback(async () => {
    if (!techId) { setAttention([]); return; }

    // Jobs this tech has closed out in the last two weeks. Older than that and
    // nobody is going to reconstruct it accurately anyway.
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: mine } = await supabase
      .from('job_assignments')
      .select(`
        id, job_id, scheduled_for,
        job:jobs (
          id, status, materials_none_at, updated_at,
          customer:customers ( id, name )
        )
      `)
      .eq('tech_id', techId)
      .eq('is_complete', true)
      .gte('updated_at', since);

    const trips = (mine || []).filter(a => a.job);
    if (!trips.length) { setAttention([]); return; }
    const ids = [...new Set(trips.map(a => a.job_id))];

    // Materials are a JOB fact — what went into the building. Hours are a TRIP
    // fact — two visits are two numbers. Asking "does this job have hours" is
    // what made Monday's entry clear Friday's warning, so time is matched on
    // assignment_id and materials on job_id. The mismatch is the point.
    const [{ data: mats }, { data: times }, reviews] = await Promise.all([
      supabase.from('job_materials').select('job_id').in('job_id', ids),
      supabase.from('time_entries').select('assignment_id')
        .in('assignment_id', trips.map(a => a.id)),
      reviewStates(trips.map(a => a.id)),
    ]);
    const hasMat  = new Set((mats  || []).map(r => r.job_id));
    const hasTime = new Set((times || []).map(r => r.assignment_id));

    const items = [];
    const seenJob = new Set();

    for (const a of trips) {
      const j = a.job;
      const name = j.customer?.name || 'Customer';

      // Per trip.
      if (!hasTime.has(a.id)) {
        const when = a.scheduled_for
          ? new Date(a.scheduled_for).toLocaleDateString(
              undefined, { weekday: 'short', month: 'short', day: 'numeric' })
          : null;
        items.push({ key: `time-${a.id}`, kind: 'time', job: j,
                     label: 'Time not entered',
                     detail: when ? `${name} · ${when}` : name });
      }

      // Changes requested is per VISIT — the office sent back one trip, not
      // the whole job, and the tech needs to know which.
      if (reviews[a.id]?.state === 'changes') {
        items.push({ key: `chg-${a.id}`, kind: 'changes', job: j,
                     label: 'Changes requested',
                     detail: reviews[a.id].note
                       ? `${name} — ${reviews[a.id].note}` : name });
      }

      // Per job — a job with three trips should not raise the same materials
      // warning three times.
      if (seenJob.has(j.id)) continue;
      seenJob.add(j.id);
      if (!hasMat.has(j.id) && !j.materials_none_at) {
        items.push({ key: `mat-${j.id}`, kind: 'materials', job: j,
                     label: 'Materials not logged', detail: name });
      }
    }
    setAttention(items);
  }, [techId]);

  useEffect(() => { loadAttention(); }, [loadAttention]);

  // Calendar context for the same day, from this tech's calendar.
  useEffect(() => {
    if (!tech?.calendar_id) { setEvents([]); return; }
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    fetchEvents({ from, to, calendars: [tech.calendar_id] }).then(r => {
      setEvents(r.events);
      setCalNote(r.authExpired ? 'Google session expired — calendar not shown.'
                : r.errors.length ? r.errors.join(' · ')
                : null);
    });
  }, [tech, day]);

  const shiftDay = n => {
    const d = new Date(`${day}T00:00:00`);
    d.setDate(d.getDate() + n);
    setDay(localDay(d));
  };

  const isToday = day === localDay(new Date());
  const dayLabel = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const done = stops.filter(s => s.is_complete).length;
  const hours = stops.reduce((n, s) => n + (Number(s.estimated_hours) || 0), 0);

  return (
    <div className="ow-full" style={S.wrap}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={S.head}>
        <div>
          <div style={S.who}>
            {tech
              ? <><span style={{ ...S.dot, background: tech.color || '#64748b' }} />{tech.name}</>
              : 'No tech selected'}
          </div>
          <div style={S.dayLine}>
            {dayLabel}{isToday && <span style={S.todayTag}>today</span>}
          </div>
        </div>
        <div style={S.headRight}>
          <button style={S.hoursBtn} onClick={() => setHoursOpen(true)}>My hours</button>
          <div style={S.dayNav}>
            <button style={S.navBtn} onClick={() => shiftDay(-1)}>‹</button>
            <button style={S.navBtn} onClick={() => setDay(localDay(new Date()))}>today</button>
            <button style={S.navBtn} onClick={() => shiftDay(1)}>›</button>
          </div>
        </div>
      </div>

      {isOperatorMode && (
        <div style={S.opBar}>
          <span style={S.opLabel}>Viewing as</span>
          <div style={S.opTechs}>
            {techs.map(t => (
              <button
                key={t.id}
                onClick={() => setTechId(t.id)}
                style={{ ...S.opTech, ...(t.id === techId ? S.opTechOn : {}) }}
              >
                <span style={{ ...S.dot, background: t.color || '#64748b' }} />
                {t.name}
              </button>
            ))}
          </div>
          <div style={S.opNote}>
            You are not in the techs table, so this is the operator view. A tech
            signing in with their own account lands straight on their own day.
          </div>
        </div>
      )}

      {err && <div style={S.err}>{err}</div>}

      {/* ── Needs your attention ────────────────────────────────────────
          The paperwork tail from jobs already dispositioned. Every row names
          the job — a bare count tells a tech there is a problem without
          telling them where it is. */}
      {attention.length > 0 && (
        <div style={S.attnWrap}>
          <div style={S.attnHead}>Needs your attention</div>
          {attention.map(it => (
            <button
              key={it.key}
              style={S.attn}
              onClick={() => {
                if (it.kind === 'materials') setMaterialsJob(it.job);
                else if (it.kind === 'time') setHoursOpen(true);
                else if (it.kind === 'changes') setOpenStop(
                  stops.find(s => s.job?.id === it.job.id) || null
                );
              }}
            >
              <span style={{ ...S.attnDot, background: ATTN_TINT[it.kind] }} />
              <span style={S.attnText}>
                <span style={S.attnLabel}>{it.label}</span>
                <span style={S.attnDetail}>{it.detail}</span>
              </span>
              <span style={S.attnChev}>›</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      {!loading && stops.length > 0 && (
        <div style={S.summary}>
          {stops.length} stop{stops.length === 1 ? '' : 's'} · {hours}h booked
          {done > 0 && ` · ${done} done`}
        </div>
      )}

      {/* ── Stops ───────────────────────────────────────────────────────── */}
      {loading
        ? <div style={S.msg}>Loading…</div>
        : stops.length === 0
          ? <div style={S.emptyCard}>
              Nothing booked for {isToday ? 'today' : 'this day'}.
              {isOperatorMode && ' Try another tech or another day.'}
            </div>
          : (
            <div style={S.list}>
              {stops.map(s => {
                const j = s.job || {};
                const c = j.customer || {};
                const when = s.scheduled_for
                  ? new Date(s.scheduled_for).toLocaleTimeString(undefined,
                      { hour: 'numeric', minute: '2-digit' })
                  : null;
                return (
                  <button
                    key={s.id}
                    onClick={() => setOpenStop(s)}
                    style={{ ...S.stop, ...(s.is_complete ? S.stopDone : {}) }}
                  >
                    <div style={S.stopTop}>
                      <span style={S.time}>{when || '—'}</span>
                      {s.estimated_hours != null && (
                        <span style={S.hrs}>{s.estimated_hours}h</span>
                      )}
                      {s.is_complete && <span style={S.doneTag}>done</span>}
                      {j.priority && j.priority !== 'normal' && (
                        <span style={S.pri}>{j.priority}</span>
                      )}
                    </div>
                    <div style={S.cust}>{c.name || 'No customer'}</div>
                    <div style={S.issue}>{j.issue || 'No description'}</div>
                    {c.address && (
                      <div style={S.addr}>
                        {c.address}{c.city ? `, ${c.city}` : ''}
                      </div>
                    )}
                    {s.day_number > 1 && <div style={S.dayTag}>day {s.day_number}</div>}
                  </button>
                );
              })}
            </div>
          )}

      {/* ── Calendar context ────────────────────────────────────────────── */}
      <div style={S.calHead}>Also on the calendar</div>
      {calNote
        ? <div style={S.calNote}>{calNote}</div>
        : events.length === 0
          ? <div style={S.calNote}>Nothing else on this calendar today.</div>
          : (
            <div style={S.evList}>
              {events.map(e => (
                <div key={e.id} style={S.ev}>
                  <span style={S.evTime}>
                    {e.allDay
                      ? 'all day'
                      : new Date(e.start).toLocaleTimeString(undefined,
                          { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span style={S.evTitle}>{e.title}</span>
                  <span style={S.evCal}>{e.calendarName}</span>
                </div>
              ))}
              <div style={S.calFoot}>
                Context only — these are not assignments and cannot be finished
                here. This is a shared team calendar, not one person's.
              </div>
            </div>
          )}

      {openStop && (
        <StopSheet
          stop={openStop}
          actor={actor}
          declared={declared[openStop.id] || null}
          reviewState={reviews[openStop.id]?.state || null}
          onClose={() => setOpenStop(null)}
          onFinish={() => { const s = openStop; setOpenStop(null); setFinishStop(s); }}
        />
      )}

      {materialsJob && (
        <MaterialsSheet
          job={materialsJob}
          actor={actor}
          techId={techId}
          onClose={() => setMaterialsJob(null)}
          onSaved={loadAttention}
        />
      )}

      {hoursOpen && (
        <MyHours
          tech={tech}
          actor={actor}
          onClose={() => setHoursOpen(false)}
          onSaved={loadAttention}
        />
      )}

      {finishStop && (
        <FinishSheet
          job={{
            ...finishStop.job,
            assignments: [{
              id: finishStop.id,
              tech_id: finishStop.tech_id,
              day_number: finishStop.day_number,
              estimated_hours: finishStop.estimated_hours,
              is_complete: finishStop.is_complete,
              tech,
            }],
          }}
          actor={actor}
          onClose={() => setFinishStop(null)}
          onFinished={() => { setFinishStop(null); load(); loadAttention(); }}
        />
      )}
    </div>
  );
}

// "info@drhsecurityservices.com" eats a whole line on a phone. Who wrote it is
// what matters; the domain is the same for everyone.
const shortName = who => String(who || 'system').split('@')[0];

// ============================================================================
// StopSheet — one stop. Call, directions, notes, disposition.
// ============================================================================
const DECLARED_WORD = {
  finished:  'Work completed',
  return:    'Return visit',
  estimate:  'Estimate needed',
  unable:    'Unable to complete',
  cancelled: 'Cancelled / no access',
};

function StopSheet({ stop, actor, declared, reviewState, onClose, onFinish }) {
  const job = stop.job || {};
  // The office sending THIS VISIT back is the only route to declaring twice.
  const c = job.customer || {};

  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Notes come from `notes` and are notes — no filtering needed. Status moves
  // ("Created", "scheduled → new", "Booked 1 tech for …") stay in job_history
  // where Accounting can read them, and a tech standing at a door never has to
  // scroll past them.
  const reload = useCallback(() => {
    fetchNotes(job.id)
      .then(rows => setNotes(rows || []))
      .catch(e => setErr(e.message));
  }, [job.id]);

  useEffect(() => { reload(); }, [reload]);

  const fullAddress = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  const telHref = c.phone ? `tel:${String(c.phone).replace(/[^\d+]/g, '')}` : null;
  // Apple Maps and Google Maps both honour this; the OS picks the installed app.
  const mapHref = fullAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`
    : null;


  return (
    <div style={T.backdrop} onClick={onClose}>
      <div style={T.sheet} onClick={e => e.stopPropagation()}>
        <div style={T.grab} />

        <div style={T.head}>
          <div>
            <div style={T.cust}>{c.name || 'No customer'}</div>
            {c.id && <span style={T.code}>{c.id}</span>}
            {c.cs_number && <span style={T.code}>CS {c.cs_number}</span>}
          </div>
          <button style={T.x} onClick={onClose}>✕</button>
        </div>

        {/* The work itself, not a footnote under the customer name. This is the
            one thing the tech is here to read. */}
        <div style={T.issueBox}>
          {job.issue
            ? <div style={T.issueText}>{job.issue}</div>
            : <div style={T.issueNone}>No description on this ticket</div>}
          <div style={T.issueMeta}>
            {job.priority && job.priority !== 'normal' && (
              <span style={T.issuePri}>{job.priority}</span>
            )}
            {job.due_date && <span>due {job.due_date}</span>}
          </div>
        </div>

        {fullAddress && <div style={T.addr}>{fullAddress}</div>}

        {/* ── The two things needed standing in a driveway ──────────────── */}
        <div style={T.actions}>
          {telHref
            ? <a href={telHref} style={{ ...T.action, ...T.call }}>Call {c.phone}</a>
            : <span style={{ ...T.action, ...T.actionOff }}>No phone on file</span>}
          {mapHref
            ? <a href={mapHref} target="_blank" rel="noreferrer"
                 style={{ ...T.action, ...T.nav }}>Directions</a>
            : <span style={{ ...T.action, ...T.actionOff }}>No address on file</span>}
        </div>

        <div style={T.meta}>
          {stop.estimated_hours != null && <span>{stop.estimated_hours}h booked</span>}
          {stop.day_number > 1 && <span>day {stop.day_number}</span>}
          {stop.is_complete && <span style={T.done}>already marked done</span>}
        </div>

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <div style={T.sectionHead}>Notes</div>
        {err && <div style={T.err}>{err}</div>}


        <textarea
          style={T.textarea} rows={2}
          placeholder="Gate code 4417. Dog in the back yard."
          value={draft} onChange={e => setDraft(e.target.value)}
        />
        <button
          style={{ ...T.save, ...(draft.trim() ? {} : T.saveOff) }}
          disabled={saving || !draft.trim()}
          onClick={async () => {
            setSaving(true); setErr(null);
            const res = await addNote(job, draft, actor);
            setSaving(false);
            if (!res.ok) { setErr(res.reason); return; }
            setDraft(''); reload();
          }}
        >
          {saving ? 'Saving…' : 'Add note'}
        </button>

        <div style={T.feed}>
          {notes.length === 0
            ? <div style={T.none}>No notes on this job yet.</div>
            : notes.map(n => (
                <div key={n.id} style={T.note}>
                  <div style={T.noteBody}>{n.body}</div>
                  <div style={T.noteMeta}>
                    {shortName(n.author_email)} ·{' '}
                    {new Date(n.created_at).toLocaleString(undefined,
                      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              ))}
        </div>

        {/* ── Disposition ──────────────────────────────────────────────────
            ONE per visit. Declaring twice wrote two disposition entries and
            two status moves for the same trip, and the card only ever showed
            the last — so the first quietly stopped existing.

            The way back is the office asking for changes, not the tech
            declaring over the top of himself. */}
        {declared && reviewState !== 'changes' ? (
          <>
            <div style={T.declared}>
              <div style={T.declaredWord}>
                {DECLARED_WORD[declared.disposition] || declared.disposition}
              </div>
              <div style={T.declaredMeta}>
                {shortName(declared.by)} ·{' '}
                {new Date(declared.at).toLocaleString(undefined,
                  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <div style={T.foot}>
              This visit is already closed out. If it needs changing, the office
              can send it back — you'll see it in Needs your attention.
            </div>
          </>
        ) : (
          <>
            <button style={T.finish} onClick={onFinish}>
              {declared ? 'Redo disposition' : 'Declare disposition'}
            </button>
            <div style={T.foot}>
              {declared
                ? 'The office asked for changes on this one. Declaring again replaces what was recorded.'
                : 'Finished, or needs another trip. Hours are entered later, in My hours.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ATTN_TINT = {
  materials: '#d97706',
  time:      '#3b82f6',
  changes:   '#dc2626',
};

const S = {
  attnWrap: { margin: '14px 0 4px', background: '#0f1b2e', border: '1px solid #1e293b',
              borderRadius: 12, overflow: 'hidden' },
  attnHead: { color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: '12px 14px 8px' },
  attn: { width: '100%', display: 'flex', alignItems: 'center', gap: 11,
          background: 'transparent', border: 0, borderTop: '1px solid #16233a',
          padding: '12px 14px', cursor: 'pointer', textAlign: 'left' },
  attnDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  attnText: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  attnLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: 600 },
  attnDetail: { color: '#64748b', fontSize: 12 },
  attnChev: { color: '#475569', fontSize: 16 },

  wrap: { padding: 14, background: '#0b1220', maxWidth: 560, margin: '0 auto' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  who: { color: '#f1f5f9', fontSize: 17, fontWeight: 700,
         display: 'flex', alignItems: 'center', gap: 7 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  dayLine: { color: '#94a3b8', fontSize: 13, marginTop: 3,
             display: 'flex', alignItems: 'center', gap: 7 },
  todayTag: { background: '#14b8a6', color: '#04201d', fontSize: 9, fontWeight: 800,
              padding: '1px 5px', borderRadius: 4 },
  headRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  hoursBtn: { background: '#111c2e', color: '#94a3b8', border: '1px solid #1e293b',
              borderRadius: 7, padding: '5px 11px', fontSize: 12, cursor: 'pointer' },
  dayNav: { display: 'flex', gap: 4, flexShrink: 0 },
  navBtn: { background: '#1e293b', color: '#cbd5e1', border: 0, borderRadius: 6,
            padding: '6px 11px', fontSize: 13, cursor: 'pointer' },

  opBar: { background: '#111c2e', border: '1px solid #1e293b', borderRadius: 10,
           padding: 10, marginTop: 12 },
  opLabel: { color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5 },
  opTechs: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  opTech: { display: 'flex', alignItems: 'center', gap: 6, background: '#0b1220',
            border: '1px solid #1e293b', borderRadius: 8, padding: '6px 10px',
            color: '#cbd5e1', fontSize: 13, cursor: 'pointer' },
  opTechOn: { borderColor: '#3b82f6', background: '#132038' },
  opNote: { color: '#475569', fontSize: 10, marginTop: 7, lineHeight: 1.4 },

  err: { background: '#7f1d1d', color: '#fecaca', padding: '9px 12px', borderRadius: 8,
         marginTop: 12, fontSize: 13 },
  summary: { color: '#94a3b8', fontSize: 12, marginTop: 14 },
  msg: { color: '#94a3b8', padding: '24px 0' },
  emptyCard: { background: '#111c2e', borderRadius: 10, padding: 18, marginTop: 14,
               color: '#64748b', fontSize: 13, lineHeight: 1.5 },

  list: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 },
  stop: { background: '#111c2e', border: '1px solid #1e293b', borderRadius: 10,
          padding: 12, textAlign: 'left', cursor: 'pointer', display: 'block', width: '100%' },
  stopDone: { opacity: .6 },
  stopTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  time: { color: '#f1f5f9', fontSize: 15, fontWeight: 800 },
  hrs: { color: '#94a3b8', fontSize: 11 },
  doneTag: { color: '#14b8a6', fontSize: 10, fontWeight: 700 },
  pri: { background: '#7f1d1d', color: '#fecaca', fontSize: 9, fontWeight: 800,
         padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase' },
  cust: { color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginTop: 5 },
  issue: { color: '#cbd5e1', fontSize: 14, fontWeight: 500, marginTop: 4, lineHeight: 1.4 },
  addr: { color: '#64748b', fontSize: 11, marginTop: 4 },
  dayTag: { color: '#64748b', fontSize: 10, marginTop: 3 },

  calHead: { color: '#64748b', fontSize: 10, textTransform: 'uppercase',
             letterSpacing: .5, marginTop: 22, marginBottom: 7 },
  calNote: { color: '#475569', fontSize: 11, lineHeight: 1.45 },
  evList: { display: 'flex', flexDirection: 'column', gap: 4 },
  ev: { display: 'flex', gap: 8, alignItems: 'baseline', background: '#0f1929',
        borderRadius: 6, padding: '6px 9px' },
  evTime: { color: '#64748b', fontSize: 10, minWidth: 52, flexShrink: 0 },
  evTitle: { color: '#94a3b8', fontSize: 12, flex: 1 },
  evCal: { color: '#475569', fontSize: 9 },
  calFoot: { color: '#334155', fontSize: 10, marginTop: 6, lineHeight: 1.4 },
};

const T = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 65,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { background: '#111c2e', borderRadius: '18px 18px 0 0', padding: '10px 16px 24px',
           width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto' },
  grab: { width: 38, height: 4, borderRadius: 2, background: '#334155',
          margin: '0 auto 12px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cust: { color: '#f1f5f9', fontSize: 18, fontWeight: 700 },
  code: { color: '#64748b', fontSize: 10, marginRight: 8 },
  x: { background: 'transparent', border: 0, color: '#64748b', fontSize: 18, cursor: 'pointer' },
  issueBox: { background: '#0b1220', borderLeft: '3px solid #3b82f6',
              borderRadius: '4px 8px 8px 4px', padding: '12px 14px', marginTop: 12 },
  issueText: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  issueNone: { color: '#64748b', fontSize: 14, fontStyle: 'italic' },
  issueMeta: { display: 'flex', gap: 10, marginTop: 8, color: '#64748b', fontSize: 11,
               flexWrap: 'wrap', alignItems: 'center' },
  issuePri: { background: '#7f1d1d', color: '#fecaca', fontSize: 9, fontWeight: 800,
              padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' },
  addr: { color: '#64748b', fontSize: 12, marginTop: 10 },

  actions: { display: 'flex', gap: 8, marginTop: 14 },
  action: { flex: 1, textAlign: 'center', borderRadius: 10, padding: '13px 8px',
            fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'block' },
  call: { background: '#14b8a6', color: '#04201d' },
  nav: { background: '#3b82f6', color: '#fff' },
  actionOff: { background: '#1e293b', color: '#64748b', fontWeight: 400, fontSize: 12,
               paddingTop: 16 },

  meta: { display: 'flex', gap: 12, color: '#64748b', fontSize: 11, marginTop: 12,
          flexWrap: 'wrap' },
  done: { color: '#14b8a6' },

  sectionHead: { color: '#64748b', fontSize: 10, textTransform: 'uppercase',
                 letterSpacing: .5, marginTop: 22, marginBottom: 8 },
  err: { background: '#7f1d1d', color: '#fecaca', padding: '8px 11px', borderRadius: 8,
         marginBottom: 8, fontSize: 12 },
  textarea: { width: '100%', background: '#0b1220', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 8, padding: '9px 10px',
              fontSize: 14, resize: 'vertical', fontFamily: 'inherit' },
  save: { width: '100%', marginTop: 7, background: '#1e293b', color: '#cbd5e1', border: 0,
          borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  saveOff: { opacity: .5, cursor: 'not-allowed' },

  feed: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 },
  none: { color: '#475569', fontSize: 12 },
  note: { background: '#0b1220', borderRadius: 8, padding: '9px 11px' },
  noteMeta: { color: '#475569', fontSize: 10, marginTop: 5 },
  noteBody: { color: '#e2e8f0', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' },

  declared: { background: '#122a2c', border: '1px solid #14b8a6', borderRadius: 10,
              padding: '14px 16px', marginTop: 4 },
  declaredWord: { color: '#7fd8cd', fontSize: 15, fontWeight: 700 },
  declaredMeta: { color: '#64748b', fontSize: 12, marginTop: 4 },
  finish: { width: '100%', marginTop: 22, background: '#14b8a6', color: '#04201d', border: 0,
            borderRadius: 10, padding: '14px', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  foot: { color: '#475569', fontSize: 10, marginTop: 9, lineHeight: 1.45 },
};
