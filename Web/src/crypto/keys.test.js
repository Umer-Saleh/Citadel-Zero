import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { deriveKeys, generateSalt, assertKdfParams, MIN_KDF_PARAMS, DEFAULT_KDF_PARAMS } from './keys';
import { fromHex, toHex } from './bytes';

describe('key derivation matches the Node implementation', () => {
  test('produces the expected auth hash and KEK', async () => {
    const { password, saltHex, params, expected } = vectors.kdf;

    const { authHash, kek } = await deriveKeys(password, fromHex(saltHex), params);

    expect(toHex(authHash)).toBe(expected.authHashHex);
    expect(toHex(kek)).toBe(expected.kekHex);
  }, 30000);   // WASM Argon2 is slow; allow 30s

  test('auth hash and KEK are independent', async () => {
    const { password, saltHex, params } = vectors.kdf;
    const { authHash, kek } = await deriveKeys(password, fromHex(saltHex), params);

    expect(toHex(authHash)).not.toBe(toHex(kek));
    expect(authHash.length).toBe(32);
    expect(kek.length).toBe(32);
  }, 30000);

  test('salts are 16 random bytes', () => {
    const a = generateSalt();
    const b = generateSalt();

    expect(a.length).toBe(16);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('server-supplied KDF parameters have a floor', () => {
  test('the floor matches the server schema floor', () => {
    expect(MIN_KDF_PARAMS).toEqual({ m: 19456, t: 2, p: 1 });
  });

  test('defaults and the floor itself are accepted', () => {
    expect(assertKdfParams(DEFAULT_KDF_PARAMS)).toBe(DEFAULT_KDF_PARAMS);
    expect(() => assertKdfParams({ ...MIN_KDF_PARAMS })).not.toThrow();
  });

  test.each([
    ['memory below the floor', { m: 8, t: 2, p: 1 }],
    ['time below the floor', { m: 131072, t: 1, p: 1 }],
    ['zero parallelism', { m: 131072, t: 2, p: 0 }],
    ['parallelism above the schema maximum', { m: 131072, t: 2, p: 5 }],
    ['non-integer memory', { m: 19456.5, t: 2, p: 1 }],
    ['a string where a number belongs', { m: '131072', t: 2, p: 1 }],
    ['missing fields', { m: 131072 }],
    ['nothing at all', undefined]
  ])('%s is refused with UNSAFE_KDF_PARAMS', (_, params) => {
    expect(() => assertKdfParams(params)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_KDF_PARAMS' })
    );
  });
});
