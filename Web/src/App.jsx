import { useState, useEffect, useRef } from 'react';
import { useVault } from './context/VaultContext';
import { Signup } from './screens/Signup';
import { RecoveryKit } from './screens/RecoveryKit';
import { Unlock } from './screens/Unlock';
import { VaultLayout } from './screens/VaultLayout';
import { Generator } from './screens/Generator';  
import { AppShell } from './components/AppShell';
import { Settings } from './screens/Settings';
import { Recover } from './screens/Recover';
import { NotFound } from './screens/NotFound';
import { isAppPath } from './lib/appPaths';
import { usePix } from './context/PixContext';

/**
 * Read ONCE, at module scope.
 *
 * Not state, not an effect, not a render-time read. The value cannot
 * change without a page load — there is no router and nothing in the
 * app calls history.pushState — so re-deriving it would be pretending
 * it might, and an effect would let the unlock screen paint first.
 *
 * The allowlist it checks against is load-bearing; see lib/appPaths.js
 * for what must be updated if this origin ever serves a new path.
 */
const IS_APP_PATH = isAppPath(window.location.pathname);

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
  const { isUnlocked, sessionNotice } = useVault();

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

  // Whether the NEXT unlock will be this account's first.
  //
  // Set by the three flows that mint credentials — signup, recovery,
  // and a demo provision — and read once, when isUnlocked flips. Without
  // it PIX greeted a brand new account with "WELCOME BACK.", which
  // there is no "back" for.
  //
  // WHY NOT THE FRESH_SIGNUP BRAND
  // ------------------------------
  // auth.js already stamps the kdfMaterial signup() returns with a
  // module-private FRESH_SIGNUP symbol, and that is genuinely the only
  // existing "this account is seconds old" signal in the codebase. It
  // threads cleanly for exactly ONE of the three cases: demo
  // provisioning, which is the only caller that hands the material
  // straight back to login().
  //
  // The ordinary signup path cannot use it without a change to the auth
  // path itself. Signup ends at RecoveryKit, then the user types their
  // password into Unlock — so the brand would have to be carried across
  // two screens and passed to a login() the user initiated. That is not
  // inert: knownKdf also skips the kdf-params fetch AND the totpEnabled
  // pre-check, which auth.js is explicit are only safe immediately after
  // a signup in the same tab. Recovery has no signup() call at all, so
  // there is no branded material to carry in the first place.
  //
  // Rewriting login's contract to change a mascot's line would be the
  // wrong trade, and a hybrid — the brand for demo, a flag for the other
  // two — would be two mechanisms for one fact. So: one flag, set at
  // all three sites, and FRESH_SIGNUP left doing its own job.
  //
  // A REF, NOT STATE, and that is load-bearing rather than a
  // micro-optimisation. Nothing renders from this — it is read once,
  // inside the effect below, at the moment isUnlocked flips. As state it
  // would have to be a dependency of that effect, and then SETTING it
  // would re-run the effect while still locked: signup would fire a
  // spurious 'lock' reaction and immediately clear the flag it had just
  // set, so the first unlock it exists to catch would still say
  // "WELCOME BACK.". A ref has no such coupling.
  const freshAccount = useRef(false);

  // A message to show on the UNLOCK screen, set by something that
  // happened just before the vault locked.
  //
  // Changing the master password succeeds and then immediately locks —
  // the server revokes every session, so there is nothing valid left to
  // stay signed in with. The screen that would have confirmed it is
  // torn down in the same commit, which is why a successful change was
  // indistinguishable from a crash: the user was ejected in silence.
  //
  // State, not a ref, because unlike freshAccount this one renders.
  const [postLockNotice, setPostLockNotice] = useState(null);

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
    if (!isUnlocked) return;
    const t = setTimeout(() => setEntered(true), 700);
    // Reset on the way OUT rather than on the way in: cleanup runs
    // when isUnlocked flips false, which is exactly when `entered`
    // should go stale. No synchronous setState in the effect body.
    return () => { clearTimeout(t); setEntered(false); };
  }, [isUnlocked]);
  
  // Unlock and lock fire here rather than in VaultContext, because
  // VaultProvider wraps PixProvider and so can't use the hook.
  // Watching isUnlocked catches every path in: password, recovery,
  // and every path out: LOCK, idle timeout, a dead refresh token.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    react(isUnlocked ? (freshAccount.current ? 'firstUnlock' : 'unlock') : 'lock');

    // Locking resets the view. Otherwise unlocking drops you back
    // into Settings or the generator, which is not where anyone
    // expects to arrive after entering their master password.
    if (!isUnlocked) {
      // The rule is right that this is App reacting to its own state,
      // but the alternatives are worse. Resetting in the LOCK button's
      // handler would miss the idle timeout and dead-refresh-token
      // paths, which lock from inside VaultContext. Moving `view` into
      // VaultContext would give the vault opinions about navigation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView('vault');
      setSelected(undefined);

      // Consumed here rather than immediately after the reaction
      // fires. Locking is the only way back to a pre-auth screen, so it
      // is the only moment a NEW account could be minted — which makes
      // this the correct place to reset. Leaving it set for the rest of
      // an unlocked session is harmless: it is read once, at the
      // transition.
      freshAccount.current = false;
    }
  }, [isUnlocked, react]);

  // ---------------------------------------------------------------
  // NOT A REAL PAGE — above every branch below.
  //
  // After the hooks, because it has to be: an early return before them
  // would change the hook order between a real page and a 404. Nothing
  // above this point touches the network or the key, so running them
  // and then returning costs a render and nothing else.
  // ---------------------------------------------------------------
  if (!IS_APP_PATH) return <NotFound />;

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
          <Generator onUse={pw => {
            // If nothing is open, open a new entry for it. Doing this
            // HERE rather than in an effect downstream is what breaks
            // the cycle: an effect that watched forgedPassword would
            // re-fire every time the panel closed, reopening it
            // forever with the same password.
            if (selected === undefined) setSelected(null);
            setForgedPassword(pw);
            setView('vault');
          }} />
        )}

        {view === 'settings' && (
          <Settings
            onPasswordChanged={() => setPostLockNotice({
              label: 'PASSWORD CHANGED',
              tone: 'success',
              text: 'Your master password was changed. Every other session was signed out — unlock with the new password.'
            })}
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
          freshAccount.current = true;   // the unlock after this one is their first
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

  // Recovery: unwrap with the recovery key, set a new password, and
  // receive a fresh kit. Hands off to the RecoveryKit screen at the
  // end — the new key is shown exactly once, same as at signup.
  if (authScreen === 'recover') {
    return (
      <Recover
        onRecovered={(key, userEmail) => {
          setRecoveryKey(key);
          setEmail(userEmail);
          // A recovered vault is opened under a password that did not
          // exist a moment ago. "WELCOME BACK." to someone who just
          // fought their way back in with a printed key is the wrong
          // note; the vault is theirs again, which is what this says.
          freshAccount.current = true;
          setAuthScreen('recovery');
        }}
        onBack={() => setAuthScreen('unlock')}
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
      // Two sources, one slot. This one is set by something the user
      // DID (changing their password); sessionNotice is set by
      // something that happened TO them (the session dying). They
      // cannot both be live — a password change ends the session it
      // was made from — and this one is checked first because it is
      // the more specific explanation of the same lock.
      notice={postLockNotice ?? sessionNotice}
      // Cleared once they are back in, so a later lock does not replay
      // an explanation for something that happened two sessions ago.
      // sessionNotice clears itself in VaultContext.login for the same
      // reason.
      onUnlocked={() => setPostLockNotice(null)}
      onGoSignup={() => setAuthScreen('signup')}
      onGoRecovery={() => setAuthScreen('recover')}
      // Provisioning a demo vault creates an account and unlocks it
      // without passing back through App, so Unlock has to say so. Only
      // creating one — RESUME reopens a vault from earlier in this tab,
      // which is a returning unlock and keeps "WELCOME BACK."
      //
      // Takes a boolean because a failed provision must be able to
      // withdraw the claim: nothing unlocked, so it was never read, and
      // left set it would mis-greet whatever unlocked next.
      onFreshVault={fresh => { freshAccount.current = fresh; }}
    />
  );
}