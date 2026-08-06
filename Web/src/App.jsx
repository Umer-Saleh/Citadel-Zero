import { useState } from 'react';
import { useVault } from './context/VaultContext';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';
import { Vault } from './screens/Vault';
import { ItemDetail } from './screens/ItemDetail';
import { AppShell } from './components/AppShell';

/**
 * Top-level router.
 *
 * The single most important idea here: the vault is gated on
 * `isUnlocked`, which is derived from whether the DEK is in memory
 * (VaultContext). It is NOT a screen name we set by hand.
 *
 * Why that matters: locking, idle-timeout, and page refresh all work
 * by dropping the DEK. If routing were driven by a manual "screen"
 * string, that string could disagree with whether we actually hold a
 * key — you could show vault contents with no DEK, or hide them when
 * unlocked. By making `isUnlocked` the first thing we check, the UI
 * can never be out of sync with the real lock state.
 *
 *   LOCK button  -> lock() sets dek = null -> isUnlocked false -> auth flow
 *   Idle timeout -> same path, automatically
 *   Refresh      -> DEK was only ever in memory, so it's gone -> auth flow
 */
export default function App() {
  const { isUnlocked } = useVault();

  // Pre-auth flow only: which of signup / recovery-kit / unlock to show.
  // This state is irrelevant once isUnlocked is true.
  const [authScreen, setAuthScreen] = useState('unlock');

  // The recovery key is held here for exactly as long as it takes to
  // show it once on the RecoveryKit screen, then dropped. The server
  // never had it and cannot resend it.
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [email, setEmail] = useState('');

  // Post-auth navigation within the unlocked app.
  //   undefined -> viewing the vault list
  //   null      -> creating a new entry
  //   <id>      -> editing an existing entry
  const [editingId, setEditingId] = useState(undefined);

  // ---------------------------------------------------------------
  // UNLOCKED — the real application.
  // This branch is reachable ONLY while the DEK is in memory.
  // ---------------------------------------------------------------
  if (isUnlocked) {
    return (
      <AppShell>
        {editingId !== undefined ? (
          <ItemDetail
            itemId={editingId}                       // null = new, id = edit
            onDone={() => setEditingId(undefined)}   // back to the list
          />
        ) : (
          <Vault
            onSelectItem={setEditingId}              // open an entry to edit
            onAddItem={() => setEditingId(null)}     // open a blank entry
          />
        )}
      </AppShell>
    );
  }

  // ---------------------------------------------------------------
  // LOCKED / PRE-AUTH — no DEK in memory.
  // Everything below only renders when isUnlocked is false.
  // ---------------------------------------------------------------

  // Signup: does all crypto client-side and returns the one-time
  // recovery key, which we carry into the RecoveryKit screen.
  if (authScreen === 'signup') {
    return (
      <Signup
        onComplete={(key, userEmail) => {
          setRecoveryKey(key);
          setEmail(userEmail);
          setAuthScreen('recovery');
        }}
        onGoLogin={() => setAuthScreen('unlock')}
      />
    );
  }

  // Recovery kit: shows the key once, gated behind a required
  // "I've saved this" confirmation, then sends the user to unlock.
  // We drop the key from memory on continue.
  if (authScreen === 'recovery') {
    return (
      <RecoveryKit
        recoveryKey={recoveryKey}
        email={email}
        onContinue={() => {
          setRecoveryKey(null);
          setAuthScreen('unlock');
        }}
      />
    );
  }

  // Default: the unlock screen.
  //
  // On success, login() (via VaultContext) stores the DEK, which flips
  // isUnlocked to true. This component re-renders and the very first
  // branch above takes over — so onUnlocked has nothing to do here.
  return (
    <Unlock
      onUnlocked={() => { /* isUnlocked flips true; the unlocked branch renders the vault */ }}
      onGoSignup={() => setAuthScreen('signup')}
      onGoRecovery={() => console.log('recovery flow — screen still to build')}
    />
  );
}