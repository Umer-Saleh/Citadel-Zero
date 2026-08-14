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
    setDek(prev => {
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


  const login = useCallback(async (loginEmail, password, totpCode) => {
    const { dek: newDek, kdfUpgradeAvailable: upgrade, targetKdfParams } =
      await auth.login(loginEmail, password, totpCode);
    setDek(newDek);
    setEmail(loginEmail);                    // remember who's unlocked
    setKdfUpgradeAvailable(!!upgrade);       // for the settings "level up" prompt
    setLocked(false);
    return { kdfUpgradeAvailable: upgrade, targetKdfParams };
  }, []);

  const signup = useCallback((email, password) => auth.signup(email, password), []);

  /** Fetch and decrypt the whole vault. */
  const loadItems = useCallback(async () => {
    if (!dek) return;
    const { items: encrypted } = await api.get('/api/vault');

    const decrypted = await Promise.all(
      encrypted.map(async (row) => ({
        id: row.id,
        updatedAt: row.updatedAt,
        data: await decryptItem(row, dek)   // { site, username, password, ... }
      }))
    );
    setItems(decrypted);
  }, [dek]);

  const addItem = useCallback(async (data) => {
    const blob = await encryptItem(data, dek);
    const { id } = await api.post('/api/vault', blob);
    setItems(prev => [...prev, { id, data, updatedAt: new Date().toISOString() }]);
  }, [dek]);

  const updateItem = useCallback(async (id, data) => {
    const blob = await encryptItem(data, dek);
    await api.put(`/api/vault/${id}`, blob);
    setItems(prev => prev.map(it => it.id === id ? { ...it, data } : it));
  }, [dek]);

  const deleteItem = useCallback(async (id) => {
    await api.delete(`/api/vault/${id}`);
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

    // Change the master password, then lock: the server revokes all
  // sessions, so the user must sign in again with the new password.
  const changePassword = useCallback(async (email, currentPassword, newPassword) => {
    await auth.changePassword(email, currentPassword, newPassword, dek);
    lock();   // force re-login with the new password
  }, [dek, lock]);

  // Upgrade KDF params in place. The session stays valid — the DEK is
  // unchanged, only its wrapper and the account's params moved.
  const upgradeKdf = useCallback(async (email, password) => {
    await auth.upgradeKdf(email, password, dek);
  }, [dek]);

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
    return auth.regenerateRecoveryKit(email, password, dek);
  }, [dek]);

  const value = {
    isUnlocked, locked, items,
    email, kdfUpgradeAvailable,
    signup, login, lock, loadItems,
    addItem, updateItem, deleteItem,
    changePassword, upgradeKdf, regenerateKit
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}