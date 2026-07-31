const { query } = require('../db');

async function listByUser(userId) {
  const { rows } = await query(
    `SELECT id, encrypted_data, nonce, auth_tag, updated_at
     FROM vault_items
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId]
  );
  return rows;
}

async function create(userId, { ciphertext, nonce, authTag }) {
  const { rows } = await query(
    `INSERT INTO vault_items (user_id, encrypted_data, nonce, auth_tag)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, ciphertext, nonce, authTag]
  );
  return rows[0];
}

async function update(userId, itemId, { ciphertext, nonce, authTag }) {
  const { rowCount } = await query(
    `UPDATE vault_items
     SET encrypted_data = $1, nonce = $2, auth_tag = $3, updated_at = now()
     WHERE id = $4 AND user_id = $5`,
    [ciphertext, nonce, authTag, itemId, userId]
  );
  return rowCount > 0;
}

async function remove(userId, itemId) {
  const { rowCount } = await query(
    'DELETE FROM vault_items WHERE id = $1 AND user_id = $2',
    [itemId, userId]
  );
  return rowCount > 0;
}

module.exports = { listByUser, create, update, remove };