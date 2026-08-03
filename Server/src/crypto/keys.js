const crypto = require('crypto');
const argon2 = require('argon2');

const DEFAULT_KDF_PARAMS = { m: 131072, t: 2, p: 1 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Random salt for a new account. Public, not secret — only needs to be unique. */
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
 * Master password -> { authHash, kek }
 *
 * authHash authenticates to the server. kek encrypts the DEK and never
 * leaves the client. HKDF is one-way, so holding one reveals nothing
 * about the other.
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
    kek: hkdf(masterKey, 'kek')
  };
}

/**
 * True if the stored parameters are weaker than the target on any
 * dimension.
 *
 * Deliberately conservative: Argon2 cost is not a single comparable
 * number, so {m: 32768, t: 3} versus {m: 131072, t: 2} has no
 * obvious ordering without benchmarking. Requiring at-least-equal on
 * every axis avoids accepting a trade that might be a net weakening.
 */
function needsKdfUpgrade(params, target = DEFAULT_KDF_PARAMS) {
  return params.m < target.m || params.t < target.t;
}

module.exports = { DEFAULT_KDF_PARAMS, KEY_LENGTH, generateSalt, hkdf, deriveKeys, needsKdfUpgrade };