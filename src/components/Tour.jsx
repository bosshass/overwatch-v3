// ============================================
// Tour — first-run walkthrough for this build
// ============================================
// Shana stopped opening the board and went back to a spreadsheet. JR couldn't
// find the rollup he wanted. Neither of those is fixed by shipping features —
// they're fixed by someone being shown, once, where their work now lives.
//
// SHOWN ONCE, PER PERSON, PER BUILD. The key includes the version, so a future
// build with real changes can re-run it deliberately rather than nagging on
// every load. Skipping counts as seeing it; nobody gets asked twice.
//
// Only the people whose day actually changed get it — see TOUR_EMAILS below.
// A tech opening this on a phone between jobs does not need a product tour.

import { useState } from 'react';

export const TOUR_BUILD = '9.9.44';

// info@ is JR's second login, so he gets the tour on whichever he signs in with
// (and only once — the key is per-email, and seeing it on one is enough).
export const TOUR_EMAILS = [
  'shanaparks@drhsecurityservices.com',
  'jr@drhsecurityservices.com',
  'info@drhsecurityservices.com',
];

export function tourKey(email) { return `ow_tour_${TOUR_BUILD}_${(email || '').toLowerCase()}`; }

export function shouldShowTour(email) {
  const e = (email || '').toLowerCase();
  if (!TOUR_EMAILS.includes(e)) return false;
  // The header of this file has always said a tech on a phone between jobs
  // shouldn't get a product tour. Nothing enforced it, so it auto-fired on
  // mobile — where its own footer renders off-screen. Now it's desktop-only
  // on first run; the Help menu can still open it deliberately anywhere.
  try { if (window.innerWidth < 700) return false; } catch { /* SSR */ }
  try { return !localStorage.getItem(tourKey(e)); } catch { return false; }
}

const C = {
  bg: '#0b1220', panel: '#16233a', line: '#2a3b56', text: '#e9f1ff',
  muted: '#93a5bd', cyan: '#00c8e8', green: '#22c55e', amber: '#f59e0b',
  red: '#ef4444', blue: '#3b82f6', purple: '#8b5cf6',
};

