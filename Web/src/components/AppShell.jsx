import { useVault } from '../context/VaultContext';
import { Paladin } from './Paladin';
import { ThemeToggle } from './ThemeToggle';
import { Icon } from './Icon';
import { vaultHealth } from '../lib/health';
import { usePix } from '../context/PixContext';

const TABS = [
  ['vault', 'VAULT'],
  ['generator', 'GENERATOR'],
  ['settings', 'SETTINGS']
];

/**
 * @param view      which tab is active — 'vault' | 'generator' | 'settings'
 * @param onNavigate(view)
 * @param pixSays   short shout beside the wordmark ('SEALED.', 'GOT IT.')
 *                  Not wired to anything yet; the moments come later.
 */
export function AppShell({ children, view = 'vault', onNavigate }) {
  const { lock, items } = useVault();
  const { pose, says } = usePix();

  // Derived from the vault itself, never passed in — a hardcoded
  // default meant this read 100% regardless of what was stored.
  const health = vaultHealth(items);

  return (
    // Column flex with the main growing: the footer sits at the
    // bottom of the viewport on a short page and below the content
    // on a long one, rather than floating mid-screen.
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        // Sticks below the demo banner when there is one. The variable
        // is 0px otherwise, which is the original behaviour.
        position: 'sticky', top: 'var(--demo-banner-h, 0px)', zIndex: 40,
        background: 'var(--surface)', borderBottom: '1px solid var(--edge)'
      }}>
        {/* This row needs 986px before anything gives. That is more
            than a tablet has, so it starts wrapping at 1024 rather
            than at the mobile breakpoint — the header is the one
            thing here that breaks above 640. */}
        <div className="vk-r-shell-wrap vk-r-pad" style={{
          maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 64,
          display: 'flex', alignItems: 'center', gap: 32
        }}>
          {/* PIX + wordmark. vk-r-brand lets this group wrap at <=640
              so PIX's line can take a row of its own beneath the
              wordmark; above that breakpoint it does not wrap and the
              line sits inline exactly as before. */}
          <div className="vk-r-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Paladin pose={pose} size={32} />
            {/* A button, not an anchor: navigation here is App's `view`
                state, not a URL, so an <a href> would reload the page and
                drop the DEK — locking the vault as a side effect of
                clicking the logo. Same mechanism as the tabs below, and
                a native button also gets keyboard focus and the same
                focus ring they do for free.

                Padding, border and background are reset so the wordmark
                renders exactly as it did as a span. Only cursor and the
                hover fade are new, and both live in theme.css so they do
                not have to fight an inline style.

                THE INNER SPAN IS NOT DECORATION. This button is a flex
                container — inline-flex here, and computed `flex`,
                because it is itself a flex item of vk-r-brand above, so
                it gets blockified. Without the wrapper its two children
                become two separate flex items: an anonymous one holding
                "CITADEL " and the green span. The space then sits at the
                END OF A LINE inside that anonymous item, where white
                space is dropped before layout — so the header rendered
                CITADELZERO while Signup and Unlock, which are ordinary
                block divs, rendered CITADEL ZERO.

                Measured at 1440: the text box was 91px and is 104px, the
                difference being one 13px advance (12px glyph + 1px of
                letter-spacing). At <=640 theme.css drops this to
                10px/letter-spacing:0 and the pair is 70px and 80px.

                The wrapper is one flex item establishing its own inline
                formatting context, so the space is interior text rather
                than end-of-line, at every scale and whatever the parent's
                display mode. Moving the space into the green span does
                NOT work: leading white space at the start of a line is
                dropped too, which is why the pre-rename Unlock form
                would have failed here as well.

                whiteSpace: 'nowrap' IS LOAD-BEARING. The wrapper lowers
                this button's min-content width from the whole wordmark
                to "CITADEL", so a squeezed header could break the name
                across two lines — something today's two separate flex
                items cannot do. Nothing observed wraps at 320 or 375;
                this keeps a guarantee the wrapper would otherwise give
                away. */}
            <button
              type="button"
              onClick={() => onNavigate('vault')}
              aria-label="Citadel Zero, go to vault"
              className="vk-r-wordmark vk-wordmark-link"
              style={{
                background: 'none', border: 'none', padding: 0, margin: 0,
                display: 'inline-flex', alignItems: 'center',
                fontFamily: "'Press Start 2P', monospace", fontSize: 12,
                letterSpacing: 1, color: 'var(--text)',
                whiteSpace: 'nowrap'
              }}
            >
              <span>CITADEL <span style={{ color: 'var(--green)' }}>ZERO</span></span>
            </button>
            {/* PIX's line carries NO hide utility, and must not.

                It used to carry vk-r-hide-sm — display:none at <=640 —
                which meant SEALED!, REMOVED. and GOT IT. rendered
                nowhere on a phone. Saving an entry, deleting one and
                copying a password each produced no visible feedback at
                all, and ItemDetail closing on save looks identical to
                pressing Escape.

                It now takes its own row here instead of being hidden.
                Inside this header, so it inherits the sticky offset
                against --demo-banner-h and nothing new is fixed —
                nothing can end up over the banner.

                The row is NOT reserved. The header grows for the 1.5–2.5
                seconds a moment is live and shrinks back, which shifts
                the content below by about one line. Reserving it
                permanently would cost that space on every mobile screen
                for something visible a few seconds a session. */}
            {says && (
              <span className="vk-r-pix-line" style={{
                font: "500 10px 'Geist Mono', monospace", letterSpacing: '.12em',
                color: 'var(--muted)', whiteSpace: 'nowrap', animation: 'riseIn .25s both'
              }}>
                {says}
              </span>
            )}
          </div>

          {/* primary navigation — replaces the gear button and the
              FORGE button that used to sit beside the vault search */}
          <nav className="vk-r-nav" style={{ display: 'flex', gap: 8, height: '100%' }}>
            {TABS.map(([key, label]) => (
              <Tab key={key} label={label} active={view === key} onClick={() => onNavigate(key)} />
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* vault health HUD — 7x8 segments, smaller than the Meter
              used elsewhere, so it sits inside a 64px bar.

              NO hide utility here either, for the same reason as PIX's
              line above. It carried vk-r-hide-md — display:none at
              <=1024 — on the grounds that it is "a readout and the same
              number is on the vault screen itself." That was not true:
              vaultHealth has exactly one call site, this one, and the
              Vault screen shows per-item meters, which are a different
              quantity. So the average was unreachable on every tablet
              and every phone, which is the whole of the interface below
              1025px.

              Showing it costs nothing between 768 and 1024 — the header
              already stands at 112px and stays there — and one wrapped
              row lower down: measured 121px -> 205px at 375, and
              121px -> 165px at 320. It fits at 320 with no horizontal
              overflow at any width. */}
          {health !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} title="Average password strength across your vault">
            <span style={{ font: "600 10px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
              VAULT
            </span>
            <div style={{ display: 'flex', gap: 2 }}>
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} style={{
                  width: 7, height: 8, borderRadius: 1,
                  background: i < health ? healthColor(health) : 'var(--edge)',
                  transition: 'background .3s'
                }} />
              ))}
            </div>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: healthColor(health) }}>
              {health * 10}%
            </span>
          </div>
          )}

          <ThemeToggle />

          <button
            onClick={lock}
            className="vk-r-touch"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              font: "600 12px Geist, sans-serif", letterSpacing: '.1em',
              padding: '9px 16px', borderRadius: 'var(--radius)',
              border: '1px solid var(--edge)', background: 'transparent',
              color: 'var(--text)', cursor: 'pointer', boxShadow: '0 2px 0 var(--edge)'
            }}
          >
            <Icon name="lock" /> LOCK
          </button>
        </div>
      </header>

      <main className="vk-r-pad" style={{ flex: 1, width: '100%', maxWidth: 1120, margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>

      <footer className="vk-noprint vk-r-wrap vk-r-pad" style={{
        maxWidth: 1120, margin: '0 auto', padding: '24px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderTop: '1px solid var(--edge)',
        font: "500 11px 'Geist Mono', monospace",
        letterSpacing: '.12em', color: 'var(--muted)'
      }}>
        <span>CITADEL ZERO</span>
        <span style={{ opacity: .4 }}>·</span>
        <span>BUILT BY UMER SALEH</span>
        <div style={{ flex: 1 }} />
        <a
          href="https://github.com/Umer-Saleh/Citadel-Zero"
          target="_blank" rel="noreferrer"
          style={{ color: 'var(--muted)', textDecoration: 'none' }}
        >
          SOURCE
        </a>
      </footer>
    </div>
  );
}

/**
 * The active tab is marked with an inset bottom shadow rather than a
 * border, so switching tabs doesn't shift the text by 2px.
 */
function Tab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        font: '600 13px Geist, sans-serif', letterSpacing: '.08em',
        background: 'none', border: 'none', cursor: 'pointer', padding: '0 12px',
        color: active ? 'var(--text)' : 'var(--muted)',
        boxShadow: active ? 'inset 0 -2px 0 var(--green)' : 'none',
        transition: 'color .15s'
      }}
    >
      {label}
    </button>
  );
}

// Same thresholds calcStrength uses per item, so the HUD and the row
// meters can't disagree about what counts as weak.
function healthColor(h) {
  return h < 4 ? 'var(--red)' : h < 7 ? 'var(--amber)' : 'var(--green)';
}
