import { encryptBytes, decryptBytes } from './cipher';
import { KEY_LENGTH } from './keys';

/**
 * Generate a random Data Encryption Key.
 *
 * The DEK encrypts vault items and never changes for the lifetime of
 * the account. It is random rather than derived, so it survives a
 * master password change.
 */
export function generateDEK() {
  return crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
}

/** Encrypt the DEK under the password-derived KEK. */
export async function wrapDEK(dek, kek) {
  return encryptBytes(dek, kek);
}

/** Recover the DEK. Throws if the KEK is wrong or the wrapper was tampered with. */
export async function unwrapDEK(wrapped, kek) {
  return decryptBytes(wrapped, kek);
}