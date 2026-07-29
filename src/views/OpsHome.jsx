// ============================================
// OpsHome — Command home screen
// ============================================
// REBUILT. The old version led with six tiles counting jobs by status —
// Needs Action 10, Ready 12, Returns 4 — which nobody acted on, because a
// count of a status is not a decision. It told you the shape of the queue and
// nothing about whether anyone was moving.
//
// What this answers instead, in order:
//   1. What is BROKEN — work that happened outside Overwatch and will never
//      bill. Loud, first, unmissable.
//   2. Who is stuck — a card per person with their To Do / Doing / Done, and
//      the oldest thing they haven't touched. Staleness, not volume.
//   3. What the board looks like — demoted to one rollup, because the board
//      already exists and doesn't need to be re-summarised six ways.
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, JOB_STATUS } from '../services/supabase.js';
import NewJobModal from '../components/NewJobModal.jsx';
import Spotlight from '../components/Spotlight.jsx';
import { ASSIGNEES, assigneeOf, CLOSED_STATUSES } from '../utils/ownership.js';
import { shortCode } from '../config/appBase.js';
import { scanForOrphans } from '../services/calendarSync.js';

const C = {
  bg:     '#07111f',
  bg2:    '#0b1628',
  panel:  '#101d31',
  panel2: '#14243b',
  card:   '#111f34',
  line:   '#1d2f48',
  line2:  '#263a55',
  text:   '#edf4ff',
  muted:  '#8ea0b8',
  soft:   '#cbd6e6',
  green:  '#22d16f',
  red:    '#ff4f5e',
  blue:   '#4b8dff',
  cyan:   '#16c7df',
  amber:  '#ffb020',
  purple: '#9b6cff',
};

