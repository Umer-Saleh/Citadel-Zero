import { useState } from 'react';
import * as auth from '../api/auth';
import { Card, Input, Button, Meter, DeriveBar } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { Icon } from '../components/Icon';
import { checkPolicy } from '../lib/policy';

/**
 * Recovery: unwrap the vault with the recovery key, then set a new
 * master password.
 *
 * Three steps rather than one form, because the middle one is where
 * it either works or doesn't — and finding out you mistyped the key
 * AFTER choosing a new password would be a bad place to fail.
 */
export function Recover({ onRecovered, onBack }) {
  // 'email' | 'key' | 'password' | 'working'
  const [phase, setPhase] = useState('email');

  const [email, setEmail] = useState('');
  const [material, setMaterial] = useState(null);
  const [key, setKey] = useState('');
  const [dek, setDek] = useState(null);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [revealed, setRevealed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const policy = checkPolicy(pw, [email]);
  const mismatch = pw2.length > 0 && pw2 !== pw;

  async function findAccount() {
    setError('');
    if (!email) return setError('Enter the email for your vault.');

    setBusy(true);
    try {
      setMaterial(await auth.getRecoveryMaterial(email));
      setPhase('key');
    } catch (e) {
      setError(
        e.code === 'NOT_FOUND' ? 'No vault found for that email.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Could not start recovery${e.code ? ` (${e.code})` : ''}.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function tryKey() {
    setError('');
    if (!key.trim()) return setError('Enter your recovery key.');

    setBusy(true);
    try {
      const recovered = await auth.unwrapWithRecoveryKey(
        key, material.recoverySalt, material.recoveryWrappedDek
      );
      // Success here means GCM authenticated the wrapper — the only
      // check that exists, and a conclusive one. The server never
      // sees the recovery key and cannot verify it.
      setDek(recovered);
      setPhase('password');
    } catch {
      setError('That recovery key does not open this vault. Check for mistyped characters — the key has no I, L, O or U.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setError('');
    if (!policy.passed) return setError('Your new master password does not meet the requirements below.');
    if (pw !== pw2) return setError("The passwords don't match yet.");

    setPhase('working');
    try {
      const { recoveryKey } = await auth.completeRecovery(email, pw, dek);
      // Zero the recovered DEK — the caller re-logs in and derives it
      // again from the new password.
      dek.fill(0);
      onRecovered(recoveryKey, email);
    } catch (e) {
      setPhase('password');
      setError(
        e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Recovery failed${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  const onEnter = (fn) => (e) => e.key === 'Enter' && fn();

  return (
    <section className="vk-r-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      <div className="vk-r-fluid" style={{ width: 460, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 28 }}>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both'
        }}>
          {/* oath, not a celebration. Recovery is a grave moment. */}
          <Paladin pose={phase === 'working' ? 'channel' : 'oath'} size={72}
            ring={phase === 'working' ? 0.7 : null} />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 17, letterSpacing: 2, color: 'var(--text)' }}>
            RECOVERY
          </div>
          <div style={{ font: "500 12px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--muted)' }}>
            STEP {phase === 'email' ? '1' : phase === 'key' ? '2' : '3'} OF 3
          </div>
        </div>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ---- 1. WHICH VAULT ---- */}
          {phase === 'email' && (
            <>
              <div style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
                Your recovery key is the only way back in without your master
                password. We never had a copy of either.
              </div>
              <Input
                label="Email" type="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={onEnter(findAccount)}
              />
              {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
              <Button onClick={findAccount} disabled={busy} style={{ padding: '14px 24px', letterSpacing: '.12em' }}>
                {busy ? 'CHECKING…' : 'CONTINUE'}
              </Button>
            </>
          )}

          {/* ---- 2. THE KEY ---- */}
          {phase === 'key' && (
            <>
              <div style={{ fontSize: 14, color: 'var(--muted)', textWrap: 'pretty' }}>
                Enter the recovery key from your kit. Dashes and capitals don't
                matter.
              </div>
              <Input
                label="Recovery key" mono
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
                value={key} onChange={e => setKey(e.target.value)}
                onKeyDown={onEnter(tryKey)}
                autoComplete="off"
                name="vk-recovery-key"
              />
              {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
              <div className="vk-r-col" style={{ display: 'flex', gap: 12 }}>
                <Button variant="secondary" onClick={() => { setPhase('email'); setError(''); }}
                  style={{ font: '600 12px Geist, sans-serif', padding: '11px 18px' }}>
                  BACK
                </Button>
                <Button onClick={tryKey} disabled={busy} style={{ flex: 1, padding: '12px 24px', letterSpacing: '.12em' }}>
                  {busy ? 'UNLOCKING…' : 'UNLOCK VAULT'}
                </Button>
              </div>
            </>
          )}

          {/* ---- 3. NEW PASSWORD ---- */}
          {phase === 'password' && (
            <>
              <div style={{
                border: '1px solid color-mix(in srgb, var(--green) 55%, var(--edge))',
                borderRadius: 'var(--radius)', padding: '14px 18px',
                display: 'flex', gap: 12, alignItems: 'flex-start'
              }}>
                <span style={{ color: 'var(--green)', marginTop: 2 }}><Icon name="check" size={16} /></span>
                <div style={{ fontSize: 14, textWrap: 'pretty' }}>
                  <strong>Your vault is open.</strong>{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    Choose a new master password. Your entries are never re-encrypted
                    — only the key that wraps them changes.
                  </span>
                </div>
              </div>

              <Input
                label="New master password" mono
                type={revealed ? 'text' : 'password'}
                revealable revealed={revealed}
                onToggleReveal={() => setRevealed(r => !r)}
                placeholder="A long passphrase works best"
                value={pw} onChange={e => setPw(e.target.value)}
                autoComplete="new-password"
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Meter score={policy.strength.score} color={policy.strength.color} />
                  <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: policy.strength.color }}>
                    {policy.strength.label}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {policy.rules.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Icon name={r.ok ? 'check' : 'plus'} size={12}
                        style={{ marginTop: 3, opacity: r.ok ? 1 : 0.4, color: r.ok ? 'var(--green)' : 'var(--muted)' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, color: r.ok ? 'var(--green)' : 'var(--muted)' }}>{r.label}</span>
                        {r.hint && <span style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty' }}>{r.hint}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Input
                label="Confirm new password" mono
                type={revealed ? 'text' : 'password'}
                placeholder="Once more"
                value={pw2} onChange={e => setPw2(e.target.value)}
                onKeyDown={onEnter(finish)}
                autoComplete="new-password"
                error={mismatch ? "Passwords don't match yet." : ''}
              />

              {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

              <Button onClick={finish} style={{ padding: '14px 24px', letterSpacing: '.12em' }}>
                SET NEW PASSWORD
              </Button>
            </>
          )}

          {/* ---- WORKING ---- */}
          {phase === 'working' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '20px 0' }}>
              <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: 'var(--text)' }}>
                RESEALING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
              </span>
              <DeriveBar />
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 320, textAlign: 'center', textWrap: 'pretty' }}>
                Re-wrapping your vault key under the new password.
              </div>
            </div>
          )}
        </Card>

        {phase !== 'working' && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Remembered it?{' '}
            <a href="#" onClick={e => { e.preventDefault(); onBack(); }} style={{ color: 'var(--green)' }}>
              Back to unlock
            </a>
          </div>
        )}
      </div>
    </section>
  );
}