const db = require('../db');

/**
 * @param client  optional pg client, so a service inside
 *                withTransaction can share the transaction. Falls
 *                back to the pool for standalone calls.
 *
 * Repos deliberately do NOT open transactions. Only the service knows
 * which writes must land together — a repo that opens its own can't
 * be composed with anything else, and a single UPDATE is already
 * atomic without one.
 */
function q(client) {
  return client || db;
}

async function findByEmail(email, client) {
  const { rows } = await q(client).query(
    `SELECT id, email, kdf_salt, kdf_params, auth_hash,
            wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag,
            totp_secret, totp_enabled, totp_last_step
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function create({ email, kdfSalt, kdfParams, authHash, wrappedDek,
                        recoverySalt, recoveryWrappedDek }, client) {
  const { rows } = await q(client).query(
    `INSERT INTO users (email, kdf_salt, kdf_params, auth_hash,
                        wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag,
                        recovery_salt, recovery_wrapped_dek,
                        recovery_wrapped_dek_nonce, recovery_wrapped_dek_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, email`,
    [email, kdfSalt, kdfParams, authHash,
     wrappedDek.ciphertext, wrappedDek.nonce, wrappedDek.authTag,
     recoverySalt, recoveryWrappedDek.ciphertext,
     recoveryWrappedDek.nonce, recoveryWrappedDek.authTag]
  );
  return rows[0];
}

async function findById(id, client) {
  const { rows } = await q(client).query(
    `SELECT id, email, kdf_salt, kdf_params, auth_hash,
            wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Replace credentials. All four values derive from the new password,
 * and they move in one UPDATE — a partial write would let the user
 * log in while locking them out of their own vault.
 */
async function updateCredentials(userId, { authHash, kdfSalt, kdfParams, wrappedDek }, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users
     SET auth_hash = $1, kdf_salt = $2, kdf_params = $3,
         wrapped_dek = $4, wrapped_dek_nonce = $5, wrapped_dek_tag = $6
     WHERE id = $7`,
    [authHash, kdfSalt, kdfParams,
     wrappedDek.ciphertext, wrappedDek.nonce, wrappedDek.authTag,
     userId]
  );
  return rowCount > 0;
}

async function updateRecoveryWrapper(userId, { recoverySalt, recoveryWrappedDek }, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users
     SET recovery_salt = $1, recovery_wrapped_dek = $2,
         recovery_wrapped_dek_nonce = $3, recovery_wrapped_dek_tag = $4
     WHERE id = $5`,
    [recoverySalt, recoveryWrappedDek.ciphertext,
     recoveryWrappedDek.nonce, recoveryWrappedDek.authTag, userId]
  );
  return rowCount > 0;
}

/** Public recovery material, needed before the client can derive anything. */
async function findRecoveryByEmail(email, client) {
  const { rows } = await q(client).query(
    `SELECT id, email, recovery_salt, recovery_wrapped_dek,
            recovery_wrapped_dek_nonce, recovery_wrapped_dek_tag
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

/**
 * Raise an account's KDF parameters. Same SQL as updateCredentials,
 * but semantically distinct: the password is unchanged, only the cost
 * of deriving from it.
 */
async function upgradeKdf(userId, { authHash, kdfSalt, kdfParams, wrappedDek }, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users
     SET auth_hash = $1, kdf_salt = $2, kdf_params = $3,
         wrapped_dek = $4, wrapped_dek_nonce = $5, wrapped_dek_tag = $6
     WHERE id = $7`,
    [authHash, kdfSalt, kdfParams,
     wrappedDek.ciphertext, wrappedDek.nonce, wrappedDek.authTag,
     userId]
  );
  return rowCount > 0;
}

module.exports = {
  findByEmail, findById, create, updateCredentials,
  updateRecoveryWrapper, findRecoveryByEmail, upgradeKdf
};