import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { encryptItem, decryptItem, encryptBytes, decryptBytes } from './cipher';
import { fromHex, fromBase64, toHex } from './bytes';

const DEK = fromHex(vectors.decryption.dekHex);

describe('cipher interoperates with Node', () => {
  test('decrypts an item encrypted by Node', async () => {
    const item = await decryptItem(vectors.decryption.encryptedItem, DEK);
    expect(item).toEqual(vectors.decryption.expectedItem);
  });

  test('round-trips within the browser', async () => {
    const item = { site: 'github.com', password: 'hunter2' };
    expect(await decryptItem(await encryptItem(item, DEK), DEK)).toEqual(item);
  });

  test('produces the Node wire format', async () => {
    const blob = await encryptItem({ x: 1 }, DEK);

    expect(fromBase64(blob.nonce).length).toBe(12);
    expect(fromBase64(blob.authTag).length).toBe(16);
  });

  test('uses a fresh nonce each time', async () => {
    const a = await encryptItem({ x: 1 }, DEK);
    const b = await encryptItem({ x: 1 }, DEK);

    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test('rejects a wrong key', async () => {
    const blob = await encryptItem({ secret: 'value' }, DEK);
    const wrong = crypto.getRandomValues(new Uint8Array(32));

    await expect(decryptItem(blob, wrong)).rejects.toThrow();
  });

  test('rejects tampered ciphertext', async () => {
    const blob = await encryptItem({ secret: 'value' }, DEK);

    const bytes = fromBase64(blob.ciphertext);
    bytes[0] ^= 1;
    blob.ciphertext = btoa(String.fromCharCode(...bytes));

    await expect(decryptItem(blob, DEK)).rejects.toThrow();
  });

  test('rejects a tampered auth tag', async () => {
    const blob = await encryptItem({ secret: 'value' }, DEK);

    const bytes = fromBase64(blob.authTag);
    bytes[0] ^= 1;
    blob.authTag = btoa(String.fromCharCode(...bytes));

    await expect(decryptItem(blob, DEK)).rejects.toThrow();
  });
});