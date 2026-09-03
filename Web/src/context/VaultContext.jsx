import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as auth from '../api/auth';
import { api, setSessionLostHandler } from '../api/client';
import { encryptItem, decryptItem } from '../crypto';


const VaultContext = createContext(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;   // auto-lock after 5 minutes

export function VaultProvider({ children }) {
  // The DEK lives here and NOWHERE else. Never localStorage, never
  // sessionStorage, never a cookie. A refresh wipes it — which is
  // correct: the vault must re-lock.
  const [dek, setDek] = useState(null);

  // The SAME key, reachable from a callback that was captured before
  // it existed.
  //
  // The bug this fixes: every collaborator below closes over `dek` and
  // is rebuilt only when `dek` changes. A caller that grabs one while
  // the vault is locked and uses it after unlocking — provisioning a
  // demo vault does exactly that, holding addItem across its own
  // login() — still holds the version closed over null, and
  // encryptItem(data, null) throws inside crypto.subtle.importKey
  // before any request is sent. Five silent failures and an empty
  // vault.
  //
  // THE RULE, so this does not drift: state is the source of truth for
  // RENDERING (isUnlocked gates the whole UI and must trigger a
  // re-render); the ref is the source of truth for the KEY ITSELF
  // inside async callbacks. Both are written together, always, and
  // neither is written anywhere else.
  //
  // A ref has its own lifetime, so this is a second reference to the
  // key that would outlive the state if it were not cleared
  // explicitly. lock() clears both. See the comment there.
  const dekRef = useRef(null);
  const [items, setItems] = useState([]);
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState(null);
  const [kdfUpgradeAvailable, setKdfUpgradeAvailable] = useState(false);
  
  const isUnlocked = dek !== null;

  const idleTimer = useRef(null);

/** Wipe every trace of the unlocked session from memory. */
  const lock = useCallback(() => {
    // Local teardown FIRST, and synchronously. auth.logout() is a
    // network call that can hang or fail; if the local clear waited on
    // it, a dead server would leave the vault unlocked on screen. The
    // user pressed LOCK — that must be immediate and unconditional.
    //
    // The ref is zeroed and dropped HERE, not inside the state updater
    // below, and that ordering matters. A ref write is synchronous, so
    // by the time this function returns there is no reachable copy of
    // the key — whereas a state update is scheduled, and any callback
    // already in flight would still read the old value. This is the
    // one place in the file that clears the DEK, and every other
    // teardown route reaches it: the LOCK button, the idle timer, a
    // failed refresh via setSessionLostHandler, and changePassword.
    if (dekRef.current) dekRef.current.fill(0);
    dekRef.current = null;

    setDek(prev => {
      // Already zeroed through the ref above — the two always point at
      // the same array. Kept because it is the state's own contract
      // and costs nothing, and because it still holds if a future
      // change sets state without the ref.
      if (prev) prev.fill(0);
      return null;
    });
    setItems([]);
    setEmail(null);
    setKdfUpgradeAvailable(false);
    setLocked(true);

    // Then tell the server to revoke the session. Fire-and-forget:
    // auth.logout() never throws and clears the tokens itself, so
    // there is nothing here to await or handle.
    //
    // Without this, LOCK only made the browser forget its tokens —
    // the session stayed alive server-side until it expired.
    auth.logout();
  }, []);


  // knownKdf is forwarded, not interpreted. It is only ever the
  // branded object from auth.signup(), and only the demo provisioning
  // path passes one; every other caller omits it and takes the
  // ordinary kdf-params fetch.
  const login = useCallback(async (loginEmail, password, totpCode, knownKdf) => {
    const { dek: newDek, kdfUpgradeAvailable: upgrade, targetKdfParams } =
      await auth.login(loginEmail, password, totpCode, knownKdf);
    // Both, together. The ref first so a callback captured before this
    // login can use the key the moment login() resolves, without
    // waiting for a render.
    dekRef.current = newDek;
    setDek(newDek);
    setEmail(loginEmail);                    // remember who's unlocked
    setKdfUpgradeAvailable(!!upgrade);       // for the settings "level up" prompt
    setLocked(false);
    return { kdfUpgradeAvailable: upgrade, targetKdfParams };
  }, []);

  const signup = useCallback((email, password) => auth.signup(email, password), []);

  /** Fetch and decrypt the whole vault. */
  // ---------------------------------------------------------------
  // EVERY collaborator below reads dekRef.current, not `dek`.
  //
  // Uniformly, and deliberately. Only addItem was reached by the bug,
  // because provisioning is the only caller that holds a collaborator
  // across a login today. Fixing only addItem would leave five
  // functions with the same latent fault and an unwritten rule about
  // which ones may be captured early — the sort of list that is
  // correct on the day it is written and wrong six months later. The
  // same reasoning retired the shared demo account rather than
  // guarding its routes one at a time.
  //
  // DEPENDENCY ARRAYS. Reading through the ref makes `dek` genuinely
  // unnecessary as a dependency — it no longer decides which key is
  // used — so it is dropped everywhere it only caused churn. It is
  // kept in exactly one place, loadItems, where the identity change is
  // load-bearing: Vault.jsx re-runs its load effect on [loadItems], so
  // a stable loadItems would leave the vault empty after unlock. That
  // one exception is marked and explained at the callback itself
  // rather than left for eslint to argue about.
  // ---------------------------------------------------------------
  const loadItems = useCallback(async () => {
    if (!dekRef.current) return;
    const { items: encrypted } = await api.get('/api/vault');

    const decrypted = await Promise.all(
      encrypted.map(async (row) => ({
        id: row.id,
        updatedAt: row.updatedAt,
        data: await decryptItem(row, dekRef.current)   // { site, username, password, ... }
      }))
    );
    setItems(decrypted);
    // `dek` is not read in here any more — the ref is — but its
    // identity change is what re-runs Vault.jsx's load effect once the
    // vault unlocks. Dropping it would make loadItems stable and the
    // vault would render empty. Deliberate, not an oversight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dek]);

  const addItem = useCallback(async (data) => {
    const blob = await encryptItem(data, dekRef.current);
    const { id } = await api.post('/api/vault', blob);
    setItems(prev => [...prev, { id, data, updatedAt: new Date().toISOString() }]);
  }, []);

  const updateItem = useCallback(async (id, data) => {
    const blob = await encryptItem(data, dekRef.current);
    await api.put(`/api/vault/${id}`, blob);
    setItems(prev => prev.map(it => it.id === id ? { ...it, data } : it));
  }, []);

  const deleteItem = useCallback(async (id) => {
    await api.delete(`/api/vault/${id}`);
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

    // Change the master password, then lock: the server revokes all
  // sessions, so the user must sign in again with the new password.
  const changePassword = useCallback(async (email, currentPassword, newPassword) => {
    await auth.changePassword(email, currentPassword, newPassword, dekRef.current);
    lock();   // force re-login with the new password
  }, [lock]);

  // Upgrade KDF params in place. The session stays valid — the DEK is
  // unchanged, only its wrapper and the account's params moved.
  const upgradeKdf = useCallback(async (email, password) => {
    await auth.upgradeKdf(email, password, dekRef.current);
  }, []);

  // A failed refresh means the session is gone — expired, revoked, or
  // killed server-side by reuse detection. The UI must not keep
  // showing a vault it can no longer reach, so we drop to unlock.
  useEffect(() => {
    setSessionLostHandler(lock);
  }, [lock]);

  // Idle auto-lock: any activity resets the timer; silence locks the vault.
  useEffect(() => {
    if (!isUnlocked) return;

    const reset = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(lock, IDLE_TIMEOUT_MS);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, reset));
    reset();

    return () => {
      clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [isUnlocked, lock]);

  // Session stays valid: the DEK is unchanged, only the recovery
  // wrapper moved.
  const regenerateKit = useCallback(async (email, password) => {
    return auth.regenerateRecoveryKit(email, password, dekRef.current);
  }, []);

  const value = {
    isUnlocked, locked, items,
    email, kdfUpgradeAvailable,
    signup, login, lock, loadItems,
    addItem, updateItem, deleteItem,
    changePassword, upgradeKdf, regenerateKit
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}