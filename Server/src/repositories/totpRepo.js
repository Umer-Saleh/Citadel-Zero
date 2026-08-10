const db = require('../db');

function q(client) {
  return client || db;
}

/**
 * Store a secret WITHOUT enabling 2FA. Enrolment generates a secret
 * and shows a QR code, but the user hasn't proved they scanned it
 * yet — enabling here would lock out anyone who closed the tab.
 */
async function setSecret(userId, secret, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users SET totp_secret = $1, totp_enabled = false, totp_last_step = NULL
     WHERE id = $2`,
    [secret, userId]
  );
  return rowCount > 0;
}

/** Flip the switch, once a valid code has proved enrolment worked. */
async function enable(userId, lastStep, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users SET totp_enabled = true, totp_last_step = $1
     WHERE id = $2 AND totp_secret IS NOT NULL`,
    [lastStep, userId]
  );
  return rowCount > 0;
}

/** Turn 2FA off and clear everything, so re-enrolling starts fresh. */
async function disable(userId, client) {
  const { rowCount } = await q(client).query(
    `UPDATE users
     SET totp_secret = NULL, totp_enabled = false, totp_last_step = NULL
     WHERE id = $1`,
    [userId]
  );
  return rowCount > 0;
}

/**
 * Consume a time-step, atomically.
 *
 * The `totp_last_step < $1` guard is the replay protection, and it has
 * to live in the WHERE clause for the same reason markUsed does: a
 * read-then-write lets two requests carrying the SAME observed code
 * both pass the check before either writes. Doing it inside the
 * UPDATE means Postgres serialises them and exactly one wins.
 *
 * COALESCE handles the first use, where last_step is NULL.
 */
async function consumeStep(userId, step, client) {
  const { rows } = await q(client).query(
    `UPDATE users SET totp_last_step = $1
     WHERE id = $2 AND COALESCE(totp_last_step, -1) < $1
     RETURNING id`,
    [step, userId]
  );
  return rows.length > 0;
}

async function findTotpByEmail(email, client) {
  const { rows } = await q(client).query(
    `SELECT id, totp_secret, totp_enabled, totp_last_step
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function findTotpById(id, client) {
  const { rows } = await q(client).query(
    `SELECT id, email, totp_secret, totp_enabled, totp_last_step
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** Replace the whole set. Issuing new codes invalidates the old ones. */
async function replaceBackupCodes(userId, hashes, client) {
  const c = q(client);
  await c.query(`DELETE FROM totp_backup_codes WHERE user_id = $1`, [userId]);

  for (const hash of hashes) {
    await c.query(
      `INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)`,
      [userId, hash]
    );
  }
}

/**
 * Spend a backup code. Same conditional-UPDATE pattern: the
 * `used_at IS NULL` guard makes single-use atomic rather than
 * checked-then-written.
 */
async function consumeBackupCode(userId, codeHash, client) {
  const { rows } = await q(client).query(
    `UPDATE totp_backup_codes SET used_at = now()
     WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
     RETURNING id`,
    [userId, codeHash]
  );
  return rows.length > 0;
}

async function countUnusedBackupCodes(userId, client) {
  const { rows } = await q(client).query(
    `SELECT count(*)::int AS n FROM totp_backup_codes
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return rows[0].n;
}

module.exports = {
  setSecret, enable, disable, consumeStep,
  findTotpByEmail, findTotpById,
  replaceBackupCodes, consumeBackupCode, countUnusedBackupCodes
};