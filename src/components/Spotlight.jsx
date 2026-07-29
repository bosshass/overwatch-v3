// ============================================
// Spotlight — a real walkthrough, not a mockup of one.
// ============================================
// Tour.jsx (the existing help modal) shows illustrated mock-ups of the screen
// inside a popup. That's fine as a "here's roughly what things look like"
// primer, but it never points at the actual button — you read a picture of a
// button, then go find the real one yourself.
//
// This is the other kind: the real screen dims, a hole is cut exactly over
// the real element, and an arrow-tipped card sits next to it with the
// explanation. What you're looking at IS the thing you're about to click.
//
// USAGE
//   Add data-tour="some-key" to any real element anywhere in the app.
//   <Spotlight steps={[{ target: 'some-key', title: '...', body: '...' }]}
//              onDone={() => setShow(false)} />
//   That's the whole integration cost — no refs, no wiring back through
//   parent components. Reusable on any screen by tagging elements and
//   building a steps array; Board is the first screen to use it because
//   every operator lands there now.

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';

const PAD = 6; // breathing room between the highlighted element and the cut

export default function Spotlight({ steps, onDone, onSkip }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [missing, setMissing] = useState(false);
  const step = steps[i];
  const settleTimer = useRef(null);

  // THE BUG: this used to call scrollIntoView() from BOTH the step-change
  // effect AND the scroll listener — and the listener was capture-phase on
  // window, which also catches the Board's own internal horizontal column
  // scroll, not just page scroll. So: scroll into view → that scroll event
  // fires → handler calls scrollIntoView again → which scrolls → which fires
  // again. Any attempt to scroll manually got immediately yanked back, which
  // is exactly "scroll only lets you go one way." Overlapping setTimeouts
  // from repeated calls could also land after the step had already changed,
  // painting a rect for the wrong element — the "box disappears."
  //
  // FIX: only the step-change effect is allowed to call scrollIntoView, and
  // only once. The scroll/resize listener now ONLY re-reads position to keep
  // the highlight glued to the element — it never scrolls anything itself.
  const measure = useCallback((doScroll) => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setMissing(true); setRect(null); return; }
    setMissing(false);

    const apply = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    if (doScroll) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(apply, 260);
    } else {
      apply();
    }
  }, [step]);

  useLayoutEffect(() => {
    measure(true);
    return () => { if (settleTimer.current) clearTimeout(settleTimer.current); };
  }, [measure]);

  useEffect(() => {
    // Track-only — never triggers a scroll of its own, so a manual scroll
    // (including the Board's own horizontal column scroll) is never fought.
    const onTrack = () => measure(false);
    window.addEventListener('resize', onTrack);
    window.addEventListener('scroll', onTrack, true);
    return () => {
      window.removeEventListener('resize', onTrack);
      window.removeEventListener('scroll', onTrack, true);
    };
  }, [measure]);

  // Esc always exits — a tutorial that traps you is worse than no tutorial.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (onSkip || onDone)?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone, onSkip]);

  if (!step) return null;

  const next = () => { if (i < steps.length - 1) setI(i + 1); else onDone?.(); };
  const back = () => setI(m => Math.max(0, m - 1));

  const R = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  // Card placement: prefer below the target, flip above if there's no room,
  // clamp horizontally so it never runs off a narrow (mobile) screen.
  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(320, vw - 32);
  let cardTop, cardLeft;
  if (R) {
    const spaceBelow = vh - (R.top + R.height);
    const below = spaceBelow > 160 || R.top < 160;
    cardTop = below ? R.top + R.height + 14 : Math.max(16, R.top - 14 - 180);
    cardLeft = Math.min(Math.max(16, R.left), vw - cardW - 16);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000 }}>
      {/* Four-band dim + block-clicks mask. Leaves the target rect completely
          uncovered — no overlay there at all — so it's the real button,
          fully clickable, not a picture of one sitting under a layer. */}
      {R ? (
        <>
          <Band style={{ top: 0, left: 0, right: 0, height: Math.max(0, R.top) }} />
          <Band style={{ top: R.top + R.height, left: 0, right: 0, bottom: 0 }} />
          <Band style={{ top: R.top, left: 0, width: Math.max(0, R.left), height: R.height }} />
          <Band style={{ top: R.top, left: R.left + R.width, right: 0, height: R.height }} />
          {/* Glow ring around the hole so the target reads as "highlighted"
              rather than just "the one gap in the fog". */}
          <div style={{
            position: 'fixed', top: R.top, left: R.left, width: R.width, height: R.height,
            borderRadius: 10, boxShadow: '0 0 0 3px #00c8e8, 0 0 22px 4px #00c8e888',
            pointerEvents: 'none', transition: 'all 0.25s ease',
          }} />
        </>
      ) : (
        <Band style={{ inset: 0 }} />
      )}

      {/* The card. Positioned near the target with a small arrow tip pointing
          at it — this is the "arrow at the real button" ask, not a caption
          floating unrelated to anything. */}
      <div style={{
        position: 'fixed',
        top: R ? cardTop : '50%', left: R ? cardLeft : '50%',
        transform: R ? 'none' : 'translate(-50%, -50%)',
        width: cardW, background: '#0f1729', border: '1px solid #00c8e8',
        borderRadius: 14, padding: '16px 18px', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        color: '#e2e8f0', transition: 'top 0.25s ease, left 0.25s ease',
      }}>
        <div style={{ fontSize: 10, color: '#00c8e8', fontWeight: 800, letterSpacing: 0.5,
                      textTransform: 'uppercase', marginBottom: 6 }}>
          Step {i + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 14 }}>
          {missing
            ? "Can't find that on screen right now — skipping ahead is fine."
            : step.body}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {i > 0 && (
            <button onClick={back}
              style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                       borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              ← Back
            </button>
          )}
          <button onClick={onSkip || onDone}
            style={{ background: 'transparent', border: 'none', color: '#64748b',
                     fontSize: 12, cursor: 'pointer', padding: '8px 6px' }}>
            Skip
          </button>
          <button onClick={next}
            style={{ marginLeft: 'auto', background: '#00c8e8', border: 'none', color: '#08121f',
                     borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {i < steps.length - 1 ? 'Next →' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Band({ style }) {
  return (
    <div style={{
      position: 'fixed', background: 'rgba(3,8,16,0.72)', pointerEvents: 'auto',
      transition: 'all 0.25s ease', ...style,
    }} />
  );
}
