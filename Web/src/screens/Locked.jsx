import { useState } from 'react';
import { useVault } from '../context/VaultContext';
import { Card, Input, Button } from '../components/ui';
import { Paladin } from '../components/Paladin';

export function Locked({ email, onGoUnlock }) {
  const { login } = useVault();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('form');   // 'form' | 'deriving'

  async function unlock() {
    setError('');
    if (!pw) return setError('Enter your master password.');
    setPhase('deriving');
    try {
      await login(email, pw);   // restores the DEK; App re-renders unlocked
    } catch (e) {
      setPhase('form');
      setError(e.code === 'INVALID_CREDENTIALS' ? 'Wrong master password.' : 'Could not unlock.');
    }
  }

  return (
    <section className="vk-r-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="vk-r-fluid" style={{ width: 380, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'center' }}>
        {/* PIX holds the guarding pose — portcullis down */}
        <Paladin pose="guard" size={80} />

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 15, color: 'var(--text)', letterSpacing: 1, marginBottom: 8 }}>
            VAULT LOCKED
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            {email ? `Locked as ${email}` : 'Enter your master password to continue.'}
          </div>
        </div>

        <Card style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {phase === 'deriving' ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: 'var(--text)' }}>
                DECRYPTING<span style={{ animation: 'blinkCur 1s steps(1) infinite' }}>_</span>
              </div>
            </div>
          ) : (
            <>
              <Input
                label="Master password" revealable mono
                value={pw} onChange={e => setPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && unlock()}
              />
              {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
              <Button onClick={unlock}>UNLOCK</Button>
            </>
          )}
        </Card>

        {!email && (
          <button onClick={onGoUnlock} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontSize: 13 }}>
            Use a different account
          </button>
        )}
      </div>
    </section>
  );
}