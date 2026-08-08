import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../context/ThemeContext';
import { Card, Input, Button, Meter, Switch, DeriveBar } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { calcStrength } from '../lib/strength';

export function Settings({ onBack }) {
  const { email, kdfUpgradeAvailable, changePassword, upgradeKdf } = useVault();
  const { theme, toggle } = useTheme();

  return (
    <div style={{
      maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24,
      animation: 'riseIn .4s cubic-bezier(.2,.9,.3,1) both'
    }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', font: '500 14px Geist', padding: 0, alignSelf: 'flex-start' }}>
          ← Back to vault
        </button>
      )}

      <h1 style={{ margin: 0, font: '700 26px Geist, sans-serif', color: 'var(--text)' }}>Account settings</h1>

      {/* KDF upgrade — only shown when the account's params are stale */}
      {kdfUpgradeAvailable && <KdfUpgrade email={email} upgradeKdf={upgradeKdf} />}

      <ChangePassword email={email} changePassword={changePassword} />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h2 style={{ margin: 0, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>Preferences</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 15, flex: 1 }}>Theme</span>
          <span style={{ font: "500 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
            {theme === 'dark' ? 'DARK' : 'LIGHT'}
          </span>
          <Switch on={theme === 'dark'} onToggle={toggle} label="Dark theme" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15 }}>Lock after idle</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              The vault locks itself and the key leaves memory.
            </span>
          </div>
          <span style={{ font: "500 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: 'var(--muted)' }}>
            5 MIN
          </span>
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
      setError(
        e.code === 'INVALID_CREDENTIALS' ? 'Wrong master password.'
        : e.code === 'WEAK_KDF_PARAMS' ? 'The server refused these parameters as too weak. Check DEFAULT_KDF_PARAMS in the client.'
        : e.code === 'VALIDATION_FAILED' ? 'The upgrade request was malformed. This is a bug, not something you did.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        // Surface unmapped codes rather than swallowing them. The
        // backend returns machine-readable codes precisely so this
        // screen doesn't have to guess — throwing them away wastes
        // the design.
        : `Upgrade failed${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  // Banner, not a card: an amber-bordered row that sits above the
  // real settings rather than competing with them.
  return (
    <div style={{
      border: '1px solid color-mix(in srgb, var(--amber) 55%, var(--edge))',
      borderRadius: 'var(--radius)', background: 'var(--surface)',
      padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'center'
    }}>
      <Paladin pose={phase === 'done' ? 'levelup' : 'power'} size={40} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {phase === 'done' ? (
          <>
            <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--green)' }}>
              SECURITY UPGRADED
            </span>
            <span style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
              Your key now uses stronger derivation parameters. Your password and every
              entry are unchanged.
            </span>
          </>
        ) : (
          <>
            <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--amber)' }}>
              SECURITY UPGRADE AVAILABLE
            </span>
            {/* Precise, and true of the implementation: upgrading
                re-wraps the 32-byte key and leaves the vault alone.
                The prototype's "takes about a minute" is not — the
                real derivation is a couple of seconds. */}
            <span style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
              Your account was created with weaker key-derivation settings. Upgrading
              re-wraps your vault key under stronger ones — your password stays the same
              and your entries are never re-encrypted. Takes a few seconds.
            </span>

            {phase === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                <Input label="Confirm master password" mono type="password"
                  value={pw} onChange={e => setPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && run()} />
                {error && <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>}
                <Button onClick={run} style={{ alignSelf: 'flex-start', font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
                  UPGRADE NOW
                </Button>
              </div>
            )}

            {phase === 'working' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: 'var(--text)' }}>
                  UPGRADING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
                </span>
                <DeriveBar />
              </div>
            )}
          </>
        )}
      </div>

      {phase === 'prompt' && (
        <Button variant="secondary" onClick={() => setPhase('confirm')}
          style={{ flexShrink: 0, font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
          UPGRADE
        </Button>
      )}
    </div>
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
    if (busy) return;
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
      setError(
        e.code === 'INVALID_CREDENTIALS' ? 'Current password is wrong.'
        : e.code === 'WEAK_KDF_PARAMS' ? 'The server rejected the proposed key-derivation parameters.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Could not change password${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, font: '600 19px Geist, sans-serif', color: 'var(--text)' }}>Change master password</h2>
      <div style={{ fontSize: 13, color: 'var(--muted)', textWrap: 'pretty' }}>
        Your vault key is re-wrapped under the new password — your entries are never
        re-encrypted. You'll be signed out and need to unlock again.
      </div>

      {/* Reveal is offered on the NEW password only. Current and
          Confirm are retyped from memory; being able to reveal them
          turns the check into a copy-check that catches nothing.
          Same principle as the signup confirm field. */}
      <Input label="Current" mono type="password" value={cur} onChange={e => setCur(e.target.value)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Input label="New" revealable mono value={next} onChange={e => setNext(e.target.value)} />
        <Input label="Confirm" mono type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          error={mismatch ? "Doesn't match yet." : ''} />
      </div>

      {next && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Meter score={strength.score} color={strength.color} />
          <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: strength.color }}>
            {strength.label}
          </span>
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      <div>
        <Button onClick={run} disabled={busy} style={{ padding: '12px 28px', letterSpacing: '.12em' }}>
          {busy ? 'CHANGING…' : 'UPDATE PASSWORD'}
        </Button>
      </div>
    </Card>
  );
}