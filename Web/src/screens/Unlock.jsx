import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';

export function Unlock({ onUnlocked, onGoSignup, onGoRecovery }) {
  const { login } = useVault();

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  // 'form' | 'deriving' | 'granted'
  const [phase, setPhase] = useState('form');

  async function handleUnlock() {
    setError('');
    if (!email || !pw) return setError('Enter your email and master password.');

    setPhase('deriving');
    try {
      const result = await login(email, pw);   // real Argon2id runs here
      setPhase('granted');
      // brief beat on the triumphant "gate" pose before entering
      setTimeout(() => onUnlocked(result), 700);
    } catch (e) {
      setPhase('form');
      setError(
        e.code === 'INVALID_CREDENTIALS' ? 'Wrong email or master password.'
        : e.code === 'NOT_FOUND' ? 'No vault found for that email.'
        : e.code === 'NETWORK_ERROR' ? 'Cannot reach the server.'
        : 'Could not unlock. Please try again.'
      );
    }
  }

  return (
    <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {/* channel while deriving, gate on success, idle otherwise */}
          <Paladin
            pose={phase === 'deriving' ? 'channel' : phase === 'granted' ? 'gate' : 'idle'}
            size={72}
            ring={phase === 'deriving' ? 0.7 : null}
          />
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 21, letterSpacing: 2, color: 'var(--text)' }}>
            VAULTKEEP
          </div>
          <div style={{ font: "500 12px 'Geist Mono', monospace", letterSpacing: '.16em', color: 'var(--muted)' }}>
            ZERO-KNOWLEDGE VAULT
          </div>
        </div>

        {phase === 'form' && (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Input
              label="Email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
            />
            <Input
              label="Master password" revealable mono
              placeholder="············"
              value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            />
            {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
            <Button onClick={handleUnlock}>UNLOCK</Button>
            <div style={{ textAlign: 'center', fontSize: 13 }}>
              <a href="#" onClick={e => { e.preventDefault(); onGoRecovery(); }} style={{ color: 'var(--green)' }}>
                Forgot master password? Recover with your kit
              </a>
            </div>
          </Card>
        )}

        {phase !== 'form' && (
          <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '40px 32px', textAlign: 'center' }}>
            {phase === 'granted' ? (
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: 'var(--green)', letterSpacing: 1 }}>
                ACCESS GRANTED
              </div>
            ) : (
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, letterSpacing: 1, color: 'var(--text)' }}>
                DECRYPTING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 300 }}>
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