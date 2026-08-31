import {
  deriveKeys, generateSalt, generateDEK, wrapDEK, unwrapDEK,
  generateRecoveryKey, deriveRecoveryKek, deriveRecoveryAuthHash,
  DEFAULT_KDF_PARAMS, toBase64, fromBase64
} from '../crypto';
import { api, setToken, setRefreshToken, getRefreshToken, clearToken } from './client';

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
    recoveryWrappedDek: await wrapDEK(dek, recoveryKek),
    // Proof of possession for this kit, so the server can later check
    // that a recovery caller actually holds the key. Derived from the
    // same key under a different HKDF label, so it cannot unwrap
    // anything and reveals nothing about the KEK above.
    recoveryAuthHash: toBase64(await deriveRecoveryAuthHash(recoveryKey, recoverySalt))
  });

  return { recoveryKey };   // shown once, then gone
}

/**
 * Log in. Returns the in-memory DEK and whether a KDF upgrade is
 * available. The DEK is the caller's to hold in memory only.
 *
 * If the account has 2FA on and no code was given, this throws
 * TOTP_REQUIRED *before* deriving — Argon2 takes a second or two and
 * there's no point spending it on a request the server will reject.
 * The caller catches that, shows a code field, and calls again.
 */
export async function login(email, password, totpCode) {
  const { kdfSalt, kdfParams, totpEnabled } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );

  if (totpEnabled && !totpCode) {
    const err = new Error('TOTP_REQUIRED');
    err.code = 'TOTP_REQUIRED';
    throw err;
  }

  const salt = fromBase64(kdfSalt);
  const { authHash, kek } = await deriveKeys(password, salt, kdfParams);

  const res = await api.post('/api/auth/login', {
    email,
    authHash: toBase64(authHash),
    ...(totpCode ? { totpCode } : {})    // omit entirely when not needed
  });

  setToken(res.token);
  setRefreshToken(res.refreshToken);   // in memory only, same as the DEK
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

/**
 * End the session server-side.
 *
 * Clearing tokens from memory only makes THIS tab forget them — the
 * session stays alive on the server until it expires. Logout revokes
 * the whole family, so a token captured earlier is dead immediately.
 *
 * Never throws: if the server is unreachable we still drop our own
 * tokens. A logout that fails because the network is down must not
 * leave the user logged in locally.
 */
export async function logout() {
  const refreshToken = getRefreshToken();

  if (refreshToken) {
    try {
      await api.post('/api/auth/logout', { refreshToken });
    } catch {
      // Best effort. The local clear below is what the user sees.
    }
  }

  clearToken();
}

/**
 * Fetch the material needed to attempt a recovery: the salt the
 * recovery KEK was derived under, and the DEK wrapped beneath it.
 *
 * Public by necessity — the user has forgotten their password, so
 * there is nothing to authenticate with. Neither value is a secret:
 * the wrapper is useless without the recovery key.
 */
export async function getRecoveryMaterial(email) {
  return api.get(`/api/account/recovery-material?email=${encodeURIComponent(email)}`);
}

/**
 * Unwrap the DEK with a recovery key.
 *
 * Throws if the key is wrong — GCM authentication fails, which is the
 * only verification that exists. The server cannot check a recovery
 * key; it has never seen one.
 */
export async function unwrapWithRecoveryKey(recoveryKey, recoverySalt, recoveryWrappedDek) {
  const kek = await deriveRecoveryKek(recoveryKey, fromBase64(recoverySalt));
  return unwrapDEK(recoveryWrappedDek, kek);   // throws on a wrong key
}

/**
 * Complete a recovery: set a new password and issue a fresh kit.
 *
 * The server DOES verify possession now. We send a proof derived from
 * the recovery key under the "recovery-auth" label, and the server
 * checks it against an Argon2 hash it stored at signup — the same
 * treatment the master password's auth hash gets. It still never sees
 * the key itself, and the proof cannot unwrap anything.
 *
 * Until this existed the endpoint verified nothing, so anyone who knew
 * an email could overwrite the credentials and both wrappers and
 * destroy the account permanently.
 *
 * @param recoveryKey   the key the user typed, needed for the proof
 * @param recoverySalt  base64 salt the proof must be derived under —
 *                      the same one the stored verifier was made with
 * @param dek           the DEK recovered by unwrapWithRecoveryKey
 * @returns             the NEW recovery key, shown once.
 */
export async function completeRecovery(email, newPassword, dek, recoveryKey, recoverySalt) {
  const newSalt = generateSalt();
  const { authHash: newAuthHash, kek: newKek } =
    await deriveKeys(newPassword, newSalt, DEFAULT_KDF_PARAMS);

  // Rotate the kit too, so a recovery key someone else copied stops
  // working the moment it's used.
  const newRecoveryKey = generateRecoveryKey();
  const newRecoverySalt = generateSalt();
  const newRecoveryKek = await deriveRecoveryKek(newRecoveryKey, newRecoverySalt);

  await api.post('/api/account/recover', {
    email,
    // Proof for the CURRENT key, under the salt the server stored its
    // verifier against — not the new salt generated above.
    recoveryAuthHash: toBase64(
      await deriveRecoveryAuthHash(recoveryKey, fromBase64(recoverySalt))
    ),
    newAuthHash: toBase64(newAuthHash),
    newKdfSalt: toBase64(newSalt),
    newKdfParams: DEFAULT_KDF_PARAMS,
    newWrappedDek: await wrapDEK(dek, newKek),
    newRecoverySalt: toBase64(newRecoverySalt),
    newRecoveryWrappedDek: await wrapDEK(dek, newRecoveryKek),
    // Verifier for the kit this recovery issues. The old one retires.
    newRecoveryAuthHash: toBase64(
      await deriveRecoveryAuthHash(newRecoveryKey, newRecoverySalt)
    )
  });

  return { recoveryKey: newRecoveryKey };
}

/**
 * Issue a new recovery kit without changing the master password.
 *
 * Recovery rotates the kit as a side effect, but there was no way to
 * rotate it alone — so a user who knew their key was exposed had to
 * go through a full recovery to replace it.
 *
 * Requires the master password despite the session being valid: a new
 * recovery key is a permanent credential to the vault, and someone
 * who borrowed an unlocked laptop shouldn't be able to mint one.
 *
 * @returns the NEW recovery key, shown once. The old one is dead.
 */
export async function regenerateRecoveryKit(email, password, dek) {
  const { kdfSalt, kdfParams } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );
  const { authHash: currentAuthHash } = await deriveKeys(
    password, fromBase64(kdfSalt), kdfParams
  );

  const newRecoveryKey = generateRecoveryKey();
  const newRecoverySalt = generateSalt();
  const newRecoveryKek = await deriveRecoveryKek(newRecoveryKey, newRecoverySalt);

  await api.post('/api/account/recovery-kit', {
    currentAuthHash: toBase64(currentAuthHash),
    newRecoverySalt: toBase64(newRecoverySalt),
    newRecoveryWrappedDek: await wrapDEK(dek, newRecoveryKek),
    // Verifier for the new kit. This flow authenticates with the
    // master password, so there is no proof of the OLD recovery key —
    // only the value that will prove the new one.
    newRecoveryAuthHash: toBase64(
      await deriveRecoveryAuthHash(newRecoveryKey, newRecoverySalt)
    )
  });

  return { recoveryKey: newRecoveryKey };
}