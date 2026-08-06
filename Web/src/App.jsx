import { useState } from 'react';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';
import { AppShell } from './components/AppShell';
import { Vault } from './screens/Vault';

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
      <AppShell>
        <Vault
          onSelectItem={(id) => console.log('open item', id)}
          onAddItem={() => console.log('add item')}
        />
      </AppShell>
    );
  }

  return null;
}