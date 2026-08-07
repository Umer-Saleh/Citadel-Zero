import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { Paladin } from './Paladin';
import { Meter } from './ui';

export function AppShell({ children, health = 10, pixPose = 'idle', onOpenSettings }) {
  const { lock } = useVault();
  const { theme, toggle } = useTheme();

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--surface)', borderBottom: '1px solid var(--edge)'
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto', padding: '0 24px', height: 64,
          display: 'flex', alignItems: 'center', gap: 24
        }}>
          {/* PIX + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Paladin pose={pixPose} size={32} />
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, letterSpacing: 1, color: 'var(--text)' }}>
              VAULTKEEP
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* vault health HUD */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} title="Vault health">
            <span style={{ font: "600 10px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
              VAULT
            </span>
            <Meter score={health} max={10} color="var(--green)" />
          </div>

          {/* theme toggle */}
          <button
            onClick={toggle}
            title="Toggle theme"
            style={{
              width: 52, height: 28, border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', cursor: 'pointer', position: 'relative', padding: 0,
              boxShadow: '0 2px 0 var(--edge)'
            }}
          >
            <span style={{
              position: 'absolute', top: 4, left: 4, width: 18, height: 18,
              background: theme === 'dark' ? 'var(--amber)' : 'var(--green)',
              borderRadius: 2,
              transform: theme === 'dark' ? 'translateX(0)' : 'translateX(24px)',
              transition: 'transform .2s, background .2s'
            }} />
          </button>

          {/* settings gear — before the LOCK button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Settings"
              style={{
                width: 40, height: 40, border: '1px solid var(--edge)', borderRadius: 'var(--radius)',
                background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                boxShadow: '0 2px 0 var(--edge)'
              }}
            >
              ⚙
            </button>
          )}

          {/* the always-visible LOCK button */}
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
            🔒 LOCK
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  );
}