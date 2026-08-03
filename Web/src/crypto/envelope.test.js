import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { generateDEK, wrapDEK, unwrapDEK } from './envelope';
import { deriveRecoveryKek, generateRecoveryKey } from './recovery';
import { deriveKeys } from './keys';
import { decryptItem } from './cipher';
import { fromHex, toHex } from './bytes';

const DEK = fromHex(vectors.decryption.dekHex);

describe('envelope encryption interoperates with Node', () => {
  test('unwraps a DEK wrapped by Node', async () => {
    const { password, saltHex, params } = vectors.kdf;
    const { kek } = await deriveKeys(password, fromHex(saltHex), params);

    const dek = await unwrapDEK(vectors.decryption.wrappedDek, kek);
    expect(toHex(dek)).toBe(vectors.decryption.dekHex);
  }, 30000);

  test('derives the same recovery KEK as Node', async () => {
    const { recoveryKey, saltHex, expected } = vectors.recovery;

    const kek = await deriveRecoveryKek(recoveryKey, fromHex(saltHex));
    expect(toHex(kek)).toBe(expected.recoveryKekHex);
  });

  test('unwraps the recovery wrapper produced by Node', async () => {
    const { recoveryKey, saltHex } = vectors.recovery;
    const kek = await deriveRecoveryKek(recoveryKey, fromHex(saltHex));

    const dek = await unwrapDEK(vectors.decryption.recoveryWrapped, kek);
    expect(toHex(dek)).toBe(vectors.decryption.dekHex);
  });

  test('both wrappers yield the same DEK', async () => {
    const { password, saltHex, params } = vectors.kdf;
    const { kek } = await deriveKeys(password, fromHex(saltHex), params);
    const recoveryKek = await deriveRecoveryKek(
      vectors.recovery.recoveryKey, fromHex(vectors.recovery.saltHex)
    );

    const fromPassword = await unwrapDEK(vectors.decryption.wrappedDek, kek);
    const fromRecovery = await unwrapDEK(vectors.decryption.recoveryWrapped, recoveryKek);

    expect(toHex(fromPassword)).toBe(toHex(fromRecovery));
  }, 30000);

  test('DEK is 32 random bytes', () => {
    const a = generateDEK();
    const b = generateDEK();

    expect(a.length).toBe(32);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  test('wrap/unwrap round-trips in the browser', async () => {
    const dek = generateDEK();
    const kek = crypto.getRandomValues(new Uint8Array(32));

    expect(toHex(await unwrapDEK(await wrapDEK(dek, kek), kek))).toBe(toHex(dek));
  });

  test('the wrong KEK cannot unwrap', async () => {
    const wrapped = await wrapDEK(generateDEK(), crypto.getRandomValues(new Uint8Array(32)));
    const wrong = crypto.getRandomValues(new Uint8Array(32));

    await expect(unwrapDEK(wrapped, wrong)).rejects.toThrow();
  });

  test('recovery keys are formatted and unique', () => {
    const key = generateRecoveryKey();

    // Groups of up to four Crockford base32 characters. 128 bits does
    // not divide evenly by 5, so the final group may be shorter.
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{1,4}(-[0-9A-HJKMNP-TV-Z]{1,4})+$/);
    expect(key.replace(/-/g, '').length).toBeGreaterThanOrEqual(25);
    expect(key).not.toBe(generateRecoveryKey());
  });
});