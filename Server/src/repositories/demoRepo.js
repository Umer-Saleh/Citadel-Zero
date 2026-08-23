const { query } = require('../db');

/**
 * Reads for the demo instance's "what the server actually stores"
 * panel.
 *
 * Separate from userRepo and vaultRepo on purpose. Those return
 * whatever their callers need, including auth_hash and totp_secret;
 * this file exists so the columns the panel exposes are a short,
 * fixed, reviewable list rather than a filter someone has to remember
 * to keep applying.
 *
 * Every query takes a userId and is scoped by it. Nothing here can
 * read "all users" — there is no query that could.
 */

/**
 * The stored account material.
 *
 * NOT selected, and it matters more than what is:
 *   auth_hash        the stored login credential
 *   totp_secret      the one secret the server necessarily holds
 *                    in plaintext
 *   totp_last_step   nothing to show, and it moves
 *
 * What IS selected is already obtainable by anyone: kdf_salt and
 * kdf_params come back from the unauthenticated /api/user/kdf-params,
 * the recovery material from /api/account/recovery-material, and
 * wrapped_dek from any successful login — and this account's password
 * is printed on its own unlock screen.
 */
async function accountMaterial(userId) {
  const { rows } = await query(
    `SELECT email, kdf_salt, kdf_params,
            wrapped_dek, wrapped_dek_nonce, wrapped_dek_tag,
            recovery_salt,
            recovery_wrapped_dek, recovery_wrapped_dek_nonce,
            recovery_wrapped_dek_tag
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/** The raw ciphertext rows, exactly as they sit on disk. */
async function storedItems(userId) {
  const { rows } = await query(
    `SELECT id, encrypted_data, nonce, auth_tag, updated_at
     FROM vault_items
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId]
  );
  return rows;
}

module.exports = { accountMaterial, storedItems };
