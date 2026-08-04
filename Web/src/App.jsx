import { useState } from 'react';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';

export default function App() {
  const [screen, setScreen] = useState('unlock');   // start at unlock
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [email, setEmail] = useState('');

  if (screen === 'signup') {
    return (
      <Signup
        onComplete={(key, userEmail) => { setRecoveryKey(key); setEmail(userEmail); setScreen('recovery'); }}
        onGoLogin={() => setScreen('unlock')}
      />
    );
  }

  if (screen === 'recovery') {
    return (
      <RecoveryKit
        recoveryKey={recoveryKey} email={email}
        onContinue={() => { setRecoveryKey(null); setScreen('vault'); }}
      />
    );
  }

  if (screen === 'unlock') {
    return (
      <Unlock
        onUnlocked={(result) => {
          console.log('unlocked. kdfUpgradeAvailable:', result.kdfUpgradeAvailable);
          setScreen('vault');
        }}
        onGoSignup={() => setScreen('signup')}
        onGoRecovery={() => console.log('recovery flow next')}
      />
    );
  }

  if (screen === 'vault') {
    return (
      <div style={{ padding: 40, color: 'var(--text)' }}>
        <h1>🔓 Vault unlocked</h1>
        <p style={{ color: 'var(--muted)' }}>The vault screen is next. Your DEK is in memory.</p>
      </div>
    );
  }

  return null;
}