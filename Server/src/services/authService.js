const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepo = require('../repositories/userRepo');
const refreshTokenRepo = require('../repositories/refreshTokenRepo');
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');
const { needsKdfUpgrade, DEFAULT_KDF_PARAMS, generateToken, hashToken } = require('../crypto');
const { withTransaction } = require('../db');

// A real Argon2 hash used when the account does not exist, so the
// failure path costs the same as a genuine wrong-password attempt.
const DUMMY_HASH = '$argon2id$v=19$m=65536,p=4,t=3$rm29g6kvVdhtbZxachGdMw$' + 'V8EhUOs5sbp1qvmFPFlsVFl9x6QZkIYUlpSKmdEE2HI';

// Short, because the client now refreshes silently. The old 15m was a
// compromise between "a stolen token stays useful" and "the user gets
// kicked out mid-task" — splitting the credential removes the tradeoff
// instead of tuning it.
const ACCESS_TOKEN_TTL = '10m';

// Absolute lifetime of a login SESSION, not of one token.
const REFRESH_TOKEN_TTL_DAYS = 14;

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

/**
 * Start a login session: one family, one refresh token, one access
 * token. Every token descended from this login shares the family_id,
 * so the whole session can be killed at once.
 *
 * @param client  optional pg client, for callers already inside a
 *                transaction (the recovery flow).
 */
async function issueSession(userId, client) {
  const familyId = crypto.randomUUID();
  const refreshToken = generateToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000);

  await refreshTokenRepo.insert({
    familyId,
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt
  }, client);

  return {
    token: jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL }),
    refreshToken,
    refreshExpiresAt: expiresAt
  };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Every failure returns the SAME error. The client cannot tell
 * "never existed" from "already spent" from "family revoked" —
 * distinguishing them would confirm to an attacker that a token they
 * hold was once genuine.
 */
async function refresh(refreshToken) {
  const invalid = () => new AppError('INVALID_REFRESH_TOKEN', 401, 'invalid refresh token');

  // Revocation must COMMIT even though the request fails. Doing it
  // inside the main transaction would be undone by the rollback that
  // the thrown error triggers — the write and the rejection want
  // opposite outcomes, so they can't share a transaction.
  const revokeAndReject = async (familyId, reason) => {
    console.warn(`[server] ${reason}, revoking family ${familyId}`);
    await refreshTokenRepo.revokeFamily(familyId);   // no client: own transaction
    throw invalid();
  };

  return withTransaction(async (client) => {
    const row = await refreshTokenRepo.findByHash(hashToken(refreshToken), client);

    if (!row) throw invalid();
    if (row.revoked_at) throw invalid();
    if (new Date(row.expires_at) <= new Date()) throw invalid();

    // REUSE DETECTION.
    //
    // A spent token coming back means two parties hold the same
    // credential. The server cannot tell which is the thief, so it
    // distrusts both and kills the session. Everyone is forced back
    // to the master password — which the attacker doesn't have.
    if (row.used_at) {
      await revokeAndReject(row.family_id, 'refresh token reuse detected');
    }

    // The atomic version of the same check. Two concurrent requests
    // carrying one token both pass the `if` above; only one wins
    // here, because the conditional UPDATE (used_at IS NULL) is
    // serialised by Postgres. Losing this race IS a reuse attempt.
    const claimed = await refreshTokenRepo.markUsed(row.id, client);

    if (!claimed) {
      await revokeAndReject(row.family_id, 'concurrent refresh lost the race');
    }

    const next = generateToken();

    // The new token inherits the OLD expiry rather than extending it.
    // A sliding window would let a stolen family be renewed forever.
    await refreshTokenRepo.insert({
      familyId: row.family_id,
      userId: row.user_id,
      tokenHash: hashToken(next),
      expiresAt: row.expires_at
    }, client);

    return {
      token: jwt.sign({ sub: row.user_id }, config.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL }),
      refreshToken: next,
      refreshExpiresAt: row.expires_at
    };
  });
}

/**
 * Logout. Revokes the whole family, not just the presented token —
 * "log me out" means the session ends, not that one link in the chain
 * is spent.
 *
 * Silent on an unknown token: there is nothing to protect, and no
 * reason to tell a caller whether a token was ever real.
 */
async function logout(refreshToken) {
  const row = await refreshTokenRepo.findByHash(hashToken(refreshToken));
  if (row) await refreshTokenRepo.revokeFamily(row.family_id);
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

  const session = await issueSession(user.id);

  return {
    ...session,                       // token, refreshToken, refreshExpiresAt
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

module.exports = { signup, getKdfParams, login, issueSession, refresh, logout };