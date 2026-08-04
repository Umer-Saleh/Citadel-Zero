import { useState } from 'react';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';

export default function App() {
  const [screen, setScreen] = useState('signup');
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [email, setEmail] = useState('');

  if (screen === 'signup') {
    return (
      <Signup
        onComplete={(key, userEmail) => {
          setRecoveryKey(key);
          setEmail(userEmail);
          setScreen('recovery');
        }}
        onGoLogin={() => console.log('login next')}
      />
    );
  }

  if (screen === 'recovery') {
    return (
      <RecoveryKit
        recoveryKey={recoveryKey}
        email={email}
        onContinue={() => {
          setRecoveryKey(null);       // drop it from memory
          console.log('into the vault next');
        }}
      />
    );
  }

  return null;
}