const config = require('../config');
const userRepo = require('../repositories/userRepo');
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
 * ---------------------------------------------------------------
 * WHY THIS DOES NOT WEAKEN ANYTHING
 * ---------------------------------------------------------------
 * It discloses a strict SUBSET of what the demo account already
 * discloses to anyone at all, because that account's password is
 * published on its own unlock screen:
 *
 *   kdf_salt, kdf_params      already public, unauthenticated, from
 *                             /api/user/kdf-params
 *   recovery material         already public, unauthenticated, from
 *                             /api/account/recovery-material
 *   wrapped_dek               returned by any successful login, and
 *                             anyone can log in to this account
 *   vault ciphertext          returned by GET /api/vault to any
 *                             session, and anyone can obtain one
 *
 * So it adds no disclosure. It removes two API calls.
 *
 * None of it is key material. Every wrapper is sealed under a key
 * derived from a password the server has never held, which is exactly
 * the point the panel exists to demonstrate. auth_hash and
 * totp_secret are not selected at all — see demoRepo.
 *
 * ---------------------------------------------------------------
 * THE PIN
 * ---------------------------------------------------------------
 * The user id is resolved once, from DEMO_EMAIL, and cached. It is
 * never taken from a request, a session, or a token. There is no
 * parameter a caller can influence, so no input to get wrong: the
 * route reads one specific row or it reads nothing. If the demo
 * account does not exist, it 404s.
 */

// Resolved lazily and cached — the account is seeded after the API
// starts, so the id does not exist at boot.
let demoUserId = null;

async function resolveDemoUserId() {
  if (demoUserId) return demoUserId;

  const user = await userRepo.findByEmail(config.DEMO_EMAIL);
  if (!user) return null;

  demoUserId = user.id;
  return demoUserId;
}

/**
 * Forget the cached id. The nightly wipe deletes and recreates the
 * account, so the id changes underneath a long-running process.
 */
function forgetDemoUser() {
  demoUserId = null;
}

async function storedMaterial() {
  if (!config.demoMode) {
    // Unreachable: the route is not mounted without demo mode. Kept
    // so the service cannot be called into service by anything else.
    throw new AppError('NOT_FOUND', 404, 'not found');
  }

  const userId = await resolveDemoUserId();
  if (!userId) throw new AppError('NOT_FOUND', 404, 'demo account not seeded');

  const account = await demoRepo.accountMaterial(userId);

  if (!account) {
    // Seeded once, then wiped. Drop the stale id and report honestly.
    forgetDemoUser();
    throw new AppError('NOT_FOUND', 404, 'demo account not seeded');
  }

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

module.exports = { storedMaterial, forgetDemoUser };
