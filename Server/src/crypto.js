const crypto = require('crypto');
const argon2 = require('argon2');

// Default KDF parameters for NEW accounts.
// Stored per-user in the DB so these can be raised later without breaking old accounts.
const DEFAULT_KDF_PARAMS = {
  m: 131072,   // 128 MiB
  t: 2,        // iterations
  p: 1         // parallelism
};

const KEY_LENGTH = 32;    // 256-bit keys
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;  // 96 bits, the standard for AES-GCM

/** Generate a fresh random salt for a new user. Public, not secret. */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH);
}

/** Expand one strong key into an independent sub-key. */
function hkdf(masterKey, context) {
  return Buffer.from( 
    crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), context, KEY_LENGTH)
  );
}

/**
 * Master password -> { authHash, vaultKey }
 * authHash goes to the server. vaultKey never leaves the device.
 */
async function deriveKeys(masterPassword, salt, params = DEFAULT_KDF_PARAMS) {
  const masterKey = await argon2.hash(masterPassword, {
    type: argon2.argon2id,
    salt,
    memoryCost: params.m,
    timeCost: params.t,
    parallelism: params.p,
    hashLength: KEY_LENGTH,
    raw: true
  });

  return {
    authHash: hkdf(masterKey, 'auth'),
    vaultKey: hkdf(masterKey, 'enc')
  };
}

/** Encrypt a JS object into a storable blob. */
function encryptItem(obj, vaultKey) {
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(obj), 'utf8'),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

/** Decrypt a blob back into a JS object. Throws if tampered or wrong key. */
function decryptItem(blob, vaultKey) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    vaultKey,
    Buffer.from(blob.nonce, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');

  return JSON.parse(plaintext);
}

module.exports = {
  DEFAULT_KDF_PARAMS,
  generateSalt,
  deriveKeys,
  encryptItem,
  decryptItem
};