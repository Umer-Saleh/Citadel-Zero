import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { encryptItem, decryptItem, itemByteLength, MAX_ITEM_BYTES } from './cipher';
import { fromHex, fromBase64 } from './bytes';

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

/**
 * The cap that keeps the padder inside what the transport can carry.
 *
 * padding.js is deliberately unbounded past its largest bucket, so it
 * can produce a body no body limit will ever accept. Before this, an
 * entry over the last carryable bucket was encrypted, sent, and
 * refused with a 413 at a size where no retry would have helped.
 */
describe('an item too large to store', () => {
  test('the cap is the largest carryable bucket, less the prefix', () => {
    // 65536 travels as 87,384 base64 characters plus 81 of envelope —
    // 87,465 bytes against the 98,304 the server accepts. Take off the
    // 4-byte length prefix pad() writes and 65,532 is left. Asserted as
    // a value because a silent change here is a change to what people
    // can save; it is DERIVED in cipher.js, so this catches a bucket
    // list or a body limit moving underneath it.
    expect(MAX_ITEM_BYTES).toBe(65_532);
  });

  test('an item at the cap is encrypted, one byte over is refused', async () => {
    const fill = (bytes) => ({ notes: 'x'.repeat(bytes - '{"notes":""}'.length) });

    const atCap = fill(MAX_ITEM_BYTES);
    expect(itemByteLength(atCap)).toBe(MAX_ITEM_BYTES);
    await expect(encryptItem(atCap, DEK)).resolves.toBeDefined();

    // Both sides of the boundary, so a cap that refused everything
    // would not pass on the strength of the refusal alone.
    const overCap = fill(MAX_ITEM_BYTES + 1);
    await expect(encryptItem(overCap, DEK)).rejects.toThrow(/too large/);
  });

  test('the refusal carries a code the UI can render', async () => {
    // Without this it arrives as a bare Error and ItemDetail falls to
    // the generic branch — "Could not save this entry (undefined)",
    // which is the shape of failure this area keeps producing.
    const tooBig = { notes: 'x'.repeat(MAX_ITEM_BYTES) };

    await expect(encryptItem(tooBig, DEK)).rejects.toMatchObject({
      code: 'ITEM_TOO_LARGE'
    });
  });

  test('the budget counts every field, not the longest one', async () => {
    // The whole entry is one JSON blob inside one encryption, so a
    // title spends from the same budget the notes do. An entry whose
    // notes alone fit can still be over.
    const notes = 'x'.repeat(MAX_ITEM_BYTES - 100);
    const item = { site: 'GitHub', username: 'u'.repeat(200), password: 'p', notes };

    expect(notes.length).toBeLessThan(MAX_ITEM_BYTES);
    expect(itemByteLength(item)).toBeGreaterThan(MAX_ITEM_BYTES);
    await expect(encryptItem(item, DEK)).rejects.toThrow(/too large/);
  });

  test('a multi-byte character spends more than one byte of it', async () => {
    // The cap is bytes and a person types characters. This pins the
    // gap between the two — an emoji is four bytes — and that gap is
    // the whole reason the error copy no longer names a character
    // figure: 65,000 was true in ASCII, half true in Arabic, a
    // quarter true in emoji. The assertion is unchanged; only the
    // reason it matters has moved from "the copy says characters" to
    // "the copy stopped saying characters, and this is why".
    expect(itemByteLength({ notes: '😀' })).toBe(itemByteLength({ notes: 'xxxx' }));
  });
});