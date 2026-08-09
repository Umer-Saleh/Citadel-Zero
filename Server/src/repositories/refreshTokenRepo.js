const db = require('../db');

/**
 * Refresh token storage. SQL only — the decision about what a reused
 * token MEANS belongs in authService, not here.
 */

/**
 * @param client  optional pg client, so callers inside withTransaction
 *                can share the transaction. Falls back to the pool.
 */
function q(client) {
  return client || db;
}

async function insert({ familyId, userId, tokenHash, expiresAt }, client) {
  const { rows } = await q(client).query(
    `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, family_id, user_id, expires_at, created_at`,
    [familyId, userId, tokenHash, expiresAt]
  );
  return rows[0];
}

/**
 * Look up by hash. Returns the row whether or not it's spent, expired,
 * or revoked — the service needs to see those states to tell a normal
 * rotation from a reuse attempt.
 */
async function findByHash(tokenHash, client) {
  const { rows } = await q(client).query(
    `SELECT id, family_id, user_id, used_at, revoked_at, expires_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

/**
 * Mark spent. The `used_at IS NULL` guard makes this atomic: two
 * concurrent refreshes with the same token race here, and exactly one
 * gets a row back. The loser is a reuse attempt by definition.
 */
async function markUsed(id, client) {
  const { rows } = await q(client).query(
    `UPDATE refresh_tokens
     SET used_at = now()
     WHERE id = $1 AND used_at IS NULL
     RETURNING id`,
    [id]
  );
  return rows[0] || null;
}

/** Kill an entire login session. Called on reuse detection and logout. */
async function revokeFamily(familyId, client) {
  const { rows } = await q(client).query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE family_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [familyId]
  );
  return rows.length;
}

/** Kill every session a user has. Called on password change. */
async function revokeAllForUser(userId, client) {
  const { rows } = await q(client).query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [userId]
  );
  return rows.length;
}

/** Housekeeping. Nothing calls this yet — see the note below. */
async function deleteExpired(client) {
  const { rows } = await q(client).query(
    `DELETE FROM refresh_tokens
     WHERE expires_at < now()
     RETURNING id`
  );
  return rows.length;
}

module.exports = {
  insert,
  findByHash,
  markUsed,
  revokeFamily,
  revokeAllForUser,
  deleteExpired
};