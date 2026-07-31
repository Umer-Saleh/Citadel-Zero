const { query } = require('../db');

async function findByEmail(email) {
  const { rows } = await query(
    'SELECT id, email, kdf_salt, kdf_params, auth_hash FROM users WHERE email = $1',
    [email]
  );
  return rows[0] || null;
}

async function create({ email, kdfSalt, kdfParams, authHash }) {
  const { rows } = await query(
    `INSERT INTO users (email, kdf_salt, kdf_params, auth_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [email, kdfSalt, kdfParams, authHash]
  );
  return rows[0];
}

module.exports = { findByEmail, create };