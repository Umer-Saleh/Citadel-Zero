import {
  deriveKeys, generateSalt, generateDEK, wrapDEK, unwrapDEK,
  generateRecoveryKey, deriveRecoveryKek,
  DEFAULT_KDF_PARAMS, toBase64, fromBase64
} from '../crypto';
import { api, setToken } from './client';

/**
 * Sign up. Does all crypto client-side, sends only wrapped material.
 * Returns the recovery key ONCE — the caller must show it and then
 * discard it, because it can never be retrieved again.
 */
export async function signup(email, password) {
  const salt = generateSalt();
  const { authHash, kek } = await deriveKeys(password, salt, DEFAULT_KDF_PARAMS);

  const dek = generateDEK();

  const recoveryKey = generateRecoveryKey();
  const recoverySalt = generateSalt();
  const recoveryKek = await deriveRecoveryKek(recoveryKey, recoverySalt);

  await api.post('/api/auth/signup', {
    email,
    authHash: toBase64(authHash),
    kdfSalt: toBase64(salt),
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDek: await wrapDEK(dek, kek),
    recoverySalt: toBase64(recoverySalt),
    recoveryWrappedDek: await wrapDEK(dek, recoveryKek)
  });

  return { recoveryKey };   // shown once, then gone
}

/**
 * Log in. Returns the in-memory DEK and whether a KDF upgrade is
 * available. The DEK is the caller's to hold in memory only.
 */
export async function login(email, password) {
  const { kdfSalt, kdfParams } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );

  const salt = fromBase64(kdfSalt);
  const { authHash, kek } = await deriveKeys(password, salt, kdfParams);

  const res = await api.post('/api/auth/login', {
    email,
    authHash: toBase64(authHash)
  });

  setToken(res.token);
  const dek = await unwrapDEK(res.wrappedDek, kek);

  return {
    dek,
    kdfUpgradeAvailable: res.kdfUpgradeAvailable,
    targetKdfParams: res.targetKdfParams
  };
}