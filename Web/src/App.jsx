import { Signup } from './screens/Signup';

export default function App() {
  return (
    <Signup
      onComplete={(recoveryKey) => {
        console.log('RECOVERY KEY (will become the recovery screen):', recoveryKey);
        alert('Vault created! Recovery key logged to console for now.');
      }}
      onGoLogin={() => console.log('go to login')}
    />
  );
}