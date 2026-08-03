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

module.exports = { generateRecoveryKey, deriveRecoveryKek, RECOVERY_KEY_BYTES };