const crypto = require('crypto');
const { encryptBytes, decryptBytes } = require('./cipher');
const { KEY_LENGTH } = require('./keys');

/**
 * Generate a random Data Encryption Key.
 *
 * The DEK encrypts vault items and never changes for the lifetime of
 * the account. It is random rather than derived, so it survives a
 * master password change.
 */
function generateDEK() {
  return crypto.randomBytes(KEY_LENGTH);
}

/** Encrypt the DEK under the password-derived KEK. */
function wrapDEK(dek, kek) {
  return encryptBytes(dek, kek);
}

/** Recover the DEK. Throws if the KEK is wrong or the wrapper was tampered with. */
function unwrapDEK(wrapped, kek) {
  return decryptBytes(wrapped, kek);
}

module.exports = { generateDEK, wrapDEK, unwrapDEK };