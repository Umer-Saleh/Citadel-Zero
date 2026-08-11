import { useState, useEffect, useRef } from 'react';
import { useVault } from './context/VaultContext';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';
import { VaultLayout } from './screens/VaultLayout';
import { Generator } from './screens/Generator';  
import { AppShell } from './components/AppShell';
import { Settings } from './screens/Settings';
import { usePix } from './context/PixContext';

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

  // Which top-level view we're on inside the unlocked app.
  //   'vault'     -> the vault list / item editor
  //   'generator' -> the password forge
  const [view, setView] = useState('vault');

  // A password handed over from the generator. Held only long enough
  // for the detail panel to take it, then cleared — same as
  // recoveryKey above.
  const [forgedPassword, setForgedPassword] = useState(null);

  // Which vault entry the detail panel is showing.
  //   undefined -> hint       null -> new entry       <id> -> editing
  //
  // This lives here, not in VaultLayout, because VaultLayout unmounts
  // whenever you switch to the generator or settings — its state would
  // be lost on the way back.
  const [selected, setSelected] = useState(undefined);

  // PIX reacts to saves, copies, and deletes. The context is provided
  // at the top level, but the reactions happen in the header, three
  // levels up and a sibling of all of them.
  const { react } = usePix();


  // The vault waits a beat after isUnlocked flips, so Unlock can show
  // ACCESS GRANTED and fade out. Without this, App swaps the screen in
  // the same render that login() resolves — the granted card and its
  // animation are torn out before a single frame draws.
  const [entered, setEntered] = useState(false);
    useEffect(() => {
    if (!isUnlocked) { setEntered(false); return; }
    const t = setTimeout(() => setEntered(true), 700);
    return () => clearTimeout(t);
  }, [isUnlocked]);
  
  // Unlock and lock fire here rather than in VaultContext, because
  // VaultProvider wraps PixProvider and so can't use the hook.
  // Watching isUnlocked catches every path in: password, recovery,
  // and every path out: LOCK, idle timeout, a dead refresh token.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    react(isUnlocked ? 'unlock' : 'lock');
  }, [isUnlocked, react]);

  // ---------------------------------------------------------------
  // UNLOCKED — the real application.
  // This branch is reachable ONLY while the DEK is in memory.
  // ---------------------------------------------------------------

  if (isUnlocked && entered) {
  return (
      <AppShell view={view} onNavigate={setView}>

        {/*
          The vault stays MOUNTED whatever view we're on, and is only
          hidden with CSS. Unmounting it would throw away the selected
          entry and any half-typed draft in the detail panel.
        */}
        <div style={{ display: view === 'vault' ? 'block' : 'none' }}>
          <VaultLayout
            selected={selected}
            onSelect={setSelected}
            forgedPassword={forgedPassword}
            onForgedConsumed={() => setForgedPassword(null)}
          />
        </div>

        {view === 'generator' && (
          <Generator onUse={pw => { setForgedPassword(pw); setView('vault'); }} />
        )}

        {view === 'settings' && <Settings />}
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