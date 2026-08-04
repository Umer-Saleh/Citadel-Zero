import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button, Meter } from '../components/ui';
import { Paladin } from '../components/Paladin';
import { calcStrength } from '../lib/strength';

export function Signup({ onComplete, onGoLogin }) {
  const { signup } = useVault();

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = calcStrength(pw);
  const mismatch = pw2.length > 0 && pw2 !== pw;

  // PIX reacts to the form state: braces on mismatch, powers up on a
  // strong password, otherwise idles.
  const pose = mismatch ? 'brace' : strength.score >= 7 ? 'power' : 'idle';

  async function handleSubmit() {
    setError('');
    if (!email || !pw) return setError('Email and master password are required.');
    if (pw !== pw2) return setError("Passwords don't match yet.");
    if (strength.score < 4) return setError('Please choose a stronger master password.');

    setBusy(true);
    try {
      const { recoveryKey } = await signup(email, pw);
      onComplete(recoveryKey);       // hand the once-only key to the recovery screen
    } catch (e) {
      setError(
        e.code === 'EMAIL_TAKEN' ? 'An account with this email already exists.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : 'Something went wrong. Please try again.'
      );
      setBusy(false);
    }
  }

  return (
    <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
      <div style={{ width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Paladin pose={pose} size={72} />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 21, letterSpacing: 2 }}>
            VAULTKEEP
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            One password to keep. Everything else, kept for you.
          </div>
        </div>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Input
            label="Email" type="email" placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)}
          />

          <Input
            label="Master password" revealable mono
            placeholder="A long passphrase works best"
            value={pw} onChange={e => setPw(e.target.value)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Meter score={strength.score} color={strength.color} />
              <span style={{ font: "600 11px 'Geist Mono', monospace", letterSpacing: '.14em', color: strength.color }}>
                {strength.label}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{strength.tip}</div>
          </div>

          <Input
            label="Confirm master password" revealable mono
            placeholder="Once more"
            value={pw2} onChange={e => setPw2(e.target.value)}
            error={mismatch ? "Passwords don't match yet." : ''}
          />

          {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? 'CREATING VAULT…' : 'CREATE VAULT'}
          </Button>
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