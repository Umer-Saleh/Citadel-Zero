import { argon2id } from 'hash-wasm';
import { utf8 } from './bytes';

export const DEFAULT_KDF_PARAMS = { m: 131072, t: 2, p: 1 };

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