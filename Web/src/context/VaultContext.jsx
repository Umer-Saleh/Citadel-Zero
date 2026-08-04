import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as auth from '../api/auth';
import { api, clearToken } from '../api/client';
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

  const isUnlocked = dek !== null;

  const idleTimer = useRef(null);

  /** Wipe every trace of the unlocked session from memory. */
  const lock = useCallback(() => {
    // Zero the DEK buffer before dropping the reference. JavaScript
    // cannot guarantee erasure (see README limitations), but this is
    // the most we can do.
    setDek(prev => {
      if (prev) prev.fill(0);
      return null;
    });
    setItems([]);
    setLocked(true);
    clearToken();
  }, []);

  const login = useCallback(async (email, password) => {
    const { dek: newDek, kdfUpgradeAvailable, targetKdfParams } =
      await auth.login(email, password);
    setDek(newDek);
    setLocked(false);
    return { kdfUpgradeAvailable, targetKdfParams };
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

  const value = {
    isUnlocked, locked, items,
    signup, login, lock, loadItems,
    addItem, updateItem, deleteItem
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}