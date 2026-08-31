const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepo = require('../repositories/userRepo');
const refreshTokenRepo = require('../repositories/refreshTokenRepo');
const totpRepo = require('../repositories/totpRepo');
const { serverStoreAuth, serverVerifyAuth } = require('../auth');
const { AppError } = require('../errors/AppError');
const {
  needsKdfUpgrade, DEFAULT_KDF_PARAMS, generateToken, hashToken,
  generateSecret, buildUri, verifyCode, generateBackupCodes, hashBackupCode
} = require('../crypto');
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
                        recoverySalt, recoveryWrappedDek, recoveryAuthHash }) {
  try {
    // Both credentials get the same treatment: the client's hash is
    // re-hashed before storage, so a stolen column is not replayable
    // against the endpoint that accepts it. recoveryAuthHash is the
    // recovery key's equivalent of authHash — proof of possession,
    // never a decryption key.
    const stored = await serverStoreAuth(authHash);
    const storedRecovery = await serverStoreAuth(recoveryAuthHash);

    return await userRepo.create({
      email, kdfSalt, kdfParams, authHash: stored, wrappedDek,
      recoverySalt, recoveryWrappedDek,
      recoveryAuthHash: storedRecovery
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

  return {
    kdfSalt: user.kdf_salt,
    kdfParams: user.kdf_params,
    // The unlock screen needs this before it can render — it decides
    // whether to show a TOTP field alongside the password.
    totpEnabled: user.totp_enabled
  };
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

  // Expired-token cleanup lives in server.js on an interval now, not
  // here — sweeping on login meant a dormant account kept its rows
  // forever, and it put a DELETE on the login path for no reason.

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

// ---------------------------------------------------------------
// TOTP
//
// WHAT THIS PROTECTS: the API, not the vault. The vault is sealed
// under a key derived from the master password, which the server
// never sees — a server-side check cannot gate a key that never
// arrives. What it gates is the ENCRYPTED BLOBS: a stolen password
// alone can no longer pull down wrappedDek and the vault items, and
// without the ciphertext the password is useless.
// ---------------------------------------------------------------

/**
 * Begin enrolment: generate a secret and return the URI to scan.
 *
 * Does NOT enable 2FA. The user has to prove they scanned it by
 * entering a valid code first — enabling here would lock out anyone
 * who closed the tab before finishing.
 */
async function beginTotpEnrolment(userId) {
  const user = await totpRepo.findTotpById(userId);
  if (!user) throw new AppError('NOT_FOUND', 404, 'not found');

  if (user.totp_enabled) {
    throw new AppError('TOTP_ALREADY_ENABLED', 409, 'two-factor is already on');
  }

  const secret = generateSecret();
  await totpRepo.setSecret(userId, secret);

  return {
    secret,                              // shown as text, for manual entry
    uri: buildUri(secret, user.email)    // for the QR code
  };
}

/**
 * Finish enrolment: verify a code, enable 2FA, issue backup codes.
 * The codes are returned ONCE; only their hashes are kept, exactly
 * like the recovery key at signup.
 */
async function confirmTotpEnrolment(userId, code) {
  const user = await totpRepo.findTotpById(userId);
  if (!user) throw new AppError('NOT_FOUND', 404, 'not found');

  if (user.totp_enabled) {
    throw new AppError('TOTP_ALREADY_ENABLED', 409, 'two-factor is already on');
  }
  if (!user.totp_secret) {
    throw new AppError('TOTP_NOT_STARTED', 409, 'no enrolment in progress');
  }

  const step = verifyCode(user.totp_secret, code);
  if (step === null) {
    throw new AppError('INVALID_TOTP_CODE', 401, 'invalid code');
  }

  const codes = generateBackupCodes();

  // Enabling and issuing backup codes must land together. Enabling
  // without codes leaves no way back from a lost phone; codes without
  // enabling are meaningless.
  await withTransaction(async (client) => {
    await totpRepo.enable(userId, step, client);
    await totpRepo.replaceBackupCodes(userId, codes.map(hashBackupCode), client);
  });

  console.log(`[server] TOTP enabled for user ${user.id}`);

  return { backupCodes: codes };   // shown once, then gone
}

/**
 * Turn 2FA off. Requires a current code — otherwise anyone who
 * borrowed an unlocked session could quietly remove the second factor.
 */
async function disableTotp(userId, code) {
  const user = await totpRepo.findTotpById(userId);
  if (!user) throw new AppError('NOT_FOUND', 404, 'not found');

  if (!user.totp_enabled) {
    throw new AppError('TOTP_NOT_ENABLED', 409, 'two-factor is not on');
  }

  const ok = await checkTotp(user, code);
  if (!ok) throw new AppError('INVALID_TOTP_CODE', 401, 'invalid code');

  await withTransaction(async (client) => {
    await totpRepo.disable(userId, client);
    await totpRepo.replaceBackupCodes(userId, [], client);
  });

  console.log(`[server] TOTP disabled for user ${user.id}`);
}

/**
 * Verify a TOTP code OR a backup code, consuming whichever matched.
 *
 * Not exported — used by login and disableTotp within this module.
 * Returns a boolean so the caller picks the error, letting login keep
 * its single INVALID_CREDENTIALS response.
 */
async function checkTotp(user, code) {
  if (!code) return false;

  const step = verifyCode(user.totp_secret, code);

  if (step !== null) {
    // consumeStep is a conditional UPDATE, so a code that already
    // advanced last_step is refused even though it's still inside its
    // 90-second window. That's what makes each code single-use.
    return totpRepo.consumeStep(user.id, step);
  }

  // Not a TOTP code — try it as a backup code.
  return totpRepo.consumeBackupCode(user.id, hashBackupCode(code));
}

async function login({ email, authHash, totpCode }) {
  const user = await userRepo.findByEmail(email);

  // Always verify, even for unknown accounts, so response time does
  // not reveal whether the email is registered.
  const valid = await serverVerifyAuth(authHash, user ? user.auth_hash : DUMMY_HASH).catch(() => false);

  if (!user || !valid) {
    // The id, not the email. A failed-login log is exactly where an
    // attacker's list of probed addresses would otherwise accumulate,
    // and for an unknown account there is no id to write at all.
    console.warn(`[server] failed login for ${user ? `user ${user.id}` : 'unknown account'}`);
    throw new AppError('INVALID_CREDENTIALS', 401, 'invalid credentials');
  }

  if (user.totp_enabled) {
    const ok = await checkTotp(user, totpCode);

    if (!ok) {
      console.warn(`[server] failed TOTP for user ${user.id}`);
      // Deliberately the SAME error as a wrong password. A distinct
      // code would confirm to an attacker that the password they hold
      // is live, letting them focus phishing on exactly those accounts.
      throw new AppError('INVALID_CREDENTIALS', 401, 'invalid credentials');
    }
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

module.exports = {
  signup, getKdfParams, login, issueSession, refresh, logout,
  beginTotpEnrolment, confirmTotpEnrolment, disableTotp,
  // Exported so accountService can spend the same Argon2 work on a
  // recovery attempt for an account that does not exist. One
  // definition, so the two paths cannot drift apart on cost.
  DUMMY_HASH
};