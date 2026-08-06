import { useState } from 'react';
import { AppShell } from './components/AppShell';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';
import { Vault } from './screens/Vault';
import { ItemDetail } from './screens/ItemDetail';

export default function App() {
  const [screen, setScreen] = useState('unlock');   // start at unlock
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [email, setEmail] = useState('');
  const [editingId, setEditingId] = useState(undefined);   // undefined = not editing, null = new, id = edit

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
    if (editingId !== undefined) {
      return (
        <AppShell>
          <ItemDetail itemId={editingId} onDone={() => setEditingId(undefined)} />
        </AppShell>
      );
    }
    return (
      <AppShell>
        <Vault
          onSelectItem={(id) => setEditingId(id)}
          onAddItem={() => setEditingId(null)}
        />
      </AppShell>
    );
  }

  return null;
}