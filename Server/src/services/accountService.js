const userRepo = require('../repositories/userRepo');
const refreshTokenRepo = require('../repositories/refreshTokenRepo');
const { withTransaction } = require('../db')
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');
const { needsKdfUpgrade, DEFAULT_KDF_PARAMS } = require('../crypto');
const { DUMMY_HASH } = require('./authService');

/**
 * Change the master password.
 *
 * The client does all the crypto: it unwraps the DEK with the old KEK,
 * derives a new KEK from the new password, and re-wraps the same DEK.
 * The server verifies the current password and stores the new values.
 * No vault item is touched.
 */
async function changePassword(userId, {
  currentAuthHash, newAuthHash, newKdfSalt, newKdfParams, newWrappedDek
}) {
  const user = await userRepo.findById(userId);

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const valid = await serverVerifyAuth(currentAuthHash, user.auth_hash).catch(() => false);

  if (!valid) {
    console.warn(`[server] failed password change for user ${user.id}`);
    throw new AppError('INVALID_CREDENTIALS', 401, 'current password is incorrect');
  }

  // Argon2 is slow, so hash BEFORE opening the transaction — holding
  // a connection and a row lock open across a ~1s hash would block
  // other writers for no reason.
  const stored = await serverStoreAuth(newAuthHash);

  // The credential change and the session revocation must land
  // together. If the process died between them, the password would
  // be new while every old session stayed live — precisely the state
  // changing a password is supposed to end.
  await withTransaction(async (client) => {
    await userRepo.updateCredentials(userId, {
      authHash: stored,
      kdfSalt: newKdfSalt,
      kdfParams: newKdfParams,
      wrappedDek: newWrappedDek
    }, client);

    await refreshTokenRepo.revokeAllForUser(userId, client);
  });

  console.log(`[server] password changed for user ${user.id}`);
}

/**
 * Public material the client needs before deriving the recovery KEK.
 *
 * Still unauthenticated, and still returns only the salt and the
 * wrapper — both useless without the recovery key. The row it reads
 * also carries recovery_auth_hash; that value is deliberately NOT in
 * the response. Returning the verifier would hand an attacker the
 * exact thing completeRecovery asks them to prove.
 *
 * An account created before proof of possession existed has no
 * verifier, so recovery cannot succeed for it. Saying so HERE rather
 * than at the write endpoint is deliberate: this is step one of the
 * flow, so the user finds out before typing a key that cannot work,
 * and this endpoint already 404s on unknown emails — it is already an
 * enumeration oracle, so a 409 tells an attacker only that an account
 * is legacy, a state the write endpoint refuses identically anyway.
 */
async function getRecoveryMaterial(email) {
  const user = await userRepo.findRecoveryByEmail(email);

  if (!user || !user.recovery_wrapped_dek) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  if (!user.recovery_auth_hash) {
    throw new AppError(
      'RECOVERY_UNAVAILABLE', 409,
      'this account predates proof of possession and cannot be recovered'
    );
  }

  return {
    recoverySalt: user.recovery_salt,
    recoveryWrappedDek: {
      ciphertext: user.recovery_wrapped_dek,
      nonce: user.recovery_wrapped_dek_nonce,
      authTag: user.recovery_wrapped_dek_tag
    }
  };
}

/**
 * Complete a recovery: replace the password-derived wrapper and issue
 * a fresh recovery wrapper.
 *
 * PROOF OF POSSESSION.
 *
 * The client derives two independent values from the recovery key,
 * separated by their HKDF info label: "recovery-kek" unwraps the DEK
 * and never leaves the device, "recovery-auth" is sent here. We check
 * it against a stored Argon2 hash of that value — exactly the
 * treatment the master password's auth hash gets. The server still
 * never sees the recovery key, and nothing it stores can unwrap
 * anything.
 *
 * This function previously verified NOTHING. It looked an account up
 * by email and overwrote the credentials, both DEK wrappers and every
 * session. One unauthenticated request carrying syntactically valid
 * garbage permanently destroyed any account whose email was known —
 * and /api/user/kdf-params makes emails discoverable. Confidentiality
 * held, since the attacker learned nothing, but the vault was gone.
 *
 * ONE failure response for three causes: no such account, an account
 * with no verifier, and a wrong proof. All three return the same 401
 * and all three pay for one Argon2 verification — against DUMMY_HASH
 * when there is no real hash to check — so neither the response nor
 * the timing distinguishes them.
 *
 * COST. This endpoint is unauthenticated and every Argon2 operation
 * costs 64 MiB. A REJECTED attempt costs exactly one: the verify below
 * runs before either serverStoreAuth, so a wrong proof never pays to
 * harden credentials that are about to be discarded. A SUCCESSFUL
 * recovery costs three, sequentially — one verify, two stores — so a
 * single request still peaks at 64 MiB rather than 192. authLimiter
 * bounds the rate.
 */
