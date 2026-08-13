const crypto = require('crypto');
const { pad, unpad } = require('./padding');

const NONCE_LENGTH = 12;   // 96 bits, the standard for AES-GCM

/** Encrypt raw bytes. Returns base64 parts. */
function encryptBytes(plaintext, key) {
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

/** Decrypt back to raw bytes. Throws if tampered or wrong key. */
function decryptBytes({ ciphertext, nonce, authTag }, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', key, Buffer.from(nonce, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]);
}

/**
 * Encrypt a JS object, padded to a fixed bucket.
 *
 * Padding is applied HERE and not in encryptBytes, deliberately: the
 * DEK wrappers also go through encryptBytes, and they are always
 * exactly 32 bytes — there is nothing to hide, and padding them would
 * change the format of every existing account's wrapped_dek.
 */
function encryptItem(obj, key) {
  return encryptBytes(Buffer.from(pad(Buffer.from(JSON.stringify(obj), 'utf8'))), key);
}

/** Decrypt back to a JS object. */
function decryptItem(blob, key) {
  return JSON.parse(Buffer.from(unpad(decryptBytes(blob, key))).toString('utf8'));
}

module.exports = { NONCE_LENGTH, encryptBytes, decryptBytes, encryptItem, decryptItem };