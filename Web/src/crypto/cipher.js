import { toBase64, fromBase64, utf8, fromUtf8 } from './bytes';
import { pad, unpad, BUCKETS, PREFIX_BYTES } from './padding';

const NONCE_LENGTH = 12;   // 96 bits, standard for AES-GCM
const TAG_LENGTH = 16;     // 128 bits

// ---------------------------------------------------------------
// HOW BIG AN ITEM MAY BE, AND WHY THE NUMBER IS DERIVED
//
// padding.js is deliberately unbounded: past the largest bucket
// bucketFor rounds up to a multiple of it, so that "a 200KB note is
// unusual but shouldn't fail". Over HTTP it always did fail. The
// transport cannot follow the padder anywhere it goes — base64 costs
// four bytes for every three, so a bucket of B bytes needs 4B/3 of
// body budget, and each bucket is twice the last. There is no body
// limit that keeps up.
//
// So the entry is bounded HERE, before it is padded, at the largest
// bucket the transport can actually carry. Everything below is
// computed from the two facts that decide it rather than typed in, so
// that raising the body limit or changing BUCKETS moves the cap on its
// own instead of leaving a stale constant behind — which is the exact
// failure this whole area already had once.
// ---------------------------------------------------------------

/** express.json({ limit: '96kb' }) in Server/src/app.js. */
const BODY_LIMIT_BYTES = 96 * 1024;

/** `{"ciphertext":"…","nonce":<16 chars>,"authTag":<24 chars>}` */
const ENVELOPE_BYTES = 81;

const base64Length = (bytes) => Math.ceil(bytes / 3) * 4;

const carryable = BUCKETS.filter(
  b => base64Length(b) + ENVELOPE_BYTES <= BODY_LIMIT_BYTES
);

/**
 * The largest serialised item that can reach the server: 65,532 bytes
 * today — the 65536 bucket less its 4-byte length prefix. That bucket
 * travels as 87,384 base64 characters plus 81 of envelope, 87,465
 * bytes against a 98,304 limit. The next bucket up, 131072, would need
 * 174,845 and is not carryable at any sane limit.
 *
 * This is a count of BYTES of JSON.stringify(item), not of characters
 * in one field. The whole entry shares a single encrypted blob, so
 * every field spends from the same budget, and a character outside
 * ASCII spends more than one byte.
 */
export const MAX_ITEM_BYTES = carryable[carryable.length - 1] - PREFIX_BYTES;

/**
 * What an item will cost, for a UI that wants to show the budget
 * before the save rather than explain a refusal after it.
 *
 * Measures exactly what encryptItem measures — same serialisation,
 * same encoder — so the number a person watches while typing is the
 * number that decides whether the save is allowed.
 */
export function itemByteLength(obj) {
  return utf8(JSON.stringify(obj)).length;
}

async function importAesKey(key) {
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt raw bytes.
 *
 * WebCrypto APPENDS the 16-byte auth tag to the ciphertext, while
 * Node keeps it separate via getAuthTag(). We split it back out so
 * both implementations produce the same three-field wire format.
 */
export async function encryptBytes(plaintext, key) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const aesKey = await importAesKey(key);

  const combined = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: TAG_LENGTH * 8 },
    aesKey,
    plaintext
  ));

  return {
    ciphertext: toBase64(combined.slice(0, combined.length - TAG_LENGTH)),
    nonce: toBase64(nonce),
    authTag: toBase64(combined.slice(combined.length - TAG_LENGTH))
  };
}

/**
 * Decrypt back to raw bytes. Throws if tampered with or the key is wrong.
 *
 * The tag has to be re-appended, since WebCrypto expects it inline.
 */
export async function decryptBytes({ ciphertext, nonce, authTag }, key) {
  const ct = fromBase64(ciphertext);
  const tag = fromBase64(authTag);

  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);

  const aesKey = await importAesKey(key);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(nonce), tagLength: TAG_LENGTH * 8 },
    aesKey,
    combined
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypt a JS object, padded to a fixed bucket.
 *
 * Padding is applied HERE and not in encryptBytes: the DEK wrappers
 * also use encryptBytes and are always 32 bytes, so there is nothing
 * to hide and padding them would break every existing account.
 */
export async function encryptItem(obj, key) {
  const plaintext = utf8(JSON.stringify(obj));

  // Refused here rather than by the server, because the server's
  // refusal is a 413 on a request that never had a chance — the padder
  // would have rounded this up to a bucket no body limit can carry.
  // Callers get a code they can render; ItemDetail shows the budget
  // while the entry is being typed so this is the backstop, not the
  // first thing a person hears about it.
  if (plaintext.length > MAX_ITEM_BYTES) {
    const err = new Error('item is too large to store: over the largest carryable padding bucket');
    err.code = 'ITEM_TOO_LARGE';
    throw err;
  }

  return encryptBytes(pad(plaintext), key);
}

export async function decryptItem(blob, key) {
  return JSON.parse(fromUtf8(unpad(await decryptBytes(blob, key))));
}

export { NONCE_LENGTH, TAG_LENGTH };