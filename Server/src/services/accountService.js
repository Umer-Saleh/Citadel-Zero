const userRepo = require('../repositories/userRepo');
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');

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

module.exports = { changePassword };