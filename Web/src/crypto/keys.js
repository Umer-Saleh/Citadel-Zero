import { argon2id } from 'hash-wasm';
import { utf8 } from './bytes';

export const DEFAULT_KDF_PARAMS = { m: 131072, t: 2, p: 1 };

/**
 * The weakest parameters this client will derive under: the OWASP
 * floor, the same values the server's signup schema enforces
 * (Server/src/routes/schemas.js, kdfParams).
 *
 * The server tells the client which parameters an account uses, and
 * the client used to derive with whatever came back. A malicious or
 * compromised server could answer m=8, t=1 and receive an auth hash
 * cheap enough to brute-force offline — the password, in effect. No
 * legitimate account is below this, because the server never stored
 * one that was.
 */
export const MIN_KDF_PARAMS = { m: 19456, t: 2, p: 1 };
const MAX_PARALLELISM = 4;

/**
 * Refuse server-supplied KDF parameters below the floor.
 *
 * Called on every value that arrived over the network, before any
 * derivation. Throws a coded error rather than deriving: sending an
 * auth hash computed under weak parameters is the leak.
 */
export function assertKdfParams(params) {
  const ok = params
    && Number.isInteger(params.m) && params.m >= MIN_KDF_PARAMS.m
    && Number.isInteger(params.t) && params.t >= MIN_KDF_PARAMS.t
    && Number.isInteger(params.p) && params.p >= MIN_KDF_PARAMS.p
    && params.p <= MAX_PARALLELISM;

  if (!ok) {
    const err = new Error('server supplied KDF parameters below the minimum this client accepts');
    err.code = 'UNSAFE_KDF_PARAMS';
    throw err;
  }
  return params;
}

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Random salt for a new account. Public, not secret — only needs to be unique. */
export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Expand one strong key into an independent sub-key.
 *
 * WebCrypto requires raw bytes to be imported as a CryptoKey before
 * use — you cannot pass a Uint8Array directly. Everything is async.
 */
async function hkdf(masterKey, context) {
  const ikm = await crypto.subtle.importKey(
    'raw', masterKey, 'HKDF', false, ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),      // must match Node's Buffer.alloc(0)
      info: utf8(context)           // must match Node's context string byte for byte
    },
    ikm,
    KEY_LENGTH * 8                  // deriveBits takes BITS, not bytes
  );

  return new Uint8Array(bits);
}

/**
 * Master password -> { authHash, kek }
 *
 * Argon2id has no browser-native implementation, so this runs in
 * WebAssembly. Expect it to be noticeably slower than the Node
 * native binding at the same parameters.
 */
export async function deriveKeys(masterPassword, salt, params = DEFAULT_KDF_PARAMS) {
  const masterKey = await argon2id({
    password: masterPassword,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,          // in KiB, same unit as Node's memoryCost
    hashLength: KEY_LENGTH,
    outputType: 'binary'
  });

  return {
    authHash: await hkdf(masterKey, 'auth'),
    kek: await hkdf(masterKey, 'kek')
  };
}

export { hkdf, KEY_LENGTH };