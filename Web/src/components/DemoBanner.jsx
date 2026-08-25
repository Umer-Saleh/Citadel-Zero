import { useState, useEffect, useRef } from 'react';
import { DEMO_MODE } from '../lib/demo';

/**
 * The demo-instance warning.
 *
 * Rendered above everything, on every screen, because it has to reach
 * the pre-auth screens too — Signup, Unlock and Recover render on
 * their own and never mount AppShell, so a banner inside the shell
 * would be invisible at exactly the moment someone is deciding what
 * password to type.
 *
 * Gated on VITE_DEMO_MODE. Vite inlines that at build time, so on a
 * normal build the condition is a literal false and the whole
 * component is dropped by the bundler. Local development renders
 * nothing and is byte-identical to before.
 */

// sessionStorage, deliberately, not localStorage. Dismissing should
// last for the visit, not forever — a reviewer who comes back a week
// later should be told again that this thing wipes itself nightly.
const DISMISS_KEY = 'cz.demo.banner.dismissed';

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(
    () => DEMO_MODE && sessionStorage.getItem(DISMISS_KEY) === '1'
  );

  const visible = DEMO_MODE && !dismissed;

  const barRef = useRef(null);

  // The AppShell header is sticky at top: var(--demo-banner-h), so
  // that variable has to equal the bar's REAL height or the header
  // sits in the wrong place.
  //
  // It used to be the literal '64px', matching a hardcoded height on
  // the element. That agreed with reality only while the text fitted
  // on one line: at 640px the content already needed 70px, and at
  // 320px it needed 231px against a 64px box. The text escaped the
  // bar and ran underneath the header.
  //
  // Measuring instead of asserting removes the class of bug rather
  // than moving the constant. A ResizeObserver catches every cause of
  // a height change — viewport width, font loading, text zoom — and
  // does not need to know which one happened. Nothing here has to be
  // kept in sync with a breakpoint.
  useEffect(() => {
    const root = document.documentElement;

    if (!visible) {
      root.style.setProperty('--demo-banner-h', '0px');
      return;
    }

    const el = barRef.current;
    if (!el) return;

    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      root.style.setProperty('--demo-banner-h', `${h}px`);
    };

    publish();                       // before the first paint after mount

    const ro = new ResizeObserver(publish);
    ro.observe(el);

    // The fonts are self-hosted and load with font-display:swap, so
    // the first layout uses fallback metrics and the text rewraps
    // when the real faces arrive. Measured at 414px that was the
    // difference between a published 148px and an actual 181px — a
    // 33px overlap, and the observer does not reliably fire for it.
    // Re-publishing once the faces are ready closes the gap.
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) publish(); });

    // A rotation changes width without necessarily resizing the
    // element's own box in a way the observer reports first.
    window.addEventListener('resize', publish);
    window.addEventListener('orientationchange', publish);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('orientationchange', publish);
      root.style.setProperty('--demo-banner-h', '0px');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      ref={barRef}
      className="vk-noprint vk-r-banner vk-r-pad"
      style={{
        position: 'sticky', top: 0, zIndex: 60,
        // minHeight, not height. A fixed height cannot contain text
        // that wraps, and this text wraps on every phone.
        minHeight: 64, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 24px',
        background: 'var(--red)',
        color: '#FFF6EE',
        borderBottom: '2px solid rgba(0,0,0,.35)',
        boxShadow: '0 2px 0 var(--shadow)'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: "'Press Start 2P', monospace", fontSize: 12,
          letterSpacing: 1, flexShrink: 0,
          animation: 'kglow 1.6s ease-in-out infinite'
        }}
      >
        ! DEMO
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: "700 13px Geist, sans-serif", letterSpacing: '.02em' }}>
          This is a public demo. Do not store real credentials here.
        </span>
        <span style={{
          font: "500 11px 'Geist Mono', monospace",
          letterSpacing: '.08em', opacity: .92
        }}>
          THE ENTIRE DATABASE IS DELETED AND RESEEDED EVERY DAY AT 03:00 UTC ·
          ANY ACCOUNT YOU CREATE WILL BE GONE
        </span>
      </div>

      <div className="vk-r-hide-sm" style={{ flex: 1 }} />

      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        aria-label="Dismiss demo warning"
        className="vk-r-touch"
        style={{
          flexShrink: 0,
          font: "600 11px 'Geist Mono', monospace", letterSpacing: '.12em',
          padding: '8px 14px', borderRadius: 'var(--radius)',
          border: '1px solid rgba(255,255,255,.55)',
          background: 'transparent', color: 'inherit', cursor: 'pointer'
        }}
      >
        DISMISS
      </button>
    </div>
  );
}
