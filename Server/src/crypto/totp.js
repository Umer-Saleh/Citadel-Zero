const crypto = require('crypto');
const { TOTP, Secret } = require('otpauth');

/**
 * TOTP (RFC 6238).
 *
 * WHAT THIS PROTECTS: the API, not the vault. The vault is sealed
 * under a key derived from the master password, which the server
 * never sees — a server-side check cannot gate access to a key that
 * never reaches the server. What it does gate is the ENCRYPTED BLOBS:
 * a stolen password alone can no longer pull down wrappedDek and the
 * vault items, and without the ciphertext the password is useless.
 *
 * The secret is stored in plaintext because TOTP is symmetric — the
 * server must hold the same secret the phone does. That is precisely
 * why nothing in the key hierarchy derives from it.
 */

const PERIOD = 30;      // seconds per code, per RFC 6238
const DIGITS = 6;
const ALGORITHM = 'SHA1';   // what every authenticator app expects

/**
 * How many time-steps either side of "now" to accept.
 *
 * 1 means a code stays valid for roughly 90 seconds total. That's the
 * standard tolerance for clock drift between a phone and a server —
 * without it, a phone a few seconds slow can never log in. Widening
 * it further would grow the replay window for no real benefit.
 */
const WINDOW = 1;

const ISSUER = 'Citadel Zero';

function generateSecret() {
  // 20 bytes = 160 bits, the RFC 4226 recommendation for HMAC-SHA1.
  return new Secret({ size: 20 }).base32;
}

function makeTotp(secret) {
  return new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret)
  });
}

/**
 * The otpauth:// URI an authenticator app scans.
 * The label carries the account so a user with several vaults can
 * tell the entries apart.
 */
function buildUri(secret, email) {
  const totp = makeTotp(secret);
  totp.label = email;
  return totp.toString();
}

/**
 * Verify a code.
 *
 * @returns the time-step the code matched, or null if it didn't.
 *
 * Returning the STEP rather than a boolean is what makes replay
 * protection possible: the caller stores it and refuses anything at
 * or below it next time. A boolean would leave a valid code reusable
 * for its whole 90-second window.
 */
function verifyCode(secret, code) {
  // Reject anything that isn't six digits before doing crypto — it
  // can't be valid, and it keeps malformed input out of the library.
  if (!/^\d{6}$/.test(code)) return null;

  const delta = makeTotp(secret).validate({ token: code, window: WINDOW });

  // validate() returns the offset in steps, or null. 0 is a valid
  // result meaning "current step", so check for null explicitly —
  // `if (!delta)` would reject the most common case.
  if (delta === null) return null;

  return Math.floor(Date.now() / 1000 / PERIOD) + delta;
}

/**
 * Backup codes, for a lost phone. Ten codes, 10 hex chars each
 * (~40 bits) — enough that guessing is hopeless, short enough to
 * write on paper.
 */
function generateBackupCodes(count = 10) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex')
  );
}

function hashBackupCode(code) {
  // SHA-256, same reasoning as refresh tokens: the input is random
  // and high-entropy, so there is no low-entropy guess for a slow
  // hash to defend against.
  return crypto.createHash('sha256')
    .update(code.toLowerCase().replace(/\s|-/g, ''))
    .digest('hex');
}

module.exports = {
  generateSecret, buildUri, verifyCode,
  generateBackupCodes, hashBackupCode,
  PERIOD, WINDOW, DIGITS
};