// Small inline mock so each step SHOWS the thing instead of describing it.
const Chip = ({ c, children }) => (
  <span style={{ background: `${c}22`, color: c, borderRadius: 20, padding: '3px 9px',
                 fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
);

const Lane = ({ label, color, note }) => (
  <div style={{ flex: 1, minWidth: 90, background: C.bg, border: `1px solid ${C.line}`,
                borderRadius: 10, padding: '9px 10px' }}>
    <div style={{ fontSize: 12, fontWeight: 800, color }}>{label}</div>
    <div style={{ fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.35 }}>{note}</div>
  </div>
);

const STEPS = [
  {
    key: 'intro',
    title: 'A few things moved',
    body: 'This build moves where your work lives and fixes several things that used to fail silently. Two minutes now saves you hunting for it later.',
    visual: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['People', 'who owns what — pick a person, see their work and tasks', C.cyan],
          ['The home screen', 'what is broken, then who is stuck, then the board', C.red],
          ['One scheduler', 'book a tech or hold a slot — same grid, both places', C.amber],
          ['Notes', 'the latest one shows; system chatter is tucked away', C.green],
        ].map(([t, s, c]) => (
          <div key={t} style={{ background: C.bg, borderRadius: 10, padding: '9px 11px', borderLeft: `3px solid ${c}` }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'tasks',
    title: 'People — and the People tab is you',
    body: 'Four lanes. The board is the company\u2019s view of every job; this is only your work. Moving a card here never changes the job on the board.',
    visual: (
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Lane label="To Do" color={C.amber} note="Assigned to you, plus your notes" />
        <Lane label="Doing" color={C.blue} note="Only what you put here" />
        <Lane label="Done" color={C.green} note="Your finished work" />
        <Lane label="Watching" color={C.amber} note="Handed off, but you still need to know" />
      </div>
    ),
    cta: { label: 'Open People', path: '/people' },
  },
  {
    key: 'inbox',
    title: 'Three ways work reaches you',
    body: 'Nothing appears in your To Do by accident. It gets there because someone put it there \u2014 including you.',
    visual: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[
          ['Assigned on the board', 'Open a job \u2192 tap your name under "assign to"'],
          ['+ Add work', 'In People. Shows every open job nobody has claimed \u2014 tap "I\u2019ll take it"'],
          ['\u{1F441} Watch this', 'On any job. Puts it in your Watching lane without making it yours'],
        ].map(([t, s]) => (
          <div key={t} style={{ background: C.bg, borderRadius: 10, padding: '9px 11px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.cyan }}>{t}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{s}</div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45 }}>
          Hand something off and it moves to <b style={{ color: C.amber }}>Watching</b> \u2014 you stop
          owning the next step, but the card still shows you when the status moves.
        </div>
      </div>
    ),
  },
  {
    key: 'dispositions',
    title: 'Dispositions \u2014 how a job closes',
    body: 'When a tech finishes on site, they pick one of four. This is what actually moves a job off the board, and what decides whether the hours ever reach an invoice.',
    visual: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          ['\u2705 Done \u2014 bill it', 'Work is finished. Hours land in Billing as ready to invoice.', C.green],
          ['\u{1F504} Return visit', 'Needs another trip. Creates the return card automatically.', C.amber],
          ['\u{1F6E0}\uFE0F In progress', 'Multi-day job, not finished. Hours logged, job stays open.', C.cyan],
          ['\u{1F4B0} Needs estimate', 'Scope changed. Goes to the estimate pipeline instead of billing.', C.purple],
        ].map(([t, s, c]) => (
          <div key={t} style={{ background: C.bg, borderRadius: 10, padding: '9px 11px', borderLeft: `3px solid ${c}` }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{t}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{s}</div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.45, marginTop: 2 }}>
          A job with no disposition is invisible to billing. That is the single most
          expensive thing that goes wrong here.
        </div>
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45 }}>
          From the office side: open any ticket and it asks
          <b style={{ color: C.text }}> "What's next for this ticket?"</b> with the moves
          available from where it is now. Notes sit right underneath — the latest one
          shows, older ones are one tap away.
        </div>
      </div>
    ),
  },
  {
    key: 'warning',
    title: 'The red banner \u2014 fix these first',
    body: 'These are calendar events somebody made by hand. Overwatch never created them, so nobody will ever disposition them, so they will never produce a time entry or an invoice. The work happened. It just won\u2019t get billed.',
    visual: (
      <div>
        <div style={{ background: 'linear-gradient(160deg,#4a0f0f,#2a0808)', border: `2px solid ${C.red}`,
                      borderRadius: 14, padding: '14px 16px', marginBottom: 11 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', color: '#ffb3ba', textTransform: 'uppercase' }}>
            Not in Overwatch \u2014 will not bill
          </div>
          <div style={{ fontSize: 40, fontWeight: 900, color: C.red, lineHeight: 1, marginTop: 8 }}>12</div>
          <div style={{ fontSize: 11, color: '#ffb3ba', marginTop: 3 }}>calendar events made by hand</div>
        </div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
          Tap it. You land on the open list. For each one: pick the client, then
          <b style={{ color: C.green }}> Create job &amp; link \u2192</b>. That makes a real job card,
          keeps the calendar event attached, and the count drops by one.
        </div>
      </div>
    ),
    cta: { label: 'Show me the 12', path: '/audit?scan=1' },
  },
  {
    key: 'tent',
    title: 'Holding a slot',
    body: 'Tent is still where you pencil things in. What changed is that Overwatch writes to it, reads from it, and shows the hold on the board.',
    visual: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ background: '#2a1f08', border: `1px solid ${C.amber}55`, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 7 }}>
            \u270F\uFE0F Tentative hold \u2014 no tech booked
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7,
                           padding: '6px 9px', fontSize: 12, color: C.text }}>10:00</span>
            <span style={{ color: C.muted, fontSize: 11 }}>to</span>
            <span style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7,
                           padding: '6px 9px', fontSize: 12, color: C.text }}>13:00</span>
          </div>
          <div style={{ background: C.amber, color: '#0f1729', borderRadius: 7, padding: '7px 0',
                        fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
            Hold Wed Aug 5 \u00b7 10:00\u201313:00
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
          Set real hours, not the whole day. It writes <b>Holding {'{customer}'}</b> to the Tent
          calendar \u2014 your existing convention \u2014 and the job moves into the board's
          <b style={{ color: C.amber }}> Tentative</b> column showing the held date.
        </div>
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45 }}>
          A hold books nobody. Scheduling it for real later clears the hold automatically,
          so a card is never both held and booked.
        </div>
      </div>
    ),
  },
  {
    key: 'scheduling',
    title: 'Scheduling \u2014 and the suggested slot',
    body: 'When you schedule a job, Overwatch now proposes a slot before you pick one.',
    visual: (
      <div>
        <div style={{ background: C.bg, border: `1px solid ${C.cyan}55`, borderRadius: 12, padding: 12, marginBottom: 11 }}>
          <div style={{ color: C.cyan, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Suggested slot
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 5 }}>Austin \u2014 Mon Aug 3</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>8:00 AM \u2013 12:00 PM \u00b7 8h open \u00b7 install \u2192 Monday</div>
          <div style={{ background: C.cyan, color: '#0f1729', borderRadius: 8, padding: '7px 0',
                        fontSize: 12, fontWeight: 700, textAlign: 'center', marginTop: 9 }}>Use this</div>
        </div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
          It reads six weeks of real free time on real calendars. It checks the job has
          enough room, applies the Monday rule for installs, then takes the soonest day
          with the most space left. Pick any day and you'll also see exactly what is
          already on that tech's calendar \u2014 so you can judge whether to move something.
        </div>
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45, marginTop: 8 }}>
          <b style={{ color: C.text }}>Use this</b> fills in the picker below it. It never books
          anything on its own \u2014 you still confirm. And if no suggestion appears, that means
          nothing in the next two weeks has a big enough gap. That\u2019s an answer, not a bug.
        </div>
      </div>
    ),
  },
  {
    key: 'done',
    title: 'That\u2019s it',
    body: 'Every section on the home screen has a \u2753 next to it \u2014 tap one and it opens the instructions for that exact thing, then takes you there. If something here doesn\u2019t match what you actually see on screen, that\u2019s worth telling Sara \u2014 it means the app and the tour disagree, and one of them is wrong.',
    visual: null,
    cta: { label: 'Go to People', path: '/people' },
  },
];

