const config = require('../config');
const demoRepo = require('../repositories/demoRepo');
const { AppError } = require('../errors/AppError');

/**
 * "What the server actually stores", for the public demo.
 *
 * The README invites a reader to run
 *
 *     SELECT encrypted_data, nonce FROM vault_items;
 *
 * and compare it against what the client displays. That is the whole
 * claim of the project, and on a hosted demo nobody can run it. This
 * serves the same rows over HTTP so the browser can put them beside
 * the plaintext it decrypted a moment earlier.
 *
 * Reading them back from the database, rather than assembling the
 * panel out of values the client already holds, is the point. The
 * client could build the same view from its login response and its
 * vault fetch — but then it would be showing its own variables, and
 * "this is what is in Postgres right now" would be an assertion
 * instead of evidence.
 *
 * ---------------------------------------------------------------
 * WHAT IT DISCLOSES, AND TO WHOM
 * ---------------------------------------------------------------
 * Only rows belonging to the AUTHENTICATED CALLER. The user id comes
 * from the verified JWT, exactly as it does for every vault route,
 * and there is no parameter that names an account.
 *
 * Every field is something that caller already has:
 *
 *   kdf_salt, kdf_params      returned by /api/user/kdf-params
 *   recovery material         returned by /api/account/recovery-material
 *   wrapped_dek               returned in their own login response
 *   vault ciphertext          returned by GET /api/vault
 *
 * So it adds no disclosure for the person calling it. It removes two
 * API calls and one client-side assembly step.
 *
 * None of it is key material. Every wrapper is sealed under a key
 * derived from a password the server has never held, which is exactly
 * the point the panel exists to demonstrate. auth_hash and
 * totp_secret are not selected at all — see demoRepo.
 *
 * ---------------------------------------------------------------
 * THIS IS WEAKER THAN WHAT IT REPLACED. SAYING SO PLAINLY.
 * ---------------------------------------------------------------
 * This route used to be PINNED: the user id was resolved once from
 * DEMO_EMAIL and cached, never taken from a request, so it could read
 * exactly one hardcoded row and nothing else. No input existed to get
 * wrong.
 *
 * That property is gone. It depended on there being a single shared
 * demo account, and per-visitor demo vaults remove that account
 * deliberately — one shared identity is something any visitor can
 * brick for every later visitor.
 *
 * What is left is ordinary ownership scoping: the same guarantee
 * GET /api/vault gives, no better. A bug in requireAuth or in the
 * user id it puts on the request would now expose another visitor's
 * ciphertext here, where before it could not. That is a genuine
 * reduction, accepted because the alternative was a shared account
 * anyone could take over, and because the blast radius is one
 * throwaway vault of invented data that the nightly wipe deletes.
 */

async function storedMaterial(userId) {
  if (!config.demoMode) {
    // Unreachable: the route is not mounted without demo mode. Kept
    // so the service cannot be called into service by anything else.
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const account = await demoRepo.accountMaterial(userId);

  // The account vanished under a live session — the nightly wipe is
  // the ordinary cause. Nothing to reconcile now that there is no
  // shared identity to re-resolve: the caller's own account is simply
  // gone, and they need to provision a new vault.
  if (!account) throw new AppError('NOT_FOUND', 404, 'not found');

  const items = await demoRepo.storedItems(userId);

  return {
    account: {
      email: account.email,
      kdfSalt: account.kdf_salt,
      kdfParams: account.kdf_params,
      wrappedDek: {
        ciphertext: account.wrapped_dek,
        nonce: account.wrapped_dek_nonce,
        authTag: account.wrapped_dek_tag
      },
      recoverySalt: account.recovery_salt,
      recoveryWrappedDek: {
        ciphertext: account.recovery_wrapped_dek,
        nonce: account.recovery_wrapped_dek_nonce,
        authTag: account.recovery_wrapped_dek_tag
      }
    },
    items: items.map(row => ({
      id: row.id,
      encryptedData: row.encrypted_data,
      nonce: row.nonce,
      authTag: row.auth_tag,
      updatedAt: row.updated_at
    }))
  };
}

module.exports = { storedMaterial };
