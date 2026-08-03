const { query, withTransaction } = require('../db');

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, kdf_salt, kdf_params, auth_hash,
            wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}
async function create({ email, kdfSalt, kdfParams, authHash, wrappedDek,
                        recoverySalt, recoveryWrappedDek }) {
  const { rows } = await query(
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

async function findById(id) {
  const { rows } = await query(
    `SELECT id, email, kdf_salt, kdf_params, auth_hash,
            wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Replace credentials atomically. All four values derive from the
 * new password; a partial write would lock the user out of their
 * own vault while still letting them log in.
 */
async function updateCredentials(userId, { authHash, kdfSalt, kdfParams, wrappedDek }) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users
       SET auth_hash = $1, kdf_salt = $2, kdf_params = $3,
           wrapped_dek = $4, wrapped_dek_nonce = $5, wrapped_dek_tag = $6
       WHERE id = $7`,
      [authHash, kdfSalt, kdfParams,
       wrappedDek.ciphertext, wrappedDek.nonce, wrappedDek.authTag,
       userId]
    );
    return rowCount > 0;
  });
}

async function updateRecoveryWrapper(userId, { recoverySalt, recoveryWrappedDek }) {
  const { rowCount } = await query(
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
async function findRecoveryByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, recovery_salt, recovery_wrapped_dek,
            recovery_wrapped_dek_nonce, recovery_wrapped_dek_tag
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}


module.exports = { findByEmail, findById, create, updateCredentials, updateRecoveryWrapper, findRecoveryByEmail };