const crypto = require('crypto');
const { hkdf } = require('./keys');

const RECOVERY_KEY_BYTES = 16;   // 128 bits

/**
 * Generate a recovery key: 128 bits of entropy, formatted in groups
 * for a human to write down or print.
 *
 * Crockford base32 — no I, L, O, or U — so 0/O and 1/I cannot be
 * confused when transcribed by hand.
 */
function generateRecoveryKey() {
  const bytes = crypto.randomBytes(RECOVERY_KEY_BYTES);
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }

  // 128 bits does not divide evenly into 5-bit base32 characters.
  // Pad to 130 so we get exactly 26 characters — a clean 6+6+6+4
  // grouping with no stray single character to mistype.
  bits = bits.padEnd(130, '0');

  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }

  // Groups of four: A3F9-K2M8-QR47-...
  return out.match(/.{1,4}/g).join('-');
}

/**
 * Derive a KEK from the recovery key.
 *
 * Argon2id is deliberately NOT used here. Argon2id exists to make
 * guessing a low-entropy human password expensive. A 128-bit
 * machine-generated key has nothing to guess — brute-forcing it is
 * infeasible regardless of KDF speed — so a fast KDF is correct.
 */
function deriveRecoveryKek(recoveryKey, salt) {
  const normalized = recoveryKey.replace(/-/g, '').toUpperCase();

  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(normalized, 'utf8'), salt, 'recovery-kek', 32)
  );
}

/**
 * Derive the recovery key's PROOF OF POSSESSION from the same key.
 *
 * Domain separation is the whole point. This differs from
 * deriveRecoveryKek only in the HKDF info label, which puts the two
 * outputs in different PRF domains: recovering one tells you nothing
 * about the other without breaking HMAC-SHA256. It is the same split
 * keys.js already makes between "auth" and "kek" for the master
 * password, applied to the second door.
 *
 * So the value below can be sent to the server and stored there —
 * hardened again with Argon2, exactly like authHash — while the KEK
 * that actually opens the vault never leaves the client.
 *
 * Argon2id is deliberately NOT used here, for the same reason
 * deriveRecoveryKek does not use it: a 128-bit machine-generated key
 * has nothing to guess, so a slow KDF would cost time and buy nothing.
 */
function deriveRecoveryAuthHash(recoveryKey, salt) {
  const normalized = recoveryKey.replace(/-/g, '').toUpperCase();

  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(normalized, 'utf8'), salt, 'recovery-auth', 32)
  );
}

module.exports = {
  generateRecoveryKey, deriveRecoveryKek, deriveRecoveryAuthHash, RECOVERY_KEY_BYTES
};