import { useState, useRef, useEffect } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button, DeriveBar } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { usePix } from '../context/PixContext';
import { DEMO_MODE, DEMO_EMAIL, DEMO_PASSWORD } from '../lib/demo';

export function Unlock({ onUnlocked, onGoSignup, onGoRecovery }) {
  const { login } = useVault();
  const { pose: pixPose, says: pixSays } = usePix();

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  // Revealed only after the server tells us this account has 2FA on.
  // Showing it to everyone would be noise; asking up front would need
  // an extra round trip before the user has typed anything.
  const [needsCode, setNeedsCode] = useState(false);
  const codeRef = useRef(null);

  // 'form' | 'deriving' | 'granted'
  const [phase, setPhase] = useState('form');

  // Move focus to the code field the moment it appears, so the user
  // can type straight from their phone without reaching for the mouse.
  useEffect(() => {
    if (needsCode) codeRef.current?.focus();
  }, [needsCode]);

  async function handleUnlock() {
    setError('');
    if (!email || !pw) return setError('Enter your email and master password.');
    if (needsCode && !code) return setError('Enter the code from your authenticator app.');

    setPhase('deriving');
    try {
      const result = await login(email, pw, code || undefined);   // real Argon2id runs here
      setPhase('granted');
      // brief beat on the triumphant "gate" pose before entering
      setTimeout(() => onUnlocked(result), 700);
    } catch (e) {
      setPhase('form');

      if (e.code === 'TOTP_REQUIRED') {
        // Thrown client-side before deriving. Not an error the user
        // caused — just the next step.
        setNeedsCode(true);
        return;
      }

      setError(
        e.code === 'INVALID_CREDENTIALS'
          // The server deliberately can't tell us WHICH was wrong —
          // saying "the code was wrong" would confirm the password
          // is live. So the message covers both.
          ? (needsCode
              ? 'Wrong password or code. Codes expire every 30 seconds — try the current one.'
              : 'Wrong email or master password.')
        : e.code === 'NOT_FOUND' ? 'No vault found for that email.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Could not unlock${e.code ? ` (${e.code})` : ''}.`
      );

      // A used code can never work again, so clear it rather than
      // letting the user retry the same six digits.
      setCode('');
    }
  }

  const onEnter = e => e.key === 'Enter' && handleUnlock();

  return (
    <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both'
        }}>
          {/* channel while deriving, gate on success. Otherwise defer
              to PIX's context pose — so arriving here straight after
              a lock shows him standing guard for a beat, which is the
              moment the header can't display because it unmounts. */}
          <Paladin
            pose={
              phase === 'deriving' ? 'channel'
              : phase === 'granted' ? 'gate'
              : pixPose === 'guard' ? 'guard'
              : 'idle'
            }
            size={72}
            ring={phase === 'deriving' ? 0.7 : null}
          />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 21, letterSpacing: 2, color: 'var(--text)' }}>
            CITADEL<span style={{ color: 'var(--green)' }}> ZERO</span>
          </div>
          <div style={{ font: "500 12px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--muted)' }}>
            ZERO-KNOWLEDGE VAULT
          </div>

          {/* PIX's line, shown here because the header that normally
              carries it unmounts the instant the vault locks. */}
          {phase === 'form' && pixSays && (
            <div style={{
              font: "500 11px 'Geist Mono', monospace", letterSpacing: '.16em',
              color: 'var(--green)', animation: 'riseIn .25s both'
            }}>
              {pixSays}
            </div>
          )}

        </div>

        {phase === 'form' && (
          <Card style={{
            display: 'flex', flexDirection: 'column', gap: 20,
            animation: 'riseIn .5s cubic-bezier(.2,.9,.3,1) both',
            animationDelay: '.12s'
          }}>
            <Input
              label="Email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={onEnter}
            />
            <Input
              label="Master password" revealable mono
              placeholder="············"
              value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={onEnter}
            />

            {needsCode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'riseIn .3s cubic-bezier(.2,.9,.3,1) both' }}>
                <Input
                  ref={codeRef}
                  label="Authenticator code" mono
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  // Strip spaces and dashes as they type — people copy
                  // backup codes off paper with separators.
                  onChange={e => setCode(e.target.value.replace(/[\s-]/g, ''))}
                  onKeyDown={onEnter}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty' }}>
                  Six digits from your authenticator app, or one of your backup codes.
                </span>
              </div>
            )}

            {/* Demo credentials. Not a secret by any reading — this
                account's password is published in the README and on
                this screen, which is the point of it. Renders nothing
                on a normal build. */}
            {DEMO_MODE && DEMO_EMAIL && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: 14, borderRadius: 'var(--radius)',
                border: '1px dashed var(--amber)',
                background: 'color-mix(in srgb, var(--amber) 8%, transparent)'
              }}>
                <span style={{
                  font: "600 10px 'Geist Mono', monospace",
                  letterSpacing: '.16em', color: 'var(--amber)'
                }}>
                  DEMO ACCOUNT
                </span>
                <div style={{ font: "500 12px 'Geist Mono', monospace", color: 'var(--text)', wordBreak: 'break-all' }}>
                  {DEMO_EMAIL}<br />{DEMO_PASSWORD}
                </div>
                <button
                  type="button"
                  onClick={() => { setEmail(DEMO_EMAIL); setPw(DEMO_PASSWORD); }}
                  style={{
                    alignSelf: 'flex-start',
                    font: "600 11px 'Geist Mono', monospace", letterSpacing: '.12em',
                    padding: '7px 12px', borderRadius: 'var(--radius)',
                    border: '1px solid var(--edge)', background: 'transparent',
                    color: 'var(--text)', cursor: 'pointer'
                  }}
                >
                  USE THESE
                </button>
                <span style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty' }}>
                  Its vault entries are fake. Everything in it was encrypted by a
                  client that derived the same key from the password above — the
                  server has never held it.
                </span>
              </div>
            )}

            {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

            <Button onClick={handleUnlock} style={{ padding: '14px 24px', letterSpacing: '.12em' }}>
              UNLOCK
            </Button>

            <div style={{ textAlign: 'center', fontSize: 13 }}>
              <a href="#" onClick={e => { e.preventDefault(); onGoRecovery(); }} style={{ color: 'var(--green)' }}>
                Forgot master password? Recover with your kit
              </a>
            </div>
          </Card>
        )}

        {phase !== 'form' && (
          <Card style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
            padding: '40px 32px', textAlign: 'center',
            // Starts at 400ms so ACCESS GRANTED is legible first, and
            // finishes as the 700ms handover to the vault fires.
            ...(phase === 'granted' ? { animation: 'handOff .3s ease-in .4s both' } : {})
          }}>
            {phase === 'granted' ? (
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: 'var(--green)', letterSpacing: 1 }}>
                ACCESS GRANTED
              </div>
            ) : (
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, letterSpacing: 1, color: 'var(--text)' }}>
                DECRYPTING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
              </div>
            )}

            <DeriveBar done={phase === 'granted'} />

            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 300, textWrap: 'pretty' }}>
              Deriving your key with Argon2id — the pause is the security working.
            </div>
          </Card>
        )}

        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          New here?{' '}
          <a href="#" onClick={e => { e.preventDefault(); onGoSignup(); }} style={{ color: 'var(--green)' }}>
            Create a vault
          </a>
        </div>
      </div>
    </section>
  );
}