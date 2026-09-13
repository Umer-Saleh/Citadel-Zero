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
 *
 * UNCAPPED HERE, ON PURPOSE, AND THAT IS AN ASYMMETRY WORTH KNOWING.
 *
 * The browser's copy of this function refuses an item over the largest
 * padding bucket the transport can carry — 65,532 bytes, see
 * Web/src/crypto/cipher.js — because anything larger is a request the
 * server would answer with a 413 at a size where no retry helps.
 *
 * This copy has no such cap and does not need one. Nothing in the
 * running server calls it: outside the tests, its only caller is
 * scripts/generate-vectors.js, which writes test vectors to files and
 * never touches the database. The seed that once encrypted demo
 * entries with it is a no-op now, and the demo fixtures live in
 * Web/src/lib/demoFixtures.js, where they pass through the browser's
 * cap like any other entry.
 *
 * So no server path writes an item row at all, and none can write one
 * larger than a client could upload. If a script that writes items
 * directly is ever added, it needs the cap too: such a row would
 * decrypt perfectly well — unpad reads the length from the prefix and
 * does not care which bucket it came from — and would then be
 * unsavable the moment someone opened it and pressed SAVE. That is the
 * symptom to look for, and why this is written down.
 */
function encryptItem(obj, key) {
  return encryptBytes(Buffer.from(pad(Buffer.from(JSON.stringify(obj), 'utf8'))), key);
}

/** Decrypt back to a JS object. */
function decryptItem(blob, key) {
  return JSON.parse(Buffer.from(unpad(decryptBytes(blob, key))).toString('utf8'));
}

module.exports = { NONCE_LENGTH, encryptBytes, decryptBytes, encryptItem, decryptItem };