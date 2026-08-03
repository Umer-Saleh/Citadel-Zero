import { utf8 } from './bytes';
import { KEY_LENGTH } from './keys';

const RECOVERY_KEY_BYTES = 16;   // 128 bits
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a recovery key: 128 bits of entropy, formatted for a human
 * to write down.
 *
 * Crockford base32 — no I, L, O, or U — so 0/O and 1/I cannot be
 * confused when transcribed by hand from paper.
 */
export function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));

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
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }

  return out.match(/.{1,4}/g).join('-');
}

/**
 * Derive a KEK from the recovery key.
 *
 * Argon2id is deliberately NOT used. It exists to make guessing a
 * low-entropy human password expensive; a 128-bit machine-generated
 * key has nothing to guess, so a fast KDF is correct here.
 */
export async function deriveRecoveryKek(recoveryKey, salt) {
  const normalized = recoveryKey.replace(/-/g, '').toUpperCase();

  const ikm = await crypto.subtle.importKey(
    'raw', utf8(normalized), 'HKDF', false, ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('recovery-kek') },
    ikm,
    KEY_LENGTH * 8
  );

  return new Uint8Array(bits);
}