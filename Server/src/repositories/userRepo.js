const { query } = require('../db');

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

module.exports = { findByEmail, create };