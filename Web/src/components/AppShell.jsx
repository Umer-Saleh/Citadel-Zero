import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { Paladin } from './Paladin';
import { Switch } from './ui';
import { Icon } from './Icon';
import { vaultHealth } from '../lib/health';

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
export function AppShell({ children, view = 'vault', onNavigate, pixPose = 'idle', pixSays }) {
  const { lock, items } = useVault();
  const { theme, toggle } = useTheme();

  // Derived from the vault itself, never passed in — a hardcoded
  // default meant this read 100% regardless of what was stored.
  const health = vaultHealth(items);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--surface)', borderBottom: '1px solid var(--edge)'
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 64,
          display: 'flex', alignItems: 'center', gap: 32
        }}>
          {/* PIX + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Paladin pose={pixPose} size={32} />
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, letterSpacing: 1, color: 'var(--text)' }}>
              VAULTKEEP
            </span>
            {pixSays && (
              <span style={{
                font: "500 10px 'Geist Mono', monospace", letterSpacing: '.12em',
                color: 'var(--muted)', whiteSpace: 'nowrap', animation: 'riseIn .25s both'
              }}>
                {pixSays}
              </span>
            )}
          </div>

          {/* primary navigation — replaces the gear button and the
              FORGE button that used to sit beside the vault search */}
          <nav style={{ display: 'flex', gap: 8, height: '100%' }}>
            {TABS.map(([key, label]) => (
              <Tab key={key} label={label} active={view === key} onClick={() => onNavigate(key)} />
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* vault health HUD — 7x8 segments, smaller than the Meter
              used elsewhere, so it sits inside a 64px bar */}
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

          <Switch on={theme === 'dark'} onToggle={toggle} label="Dark theme" />

          <button
            onClick={lock}
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

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
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
