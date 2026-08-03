const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepo = require('../repositories/userRepo');
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');
const { needsKdfUpgrade, DEFAULT_KDF_PARAMS } = require('../crypto');

// A real Argon2 hash used when the account does not exist, so the
// failure path costs the same as a genuine wrong-password attempt.
const DUMMY_HASH = '$argon2id$v=19$m=65536,p=4,t=3$rm29g6kvVdhtbZxachGdMw$' + 'V8EhUOs5sbp1qvmFPFlsVFl9x6QZkIYUlpSKmdEE2HI';

const ACCESS_TOKEN_TTL = '15m';

async function signup({ email, authHash, kdfSalt, kdfParams, wrappedDek,
                        recoverySalt, recoveryWrappedDek }) {
  try {
    const stored = await serverStoreAuth(authHash);
    return await userRepo.create({
      email, kdfSalt, kdfParams, authHash: stored, wrappedDek,
      recoverySalt, recoveryWrappedDek
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError('EMAIL_TAKEN', 409, 'account already exists');
    }
    throw err;
  }
}

async function getKdfParams(email) {
  const user = await userRepo.findByEmail(email);

  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  return { kdfSalt: user.kdf_salt, kdfParams: user.kdf_params };
}

async function login({ email, authHash }) {
  const user = await userRepo.findByEmail(email);

  // Always verify, even for unknown accounts, so response time does
  // not reveal whether the email is registered.
  const valid = await serverVerifyAuth(authHash, user ? user.auth_hash : DUMMY_HASH).catch(() => false);

  if (!user || !valid) {
    console.warn(`[server] failed login for ${email}`);  
    throw new AppError('INVALID_CREDENTIALS', 401, 'invalid credentials');
  }

  const token = jwt.sign({ sub: user.id }, config.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

  return {
    token,
    userId: user.id,
    email: user.email,
    wrappedDek: {
      ciphertext: user.wrapped_dek,
      nonce: user.wrapped_dek_nonce,
      authTag: user.wrapped_dek_tag
    },
    // The client cannot know its stored parameters are stale — only
    // the server knows the current defaults.
    kdfUpgradeAvailable: needsKdfUpgrade(user.kdf_params),
    targetKdfParams: DEFAULT_KDF_PARAMS
  };
}

module.exports = { signup, getKdfParams, login };