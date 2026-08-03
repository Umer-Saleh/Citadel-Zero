import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { deriveKeys, generateSalt } from './keys';
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
