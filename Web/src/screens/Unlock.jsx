import { useState, useRef, useEffect } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button, DeriveBar } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { usePix } from '../context/PixContext';
import { DEMO_MODE } from '../lib/demo';
import {
  provisionDemoVault, resumeDemoVault, loadDemoCredentials
} from '../lib/provisionDemo';

export function Unlock({ onUnlocked, onGoSignup, onGoRecovery }) {
  const { login, signup, addItem } = useVault();
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

  // 'idle' | 'creating' | 'resuming'. Also the re-entry guard: every
  // demo action returns immediately unless this is 'idle'.
  const [demoBusy, setDemoBusy] = useState('idle');

  // Explains a vault that is gone, rather than surfacing it as a
  // failed login.
  const [demoNotice, setDemoNotice] = useState('');

  // Whether this tab provisioned a vault earlier. A sessionStorage
  // read and nothing else — no request, no derivation. Deliberately
  // computed here rather than in an effect: NOTHING on this screen may
  // touch the network before a click.
  const [hasStoredDemo, setHasStoredDemo] = useState(
    () => (DEMO_MODE ? loadDemoCredentials() !== null : false)
  );

  // ---------------------------------------------------------------
  // Both handlers below are reachable ONLY from an onClick. Neither is
  // called from an effect, a timer, or a render path.
  //
  // That is not tidiness. One provision costs two Argon2id derivations
  // in this browser and three 64 MiB Argon2 operations on a server
  // capped at 640 MB, so anything a crawler could trigger by fetching
  // the page is a denial-of-service hole.
  // ---------------------------------------------------------------

  async function startDemoVault() {
    if (demoBusy !== 'idle') return;

    setError('');
    setDemoNotice('');
    setDemoBusy('creating');

    try {
      await provisionDemoVault({ signup, login, addItem });
      // login() put the DEK in memory, so isUnlocked has already
      // flipped and App is swapping to the vault. The remaining item
      // writes finish against a context that is still mounted.
    } catch (e) {
      setDemoBusy('idle');
      setError(
        e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : e.code === 'TOO_MANY_ATTEMPTS'
          ? 'Too many demo vaults have been created from this network recently. Wait a few minutes and try again.'
        : `Could not create a demo vault${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

  async function resumeDemo() {
    if (demoBusy !== 'idle') return;

    setError('');
    setDemoNotice('');
    setDemoBusy('resuming');

    try {
      const reopened = await resumeDemoVault({ login });

      if (!reopened) {
        // The account is gone — the nightly wipe is the ordinary
        // reason. resumeDemoVault has already dropped the stale
        // credentials. Say what happened plainly and offer a new
        // vault; do NOT create one unasked.
        setHasStoredDemo(false);
        setDemoNotice(
          'The demo vault from earlier in this tab is gone — the whole database is deleted at 03:00 UTC. Start a new one below.'
        );
        setDemoBusy('idle');
      }
    } catch (e) {
      setDemoBusy('idle');
      setError(
        e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : `Could not reopen that demo vault${e.code ? ` (${e.code})` : ''}.`
      );
    }
  }

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
    <section className="vk-r-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      {/* vk-r-fluid drops the fixed 400px on mobile. maxWidth:'100%'
          alone never applied: this is a grid item, and a grid item's
          default min-width:auto sizes the track from the fixed width. */}
      <div className="vk-r-fluid" style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>

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

            {/* Demo vaults. Renders nothing on a normal build:
                DEMO_MODE is a build-time literal, so the bundler drops
                this whole branch and the provisioning module with it.

                There are no published credentials any more. One shared
                account meant every visitor was authenticated AS it and
                could change its password, turn on 2FA and lock out
                everyone after them, or edit what the next visitor saw.
                A private throwaway vault has nothing to take over. */}
            {DEMO_MODE && (
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
                  {hasStoredDemo ? 'DEMO VAULT — THIS TAB' : 'JUST LOOKING?'}
                </span>

                {demoNotice && (
                  <span style={{ fontSize: 12, color: 'var(--amber)', textWrap: 'pretty' }}>
                    {demoNotice}
                  </span>
                )}

                {hasStoredDemo && (
                  <button
                    type="button"
                    onClick={resumeDemo}
                    disabled={demoBusy !== 'idle'}
                    className="vk-r-touch-y"
                    style={demoPrimaryButton(demoBusy !== 'idle')}
                  >
                    {demoBusy === 'resuming' ? 'OPENING YOUR VAULT…' : 'RESUME YOUR DEMO VAULT'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={startDemoVault}
                  disabled={demoBusy !== 'idle'}
                  className="vk-r-touch-y"
                  style={hasStoredDemo
                    ? demoSecondaryButton(demoBusy !== 'idle')
                    : demoPrimaryButton(demoBusy !== 'idle')}
                >
                  {demoBusy === 'creating'
                    ? 'CREATING YOUR VAULT…'
                    : hasStoredDemo ? 'START A FRESH ONE' : 'START A DEMO VAULT'}
                </button>

                {/* Announced, because on a narrow screen the button that
                    changed can be the only thing visible and the wait is
                    several seconds of Argon2id. */}
                <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
                  {demoBusy === 'creating' ? 'Creating your demo vault. This takes a few seconds.'
                    : demoBusy === 'resuming' ? 'Reopening your demo vault.'
                    : demoNotice}
                </span>

                <span style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty' }}>
                  {demoBusy === 'creating'
                    ? 'Deriving a key with Argon2id and encrypting five example entries in this browser. The pause is the security working.'
                    : 'Creates a private vault with five invented entries, encrypted in this browser under a key the server never receives. Nobody else can see it, and it is deleted with everything else at 03:00 UTC.'}
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

// The demo actions. Amber like the box they sit in, so they read as
// part of the demo affordance rather than competing with the green
// UNLOCK button that submits the real form.
function demoPrimaryButton(busy) {
  return {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    font: "600 12px 'Geist Mono', monospace", letterSpacing: '.1em',
    padding: '12px 14px', borderRadius: 'var(--radius)',
    border: '1px solid var(--amber)',
    background: 'color-mix(in srgb, var(--amber) 12%, transparent)',
    color: 'var(--text)',
    cursor: busy ? 'progress' : 'pointer',
    opacity: busy ? 0.7 : 1,
    boxShadow: '0 2px 0 color-mix(in srgb, var(--amber) 45%, transparent)',
    transition: 'background .15s, opacity .15s'
  };
}

// Quieter: offered alongside RESUME, where starting over is the less
// likely intent.
function demoSecondaryButton(busy) {
  return {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    font: "600 11px 'Geist Mono', monospace", letterSpacing: '.1em',
    padding: '10px 14px', borderRadius: 'var(--radius)',
    border: '1px solid var(--edge)',
    background: 'transparent',
    color: 'var(--muted)',
    cursor: busy ? 'progress' : 'pointer',
    opacity: busy ? 0.7 : 1,
    transition: 'opacity .15s'
  };
}