// `startKey` opens the tour at one specific step — used by the ? markers next
// to each section, so help is about the thing you're looking at rather than a
// linear tour you have to sit through to reach the relevant bit. Next/Back
// still work from there; it's a starting point, not a single-card popup.
export default function Tour({ email, onClose, onNavigate, startKey }) {
  const startAt = Math.max(0, STEPS.findIndex(s => s.key === startKey));
  const [i, setI] = useState(startKey ? startAt : 0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = (path) => {
    try { localStorage.setItem(tourKey(email), new Date().toISOString()); } catch { /* private mode */ }
    onClose();
    if (path && onNavigate) onNavigate(path);
  };

  return (
    <div onClick={() => finish(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,16,0.92)', zIndex: 3000,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* maxHeight was 90vh. On mobile Safari vh ignores the browser chrome, so
          the footer holding Skip and Next sat below the fold — a full-screen
          overlay with no reachable way out. dvh tracks the real viewport; the
          ✕ and tap-outside are belt and braces so this can never trap anyone
          again, on any device. */}
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20,
                    width: '100%', maxWidth: 480,
                    maxHeight: '85dvh', display: 'flex',
                    flexDirection: 'column', color: C.text,
                    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif' }}>

        <div style={{ padding: '18px 20px 12px', borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
            {STEPS.map((_, n) => (
              <div key={n} style={{ flex: 1, height: 3, borderRadius: 2,
                                    background: n <= i ? C.cyan : C.line }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, fontSize: 10, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Step {i + 1} of {STEPS.length}
            </div>
            <button onClick={() => finish(null)} aria-label="Close tour"
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22,
                       lineHeight: 1, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{step.title}</div>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: step.visual ? 16 : 0 }}>
            {step.body}
          </div>
          {step.visual}
        </div>

        <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${C.line}`,
                      display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => finish(null)}
            style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12,
                     cursor: 'pointer', fontFamily: 'inherit' }}>
            Skip
          </button>
          <div style={{ flex: 1 }} />
          {i > 0 && (
            <button onClick={() => setI(i - 1)}
              style={{ background: 'transparent', border: `1px solid ${C.line}`, color: C.muted,
                       borderRadius: 10, padding: '9px 15px', fontSize: 13, cursor: 'pointer',
                       fontFamily: 'inherit' }}>Back</button>
          )}
          {step.cta && (
            <button onClick={() => finish(step.cta.path)}
              style={{ background: 'transparent', border: `1px solid ${C.cyan}66`, color: C.cyan,
                       borderRadius: 10, padding: '9px 15px', fontSize: 13, fontWeight: 700,
                       cursor: 'pointer', fontFamily: 'inherit' }}>
              {step.cta.label}
            </button>
          )}
          {!last && (
            <button onClick={() => setI(i + 1)}
              style={{ background: C.cyan, border: 'none', color: '#08121f', borderRadius: 10,
                       padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                       fontFamily: 'inherit' }}>Next</button>
          )}
          {last && !step.cta && (
            <button onClick={() => finish(null)}
              style={{ background: C.cyan, border: 'none', color: '#08121f', borderRadius: 10,
                       padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                       fontFamily: 'inherit' }}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
