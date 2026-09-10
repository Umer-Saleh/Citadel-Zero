import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button, Meter, ErrorNote } from '../components/ui';
import { codeToMessage } from '../lib/errors';
import { Paladin } from '../components/Paladin';
import { Icon } from '../components/Icon';
import { checkPolicy } from '../lib/policy';
import { emailError, normaliseEmail } from '../lib/email';
import { ThemeToggle } from '../components/ThemeToggle';

export function Signup({ onComplete, onGoLogin }) {
  const { signup } = useVault();

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const policy = checkPolicy(pw, [email]);
  const strength = policy.strength;
  const mismatch = pw2.length > 0 && pw2 !== pw;

  // PIX reacts to the form state: braces on mismatch, powers up on a
  // strong password, otherwise idles.
  const pose = mismatch ? 'brace' : strength.score >= 7 ? 'power' : 'idle';

  const [revealed, setRevealed] = useState(false);

  // Shown only once the field has been left. Flagging an address the
  // moment focus lands would be nagging someone mid-type.
  const [emailTouched, setEmailTouched] = useState(false);
  const emailProblem = emailTouched ? emailError(email) : '';

  async function handleSubmit() {
    if (busy) return;                       // Enter can fire while a signup is in flight
    setError('');
    if (!email || !pw) return setError('Email and master password are required.');

    // Before the derivation, not after. An unusable address used to
    // cost a full Argon2id run in this browser and come back as a
    // server VALIDATION_FAILED.
    const cleanEmail = normaliseEmail(email);
    const badEmail = emailError(cleanEmail);
    if (badEmail) {
      setEmail(cleanEmail);
      setEmailTouched(true);
      return setError(badEmail);
    }
    if (pw !== pw2) return setError("Passwords don't match yet.");
    if (!policy.passed) return setError('Your master password does not meet the requirements below.');

    setBusy(true);
    try {
      // The trimmed address is what is registered AND what is handed
      // on, so the recovery kit and the first unlock agree with it.
      const { recoveryKey } = await signup(cleanEmail, pw);
      onComplete(recoveryKey, cleanEmail);
    } catch (e) {
      // This handler used to end in a bare "Something went wrong.
      // Please try again." — the only one in the app that threw the
      // code away entirely, so a rate limit, a malformed request and a
      // server crash were one indistinguishable sentence. On the screen
      // where a typo in an email costs a full Argon2id derivation
      // first, that was the worst place for it.
      setError(codeToMessage(e, 'Could not create your vault'));
      setBusy(false);
    }
  }

  const onEnter = e => e.key === 'Enter' && handleSubmit();

  return (
    <section className="vk-r-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px', position: 'relative', zIndex: 1 }}>
      {/* The five pre-auth screens have no header to hold this, so
          it floats. Same component AppShell uses. */}
      <ThemeToggle floating />

      <div className="vk-r-fluid" style={{ width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* masthead — gap 16 per the prototype (was 12) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Paladin pose={pose} size={72} />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 21, letterSpacing: 2, color: 'var(--text)' }}>
            CITADEL <span style={{ color: 'var(--green)' }}>ZERO</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            One password to keep. Everything else, kept for you.
          </div>
        </div>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Input
            label="Email" type="email" placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={onEnter}
            // Trimmed on the way out, so what is shown is what is sent.
            onBlur={() => { setEmail(v => normaliseEmail(v)); setEmailTouched(true); }}
            error={emailProblem}
          />

          <Input
            label="Master password" revealable mono
            revealed={revealed} onToggleReveal={() => setRevealed(r => !r)}
            placeholder="A long passphrase works best"
            value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={onEnter}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Meter score={strength.score} color={strength.color} />
              <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: strength.color }}>
                {strength.label}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
             {policy.rules.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Icon name={r.ok ? 'check' : 'plus'} size={12}
                    style={{ marginTop: 3, opacity: r.ok ? 1 : 0.4, color: r.ok ? 'var(--green)' : 'var(--muted)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, color: r.ok ? 'var(--green)' : 'var(--muted)', transition: 'color .2s' }}>
                      {r.label}
                    </span>
                    {r.hint && (
                      <span style={{ fontSize: 12, color: 'var(--muted)', textWrap: 'pretty' }}>{r.hint}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* No eye of its own — the toggle above governs both, so
              they can't disagree about what's visible. */}
          <Input
            label="Confirm master password" mono
            type={revealed ? 'text' : 'password'}
            placeholder="Once more"
            value={pw2} onChange={e => setPw2(e.target.value)}
            onKeyDown={onEnter}
            error={mismatch ? "Passwords don't match yet." : ''}
          />

          <ErrorNote message={error} />

          {/* prototype's create button is taller than the default Button */}
          <Button onClick={handleSubmit} disabled={busy} style={{ padding: '14px 24px', letterSpacing: '.12em', justifyContent: 'center' }}>
            {busy ? 'CREATING VAULT…' : 'CREATE VAULT'}
          </Button>

          {/* The product claim, at the moment the user decides whether
              to trust it. This is literally true of the code above:
              signup() derives locally and sends only wrapped material. */}
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', textWrap: 'pretty' }}>
            We never see your master password. It never leaves this device.
          </div>
        </Card>

        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Already have a vault?{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onGoLogin(); }} style={{ color: 'var(--green)' }}>
            Unlock it
          </a>
        </div>
      </div>
    </section>
  );
}