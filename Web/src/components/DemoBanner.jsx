import { useState, useEffect } from 'react';
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

  // The AppShell header is sticky at top: 0. Publishing the banner's
  // height as a CSS variable lets the header stick BELOW it instead of
  // scrolling underneath it. Set on the document element so it applies
  // whether or not the shell is mounted.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--demo-banner-h', visible ? '64px' : '0px');
    return () => root.style.setProperty('--demo-banner-h', '0px');
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="vk-noprint"
      style={{
        position: 'sticky', top: 0, zIndex: 60,
        height: 64, boxSizing: 'border-box',
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

      <div style={{ flex: 1 }} />

      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        aria-label="Dismiss demo warning"
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
