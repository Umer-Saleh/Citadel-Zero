import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { Card, Input, Button, Meter } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { calcStrength } from '../lib/strength';

export function Settings({ onBack }) {
  const { email, kdfUpgradeAvailable, changePassword, upgradeKdf } = useVault();
  const { theme, toggle } = useTheme();

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', font: '500 14px Geist', padding: 0, alignSelf: 'flex-start' }}>
          ← Back to vault
        </button>
      )}

      <h1 style={{ margin: 0, font: '700 24px Geist, sans-serif', color: 'var(--text)' }}>Settings</h1>

      {/* KDF upgrade — only shown when the account's params are stale */}
      {kdfUpgradeAvailable && <KdfUpgrade email={email} upgradeKdf={upgradeKdf} />}

      <ChangePassword email={email} changePassword={changePassword} />

      {/* Preferences */}
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, font: '600 16px Geist, sans-serif', color: 'var(--text)' }}>Preferences</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>Theme</span>
          <Button variant="secondary" onClick={toggle}>{theme === 'dark' ? '🌙 DARK' : '☀ LIGHT'}</Button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Vault auto-locks after 5 minutes of inactivity.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// KDF UPGRADE — the "LEVEL UP" moment. PIX celebrates on success.
// Requires the master password, since we can only re-derive while
// the user proves they hold it.
// ---------------------------------------------------------------
function KdfUpgrade({ email, upgradeKdf }) {
  const [pw, setPw] = useState('');
  const [phase, setPhase] = useState('prompt');   // 'prompt' | 'confirm' | 'working' | 'done'
  const [error, setError] = useState('');

  async function run() {
    setError('');
    if (!pw) return setError('Enter your master password to upgrade.');
    setPhase('working');
    try {
      await upgradeKdf(email, pw);
      setPhase('done');
    } catch (e) {
      setPhase('confirm');
      setError(e.code === 'INVALID_CREDENTIALS' ? 'Wrong master password.' : 'Upgrade failed.');
    }
  }

  return (
    <Card style={{ display: 'flex', gap: 18, alignItems: 'center', border: '1px solid color-mix(in srgb, var(--amber) 45%, var(--edge))' }}>
      <Paladin pose={phase === 'done' ? 'levelup' : 'power'} size={56} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phase === 'done' ? (
          <>
            <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: 'var(--green)' }}>SECURITY UPGRADED</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Your vault now uses stronger key-derivation parameters.</div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: 'var(--amber)' }}>SECURITY UPGRADE AVAILABLE</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Your account was created with weaker key-derivation settings. Upgrade re-secures it with no change to your password.
            </div>
            {phase === 'confirm' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <Input label="Confirm master password" revealable mono value={pw} onChange={e => setPw(e.target.value)} />
                {error && <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>}
                <Button onClick={run}>UPGRADE NOW</Button>
              </div>
            ) : phase === 'working' ? (
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: 'var(--text)' }}>
                UPGRADING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setPhase('confirm')} style={{ alignSelf: 'flex-start' }}>LEVEL UP</Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------
// CHANGE MASTER PASSWORD — re-wraps the DEK, then forces re-login
// (the server revokes all sessions on success).
// ---------------------------------------------------------------
function ChangePassword({ email, changePassword }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const strength = calcStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function run() {
    setError('');
    if (!cur || !next) return setError('Fill in every field.');
    if (next !== confirm) return setError("New passwords don't match.");
    if (strength.score < 4) return setError('Choose a stronger new password.');

    setBusy(true);
    try {
      await changePassword(email, cur, next);
      // changePassword() calls lock() on success → App drops to unlock.
    } catch (e) {
      setBusy(false);
      setError(e.code === 'INVALID_CREDENTIALS' ? 'Current password is wrong.' : 'Could not change password.');
    }
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, font: '600 16px Geist, sans-serif', color: 'var(--text)' }}>Change master password</h2>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>
        You'll be signed out and need to unlock again with the new password.
      </div>

      <Input label="Current password" revealable mono value={cur} onChange={e => setCur(e.target.value)} />
      <Input label="New password" revealable mono value={next} onChange={e => setNext(e.target.value)} />

      {next && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Meter score={strength.score} color={strength.color} />
          <span style={{ font: "600 11px 'Geist Mono', monospace", color: strength.color }}>{strength.label}</span>
        </div>
      )}

      <Input label="Confirm new password" revealable mono value={confirm} onChange={e => setConfirm(e.target.value)}
        error={mismatch ? "Passwords don't match yet." : ''} />

      {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      <Button onClick={run} disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'CHANGING…' : 'CHANGE PASSWORD'}
      </Button>
    </Card>
  );
}