async function completeRecovery({
  email, recoveryAuthHash,
  newAuthHash, newKdfSalt, newKdfParams,
  newWrappedDek, newRecoverySalt, newRecoveryWrappedDek,
  newRecoveryAuthHash
}) {
  const user = await userRepo.findRecoveryByEmail(email);

  // Null both for an unknown account and for one predating this
  // verifier. Both fall through to the same comparison, so the work
  // done is identical either way.
  const storedProof = (user && user.recovery_auth_hash) || null;

  const valid = await serverVerifyAuth(
    recoveryAuthHash, storedProof || DUMMY_HASH
  ).catch(() => false);

  if (!user || !storedProof || !valid) {
    console.warn('[server] rejected recovery attempt');
    throw new AppError('INVALID_RECOVERY_KEY', 401, 'invalid recovery key');
  }

  // Only past the proof do we spend anything on the new credentials.
  const stored = await serverStoreAuth(newAuthHash);
  const storedNewProof = await serverStoreAuth(newRecoveryAuthHash);

  // All of it must land together. A partial write would leave the
  // account with a new password wrapper and a stale recovery wrapper
  // — the DEK still sealed under the OLD recovery key. The user could
  // log in, but their recovery kit would no longer open their vault.
  await withTransaction(async (client) => {
    await userRepo.updateCredentials(user.id, {
      authHash: stored,
      kdfSalt: newKdfSalt,
      kdfParams: newKdfParams,
      wrappedDek: newWrappedDek
    }, client);

    // Wrapper and verifier move in one statement, inside the same
    // transaction as the credential write.
    await userRepo.updateRecoveryWrapper(user.id, {
      recoverySalt: newRecoverySalt,
      recoveryWrappedDek: newRecoveryWrappedDek,
      recoveryAuthHash: storedNewProof
    }, client);

    // Recovery means the old credentials are presumed lost or
    // compromised. Any session still running under them dies.
    await refreshTokenRepo.revokeAllForUser(user.id, client);
  });

  console.log(`[server] recovery completed for user ${user.id}`);
}


/**
 * Re-derive credentials under stronger KDF parameters.
 *
 * The client does the work: it re-derives the KEK from the same master
 * password using the new parameters, and re-wraps the same DEK. The
 * password is unchanged, so no user action is required.
 *
 * Login is the only moment this can happen, because it is the only
 * point at which the client holds the master password.
 */
async function upgradeKdf(userId, {
  currentAuthHash, newAuthHash, newKdfSalt, newKdfParams, newWrappedDek
}) {
  const user = await userRepo.findById(userId);

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const valid = await serverVerifyAuth(currentAuthHash, user.auth_hash).catch(() => false);

  if (!valid) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'invalid credentials');
  }

  // Refuse a downgrade. The client proposes parameters; the server
  // must not let a malicious one weaken an existing account.
  if (needsKdfUpgrade(newKdfParams)) {
    throw new AppError('WEAK_KDF_PARAMS', 400, 'proposed parameters are below current defaults');
  }

  const stored = await serverStoreAuth(newAuthHash);

  await userRepo.upgradeKdf(userId, {
    authHash: stored,
    kdfSalt: newKdfSalt,
    kdfParams: newKdfParams,
    wrappedDek: newWrappedDek
  });

  console.log(`[server] KDF upgraded for user ${user.id}`);
}

/**
 * Issue a new recovery kit without changing the master password.
 *
 * Recovery rotates the kit as a side effect, but there's no way to
 * rotate it on its own — so a user who knows their key was exposed
 * has to go through a full recovery to replace it. This is that.
 *
 * Requires the master password despite the session being valid: a new
 * recovery key is a permanent credential to the vault, and someone
 * who borrowed an unlocked laptop shouldn't be able to mint one.
 */
async function regenerateRecoveryKit(userId, {
  currentAuthHash, newRecoverySalt, newRecoveryWrappedDek,
  newRecoveryAuthHash
}) {
  const user = await userRepo.findById(userId);

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const valid = await serverVerifyAuth(currentAuthHash, user.auth_hash).catch(() => false);

  if (!valid) {
    console.warn(`[server] failed kit regeneration for user ${user.id}`);
    throw new AppError('INVALID_CREDENTIALS', 401, 'invalid credentials');
  }

  // After the password check, so a rejected attempt costs one Argon2
  // verification rather than a verification plus a store.
  const storedNewProof = await serverStoreAuth(newRecoveryAuthHash);

  // Still a single statement, and now it has to be: the new wrapper
  // and the verifier for the new key describe the same kit, and a
  // state where one moved without the other would either lock the user
  // out of a valid key or leave the old key still able to prove
  // itself. One UPDATE is atomic by definition — a stronger guarantee
  // than two statements in a transaction, and one round trip instead
  // of three.
  //
  // Deliberately NOT touching auth_hash, kdf_params or wrapped_dek.
  // The password is unchanged; only the second door gets a new lock.
  await userRepo.updateRecoveryWrapper(userId, {
    recoverySalt: newRecoverySalt,
    recoveryWrappedDek: newRecoveryWrappedDek,
    recoveryAuthHash: storedNewProof
  });

  console.log(`[server] recovery kit regenerated for user ${user.id}`);
}

module.exports = { changePassword, getRecoveryMaterial, completeRecovery, upgradeKdf, regenerateRecoveryKit };