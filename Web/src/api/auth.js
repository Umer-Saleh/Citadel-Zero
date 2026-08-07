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


/**
 * Change the master password.
 *
 * All crypto is client-side: verify the current password by deriving
 * its auth hash, then derive a fresh KEK from the new password and
 * re-wrap the SAME dek under it. The vault itself is never touched —
 * only the 32-byte wrapper changes.
 *
 * The server revokes all sessions on success, so the caller must
 * re-login afterwards.
 *
 * @param dek  the in-memory DEK from the current unlocked session
 */
export async function changePassword(email, currentPassword, newPassword, dek) {
  // Re-derive the CURRENT auth hash to prove we know the old password.
  // We need the current salt/params the account was registered under.
  const { kdfSalt: curSaltB64, kdfParams: curParams } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );
  const { authHash: currentAuthHash } = await deriveKeys(
    currentPassword, fromBase64(curSaltB64), curParams
  );

  // Derive brand-new material from the new password.
  const newSalt = generateSalt();
  const { authHash: newAuthHash, kek: newKek } =
    await deriveKeys(newPassword, newSalt, DEFAULT_KDF_PARAMS);

  await api.post('/api/account/password', {
    currentAuthHash: toBase64(currentAuthHash),
    newAuthHash: toBase64(newAuthHash),
    newKdfSalt: toBase64(newSalt),
    newKdfParams: DEFAULT_KDF_PARAMS,
    newWrappedDek: await wrapDEK(dek, newKek)   // same DEK, new wrapper
  });
}

/**
 * Upgrade an account's KDF parameters to current defaults.
 *
 * Only possible at a moment we hold the master password, so the caller
 * passes it in. Re-derives the KEK under stronger params and re-wraps
 * the same DEK. No vault item is touched.
 */
export async function upgradeKdf(email, password, dek) {
  const { kdfSalt: curSaltB64, kdfParams: curParams } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );
  const { authHash: currentAuthHash } = await deriveKeys(
    password, fromBase64(curSaltB64), curParams
  );

  const newSalt = generateSalt();
  const { authHash: newAuthHash, kek: newKek } =
    await deriveKeys(password, newSalt, DEFAULT_KDF_PARAMS);

  await api.post('/api/account/kdf-upgrade', {
    currentAuthHash: toBase64(currentAuthHash),
    newAuthHash: toBase64(newAuthHash),
    newKdfSalt: toBase64(newSalt),
    newKdfParams: DEFAULT_KDF_PARAMS,
    newWrappedDek: await wrapDEK(dek, newKek)
  });
}