const fmtMoney = n => n >= 1000
  ? `$${(n/1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  : n ? `$${n}` : '';

const KPI_EMAILS = ['sara@jnbllc.com', 'admin@jnbservice.com'];

export default function OpsHome({
  userName, isOperator, accessToken, userEmail,
  onNavigate, onSignOut, onSearch, onShowTour, onBackfill,
}) {
  const [people, setPeople] = useState(null);
  const [board, setBoard] = useState(null);
  // Jobs marked scheduled whose day came and went with nobody dispositioning them.
  const [stranded, setStranded] = useState([]);
  const [gap, setGap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewJob, setShowNewJob] = useState(false);

  const go = path => onNavigate(path);

  // Contextual help marker. Sits next to a section and opens the walkthrough at
  // that section's step, rather than making someone sit through a linear tour
  // to reach the part they're actually looking at.
  const Help = ({ topic, label }) => (
    <button onClick={(e) => { e.stopPropagation(); onShowTour?.(topic); }}
      aria-label={label || 'How this works'} title={label || 'How this works'}
      style={{ width:20, height:20, borderRadius:999, background:'transparent',
               border:`1px solid ${C.line2}`, color:C.muted, fontSize:11, fontWeight:800,
               cursor:'pointer', lineHeight:1, padding:0, flexShrink:0,
               fontFamily:'inherit' }}>?</button>
  );

  // ── Per-person rollup ──────────────────────────────────────────────────
  // Volume is not the signal. Everyone has a pile; what matters is whether the
  // BOTTOM of the pile is moving. So each card leads with counts but is judged
  // on its oldest untouched item — that is the thing quietly rotting, and it is
  // invisible on a board sorted by anything else.
  const loadPeople = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: jobs }, { data: notes }] = await Promise.all([
        supabase.from('jobs')
          .select('id, customer_name, status, assigned_to, tech_name, created_at, updated_at, scheduled_date')
          .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`)
          .limit(1000),
        supabase.from('notes')
          .select('id, body, author_email, lane, created_at, updated_at')
          .limit(1000),
      ]);

      const now = Date.now();
      const daysSince = (iso) => iso ? Math.floor((now - new Date(iso)) / 86400000) : null;

      const rows = ASSIGNEES.map(person => {
        const theirJobs  = (jobs || []).filter(j => assigneeOf(j) === person.name);
        const theirNotes = (notes || []).filter(n => n.author_email === person.email);

        const todo  = theirJobs.length + theirNotes.filter(n => n.lane === 'todo').length;
        const doing = theirNotes.filter(n => n.lane === 'doing').length;
        const done  = theirNotes.filter(n => n.lane === 'done').length;
        const watching = theirNotes.filter(n => n.lane === 'watching').length;

        // Oldest OPEN item by last movement. Done is excluded — a finished
        // thing sitting untouched is finished, not stalled.
        const open = [
          ...theirJobs.map(j => ({ label: j.customer_name || 'Unnamed', at: j.updated_at || j.created_at })),
          ...theirNotes.filter(n => n.lane !== 'done')
                       .map(n => ({ label: (n.body || '').slice(0, 40), at: n.updated_at || n.created_at })),
        ].filter(x => x.at).sort((a, b) => new Date(a.at) - new Date(b.at));

        const oldest = open[0] || null;
        return {
          ...person, todo, doing, done, watching,
          total: todo + doing + done,
          oldest: oldest ? { ...oldest, days: daysSince(oldest.at) } : null,
        };
      })
      // Somebody with nothing at all is noise on this screen.
      .filter(p => p.total > 0)
      // Most stalled first. The point of the screen.
      .sort((a, b) => (b.oldest?.days ?? -1) - (a.oldest?.days ?? -1));

      setPeople(rows);

      // ── Stranded work ──────────────────────────────────────────────────
      // A job marked `scheduled` whose date has passed, or that never got a
      // date at all. The red banner catches work that never entered Overwatch;
      // this is work that entered and then got stuck INSIDE it, which counted
      // as neither. Three jobs and several billable hours were sitting in that
      // blind spot.
      //
      // They're almost certainly showing on Work To Do Today with no note
      // against them — the tech saw the job and never dispositioned it, so the
      // hours never became billable.
      const todayISO = new Date(); todayISO.setHours(0, 0, 0, 0);
      setStranded((jobs || [])
        .filter(j => j.status === 'scheduled')
        .filter(j => !j.scheduled_date || new Date(j.scheduled_date) < todayISO)
        .map(j => ({
          id: j.id,
          name: j.customer_name || 'Unnamed',
          tech: assigneeOf(j),
          date: j.scheduled_date,
          days: j.scheduled_date
            ? Math.floor((todayISO - new Date(j.scheduled_date)) / 86400000)
            : null,
        }))
        .sort((a, b) => (b.days ?? 999) - (a.days ?? 999)));

      const count = (...st) => (jobs || []).filter(j => st.includes(j.status)).length;
      setBoard({
        ready:     count('ready_to_schedule'),
        scheduled: count('scheduled'),
        estimates: count('needs_estimate', 'estimate_sent'),
        returns:   count('return_pending'),
      });
    } catch (e) { console.error('home rollup', e); }
    setLoading(false);
  }, []);

  // ── The gap ────────────────────────────────────────────────────────────
  // Work that HAPPENED but that Overwatch never captured: hand-made calendar
  // events that will never produce a time entry, and jobs with nobody to bill.
  // This is the only thing on this screen that represents money already lost,
  // so it goes first and it is the largest element on the page.
  const loadGap = useCallback(async () => {
    try {
      const { count: orphanJobs } = await supabase
        .from('jobs').select('id', { count: 'exact', head: true })
        .is('customer_id', null)
        .not('status', 'in', `(${CLOSED_STATUSES.join(',')})`);
      let manual = 0;
      if (accessToken) {
        try { manual = ((await scanForOrphans(accessToken)).orphans || []).length; }
        catch (e) { console.warn('orphan scan failed', e); }
      }
      setGap({ manual, orphanJobs: orphanJobs || 0 });
    } catch (e) { console.warn('gap load failed', e); }
  }, [accessToken]);

  const peopleRef = useRef(null);

  // Arriving from the board's "Who's stuck" button lands ON that section
  // instead of at the top of the page above two warning cards.
  useEffect(() => {
    if (loading || !people) return;
    const wants = new URLSearchParams(window.location.search).get('focus');
    if (wants === 'people' && peopleRef.current) {
      peopleRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, people]);

  useEffect(() => { loadPeople(); }, [loadPeople]);
  useEffect(() => { loadGap(); }, [loadGap]);

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
  const hasGap = gap && (gap.manual > 0 || gap.orphanJobs > 0);

  // Days-since colour. Under a week is normal, two weeks is a problem,
  // a month means nobody owns it.
  const staleColor = d => d == null ? C.muted : d >= 30 ? C.red : d >= 14 ? C.amber : d >= 7 ? C.soft : C.muted;

  const HOME_SPOTLIGHT_STEPS = [
    { target: 'home-search', title: 'Search everything',
      body: 'Customer name, job, or CMS number — searches across the whole system, not just what\'s on screen.' },
    { target: 'home-databad', title: 'Work that will never bill',
      body: 'Calendar events nobody turned into a job, and jobs with no client attached. Real work, invisible to billing until someone links it.' },
    { target: 'home-stranded', title: 'Scheduled, then nothing happened',
      body: 'The day came and went with no disposition. These are most likely sitting on Work To Do Today doing nothing.' },
    { target: 'home-people', title: "Who's stuck",
      body: 'Not volume — the OLDEST untouched thing per person. That\'s what\'s quietly rotting.' },
    { target: 'home-admin', title: 'Admin tools',
      body: 'Event Audit, Billing, Weekly Recap, and the tour you\'re on right now — all live here.' },
  ];
  const SPOTLIGHT_BUILD = '9.11.13';
  const spotlightKey = (email) => `ow_home_spotlight_${SPOTLIGHT_BUILD}_${(email || '').toLowerCase()}`;
  const [showSpotlight, setShowSpotlight] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(spotlightKey(userEmail))) setShowSpotlight(true); } catch {}
  }, [userEmail]);
  const closeSpotlight = () => {
    setShowSpotlight(false);
    try { localStorage.setItem(spotlightKey(userEmail), new Date().toISOString()); } catch {}
  };

  return (
    <div style={{ minHeight:'100vh', background: `radial-gradient(circle at top left, #10213c 0%, ${C.bg} 32%, #050912 100%)`, color: C.text, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', display:'flex', flexDirection:'column' }}>

      {/* Sticky header */}
      <div style={{ position:'sticky', top:0, zIndex:10, background:'rgba(7,17,31,0.96)', backdropFilter:'blur(14px)', borderBottom:`1px solid ${C.line}`, padding:'14px 16px 12px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:12, display:'grid', placeItems:'center', background:'#13233b', border:`1px solid #30445f`, color:'#9fd5ff', fontWeight:900, fontSize:13 }}>OW</div>
            <div>
              <div style={{ fontSize:19, fontWeight:700, lineHeight:1 }}>Overwatch</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{today}{userName ? ` · ${userName}` : ''}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setShowSpotlight(true)} title="Show me around"
              style={{ width:38, height:38, borderRadius:13, background:'#00c8e822', border:'1px solid #00c8e8', color:'#00c8e8', fontWeight:900, fontSize:15, cursor:'pointer' }}>▶</button>
            <button onClick={() => { loadPeople(); loadGap(); }}
              style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.text, fontWeight:900, fontSize:16, cursor:'pointer' }}>↻</button>
            {isOperator && (
              <button onClick={onSignOut}
                style={{ width:38, height:38, borderRadius:13, background:'#15243a', border:`1px solid #30445f`, color:C.muted, fontWeight:900, fontSize:13, cursor:'pointer' }}>⏻</button>
            )}
          </div>
        </div>
        <input data-tour="home-search" onClick={onSearch} readOnly placeholder="Search customers, jobs, CMS…"
          style={{ width:'100%', background:'#111f34', border:`1px solid #293d58`, color:'#dbe7f8', borderRadius:15, padding:'11px 13px', fontSize:14, outline:'none', cursor:'pointer', boxSizing:'border-box' }} />
      </div>

      <div style={{ flex:1, overflowY:'auto', paddingBottom:100 }}>

        {showSpotlight && (
          <Spotlight steps={HOME_SPOTLIGHT_STEPS} onDone={closeSpotlight} onSkip={closeSpotlight} />
        )}

        {/* ══ 1. THE WARNING ══ */}
        {hasGap ? (
          <button data-tour="home-databad" onClick={() => go('/audit?scan=1')}
            style={{ display:'block', width:'calc(100% - 32px)', margin:'16px', textAlign:'left',
                     background:'linear-gradient(160deg,#4a0f0f,#2a0808)', border:`2px solid ${C.red}`,
                     borderRadius:22, padding:'22px 22px 20px', cursor:'pointer', color:'#fff',
                     fontFamily:'inherit', boxShadow:'0 10px 40px rgba(255,79,94,0.18)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:14 }}>
              <span style={{ fontSize:22 }}>🚨</span>
              <span style={{ fontSize:13, fontWeight:900, letterSpacing:'0.1em', textTransform:'uppercase', color:'#ffb3ba', flex:1 }}>
                Not in Overwatch — will not bill
              </span>
              <span onClick={(e) => { e.stopPropagation(); onShowTour?.('warning'); }}
                style={{ width:22, height:22, borderRadius:999, border:'1px solid #ffb3ba66',
                         color:'#ffb3ba', fontSize:12, fontWeight:800, display:'grid',
                         placeItems:'center', cursor:'pointer' }}>?</span>
            </div>
            <div style={{ display:'flex', gap:34, flexWrap:'wrap', alignItems:'flex-end' }}>
              {gap.manual > 0 && (
                <div>
                  <div style={{ fontSize:62, fontWeight:900, lineHeight:0.9, color:C.red }}>{gap.manual}</div>
                  <div style={{ fontSize:13, color:'#ffb3ba', marginTop:6 }}>calendar events made by hand</div>
                </div>
              )}
              {gap.orphanJobs > 0 && (
                <div>
                  <div style={{ fontSize:62, fontWeight:900, lineHeight:0.9, color:C.amber }}>{gap.orphanJobs}</div>
                  <div style={{ fontSize:13, color:'#ffd9a0', marginTop:6 }}>jobs with no client</div>
                </div>
              )}
            </div>
            <div style={{ fontSize:13, color:'#ffb3ba', marginTop:16, lineHeight:1.45 }}>
              This work happened. Nobody dispositioned it, so it will never produce a time
              entry or an invoice. <b style={{ color:'#fff' }}>Tap to fix →</b>
            </div>
          </button>
        ) : gap ? (
          <div style={{ margin:'16px', background:C.panel, border:`1px solid ${C.line}`, borderRadius:18, padding:'18px 20px' }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.green }}>✓ Everything is in Overwatch</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>No hand-made calendar events, no jobs without a client.</div>
          </div>
        ) : null}

        {/* ══ 1b. STRANDED — scheduled, date passed, nobody dispositioned ══ */}
        {stranded.length > 0 && (
          <div data-tour="home-stranded" style={{ margin:'14px 16px 0', background:'#2a1f08', border:`1px solid ${C.amber}`,
                        borderRadius:18, padding:'16px 18px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontSize:17 }}>⏰</span>
              <span style={{ fontSize:12, fontWeight:900, letterSpacing:'0.08em',
                             textTransform:'uppercase', color:C.amber }}>
                Scheduled, then nothing happened
              </span>
              <Help topic="dispositions" label="What a disposition does" />
            </div>
            <div style={{ fontSize:12, color:'#fcd9a0', marginBottom:12, lineHeight:1.45 }}>
              The day came and went and nobody dispositioned these. They're most likely still
              sitting on Work To Do Today with no note against them — so any hours worked
              will never reach an invoice.
            </div>
            {stranded.map(j => (
              <button key={j.id} onClick={() => go(`/j/${shortCode(j.id)}?returnTo=${encodeURIComponent('/')}`)}
                style={{ display:'flex', width:'100%', alignItems:'center', gap:10, textAlign:'left',
                         background:'transparent', border:'none', borderTop:`1px solid ${C.amber}33`,
                         padding:'10px 0', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:'block', fontSize:14, fontWeight:700, whiteSpace:'nowrap',
                                 overflow:'hidden', textOverflow:'ellipsis' }}>{j.name}</span>
                  <span style={{ display:'block', fontSize:11, color:C.muted, marginTop:2 }}>
                    {/* Was "{tech} · never given a date" — a name glued directly
                        to a phrase that reads as someone's personal failing.
                        Nobody has a duty called "assign a date" that got
                        skipped; the record just doesn't have one yet. Describe
                        the RECORD's state, not a person's. */}
                    {j.tech || 'no tech'} ·{' '}
                    {j.days == null
                      ? 'no date on record'
                      : `${j.days} day${j.days === 1 ? '' : 's'} since the scheduled date`}
                  </span>
                </span>
                <span style={{ color:'#4a5f7a', fontSize:18 }}>›</span>
              </button>
            ))}
          </div>
        )}

        {/* ══ 2. PEOPLE ══ */}
        <div ref={peopleRef} data-tour="home-people" style={{ padding:'6px 16px 0', scrollMarginTop:90 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
            <span style={{ fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted }}>
              Who's stuck
            </span>
            <Help topic="tasks" label="How My Tasks works" />
          </div>
          {loading && !people ? (
            <div style={{ color:C.muted, fontSize:13, padding:'20px 0' }}>Loading…</div>
          ) : !people || people.length === 0 ? (
            <div style={{ color:C.muted, fontSize:13, padding:'20px 0' }}>Nobody has anything assigned yet.</div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
              {people.map(p => (
                <button key={p.email} onClick={() => go(`/workspace/${p.name.toLowerCase()}`)}
                  style={{ textAlign:'left', background:C.panel, border:`1px solid ${p.oldest?.days >= 14 ? C.amber + '66' : C.line}`,
                           borderRadius:18, padding:'15px 16px', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12 }}>
                    <div style={{ fontSize:17, fontWeight:800 }}>{p.name}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{p.total} item{p.total === 1 ? '' : 's'}</div>
                  </div>

                  <div style={{ display:'flex', gap:14, marginBottom:13 }}>
                    {[['To Do', p.todo, C.amber], ['Doing', p.doing, C.blue], ['Done', p.done, C.green]].map(([l, n, col]) => (
                      <div key={l}>
                        <div style={{ fontSize:24, fontWeight:900, lineHeight:1, color: n ? col : '#33455f' }}>{n}</div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>{l}</div>
                      </div>
                    ))}
                    {p.watching > 0 && (
                      <div>
                        <div style={{ fontSize:24, fontWeight:900, lineHeight:1, color:C.purple }}>{p.watching}</div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>Watching</div>
                      </div>
                    )}
                  </div>

                  {p.oldest ? (
                    <div style={{ borderTop:`1px solid ${C.line}`, paddingTop:10 }}>
                      <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em' }}>Oldest, no movement</div>
                      <div style={{ fontSize:13, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.oldest.label}</div>
                      <div style={{ fontSize:12, fontWeight:800, color:staleColor(p.oldest.days), marginTop:2 }}>
                        {p.oldest.days === 0 ? 'today' : `${p.oldest.days} day${p.oldest.days === 1 ? '' : 's'}`}
                      </div>
                    </div>
                  ) : (
                    <div style={{ borderTop:`1px solid ${C.line}`, paddingTop:10, fontSize:12, color:C.muted }}>Nothing open</div>
                  )}
                </button>
              ))}
            </div>
          )}

          <button onClick={() => go('/people/all')}
            style={{ marginTop:12, width:'100%', background:'transparent', color:C.cyan,
                     border:`1px solid ${C.cyan}44`, borderRadius:14, padding:'11px 0',
                     fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            See everyone's tasks →
          </button>
        </div>

        {/* ══ 3. BOARD ROLLUP ══ */}
        <div style={{ padding:'22px 16px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
            <span style={{ fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted }}>
              The board
            </span>
            <Help topic="dispositions" label="How jobs move and close" />
          </div>
          <button onClick={() => go('/board')}
            style={{ width:'100%', textAlign:'left', background:C.panel, border:`1px solid ${C.line}`,
                     borderRadius:18, padding:'16px 18px', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
            <div style={{ display:'flex', gap:26, flexWrap:'wrap' }}>
              {board && [
                ['Ready to schedule', board.ready, C.green],
                ['Scheduled', board.scheduled, C.blue],
                ['Estimates', board.estimates, C.amber],
                ['Returns', board.returns, C.purple],
                ['No disposition', gap?.manual ?? '—', C.red],
              ].map(([l, n, col]) => (
                <div key={l}>
                  <div style={{ fontSize:28, fontWeight:900, lineHeight:1, color: n ? col : '#33455f' }}>{n}</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:12, color:C.cyan, marginTop:14 }}>Open the board →</div>
          </button>
        </div>

        {/* ══ 4. ADMIN TOOLS ══ */}
        {/* The screens you go to on purpose, not the ones that should be
            shouting at you. Kept off the main flow deliberately — Event Audit
            and Billing are where you go to FIX things, and the warning banner
            above already tells you when that's needed. */}
        {isOperator && (
          <div data-tour="home-admin" style={{ padding:'22px 16px 0' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
              <span style={{ fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:C.muted }}>
                Admin tools
              </span>
              <Help topic="warning" label="What to do with these" />
            </div>
            <div style={{ background:C.panel, border:`1px solid ${C.line}`, borderRadius:18, overflow:'hidden' }}>
              {[
                { path:'/audit?scan=1', icon:'🔍', label:'Event Audit',
                  sub:'Calendar events with no job behind them', badge: gap?.manual || 0, badgeColor: C.red },
                { path:'/customers', icon:'👤', label:'Clients',
                  sub:'Every customer, their history and open work' },
                { path:'/unbilled', icon:'💵', label:'Billing',
                  sub:'Every unbilled hour and material, by customer' },
                { path:'/recap', icon:'📊', label:'Weekly Recap',
                  sub:'Completed jobs, locations visited, who scheduled what' },
                { action:'tour', icon:'🎓', label:'How this works',
                  sub:'Tasks, dispositions, Tent calendar, scheduling' },
                // Bulk rewrite. Lives here, spelled out, instead of as a chain
                // emoji next to the help button on every screen.
                { action:'backfill', icon:'⚠️', label:'Backfill from calendar',
                  sub:'Bulk import — changes many records at once' },
              ].map((t, i) => (
                <button key={t.path || t.action}
                  onClick={() => t.action === 'tour' ? onShowTour?.('intro')
                    : t.action === 'backfill' ? onBackfill?.()
                    : go(t.path)}
                  style={{ display:'flex', width:'100%', alignItems:'center', gap:13, textAlign:'left',
                           background:'transparent', border:'none',
                           borderTop: i ? `1px solid ${C.line}` : 'none',
                           padding:'15px 17px', cursor:'pointer', color:C.text, fontFamily:'inherit' }}>
                  <span style={{ fontSize:20 }}>{t.icon}</span>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ display:'block', fontSize:15, fontWeight:700 }}>{t.label}</span>
                    <span style={{ display:'block', fontSize:12, color:C.muted, marginTop:2 }}>{t.sub}</span>
                  </span>
                  {t.badge > 0 && (
                    <span style={{ background:t.badgeColor, color:'#fff', borderRadius:20,
                                   padding:'2px 9px', fontSize:11, fontWeight:900 }}>{t.badge}</span>
                  )}
                  <span style={{ color:'#4a5f7a', fontSize:20 }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isOperator && (
          <div style={{ padding:'26px 16px 0', textAlign:'center' }}>
            <button onClick={onSignOut} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer' }}>sign out</button>
          </div>
        )}
      </div>

      <button onClick={() => setShowNewJob(true)}
        style={{ position:'fixed', bottom:80, right:20, width:56, height:56, borderRadius:999, background:C.green, border:'none', color:'#04130a', fontSize:28, fontWeight:900, cursor:'pointer', boxShadow:'0 8px 24px rgba(34,209,111,0.35)', zIndex:20, display:'grid', placeItems:'center' }}>
        +
      </button>

      {showNewJob && (
        <NewJobModal accessToken={accessToken} userEmail={userEmail}
          onCreated={() => { setShowNewJob(false); loadPeople(); }}
          onClose={() => setShowNewJob(false)} />
      )}
    </div>
  );
}
