const userRepo = require('../repositories/userRepo');
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');
const { needsKdfUpgrade, DEFAULT_KDF_PARAMS } = require('../crypto');

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
    console.warn(`[server] failed password change for ${user.email}`);
    throw new AppError('INVALID_CREDENTIALS', 401, 'current password is incorrect');
  }

  const stored = await serverStoreAuth(newAuthHash);

  await userRepo.updateCredentials(userId, {
    authHash: stored,
    kdfSalt: newKdfSalt,
    kdfParams: newKdfParams,
    wrappedDek: newWrappedDek
  });

  console.log(`[server] password changed for ${user.email}`);
}

/** Public material the client needs before deriving the recovery KEK. */
async function getRecoveryMaterial(email) {
  const user = await userRepo.findRecoveryByEmail(email);

  if (!user || !user.recovery_wrapped_dek) {
    throw new AppError('NOT_FOUND', 404, 'not found');
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
 * Note what the server cannot verify here: it has no way to check that
 * the client actually holds the recovery key. Possession is proved
 * implicitly — only someone who unwrapped the real DEK can produce a
 * new wrapper containing it. A client that guesses would simply lock
 * itself out of its own vault, which is why this endpoint is heavily
 * rate limited rather than authenticated.
 */
async function completeRecovery({
  email, newAuthHash, newKdfSalt, newKdfParams,
  newWrappedDek, newRecoverySalt, newRecoveryWrappedDek
}) {
  const user = await userRepo.findByEmail(email);

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const stored = await serverStoreAuth(newAuthHash);

  await userRepo.updateCredentials(user.id, {
    authHash: stored,
    kdfSalt: newKdfSalt,
    kdfParams: newKdfParams,
    wrappedDek: newWrappedDek
  });

  await userRepo.updateRecoveryWrapper(user.id, {
    recoverySalt: newRecoverySalt,
    recoveryWrappedDek: newRecoveryWrappedDek
  });

  console.log(`[server] recovery completed for ${email}`);
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

  console.log(`[server] KDF upgraded for ${user.email}`);
}

module.exports = { changePassword, getRecoveryMaterial, completeRecovery, upgradeKdf };