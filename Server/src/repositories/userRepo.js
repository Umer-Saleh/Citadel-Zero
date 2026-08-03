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
async function create({ email, kdfSalt, kdfParams, authHash, wrappedDek }) {
  const { rows } = await query(
    `INSERT INTO users (email, kdf_salt, kdf_params, auth_hash, wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email`,
    [email, kdfSalt, kdfParams, authHash,
     wrappedDek.ciphertext, wrappedDek.nonce, wrappedDek.authTag]
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

module.exports = { findByEmail, findById, create, updateCredentials };