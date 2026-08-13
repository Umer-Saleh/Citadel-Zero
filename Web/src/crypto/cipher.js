import { toBase64, fromBase64, utf8, fromUtf8 } from './bytes';
import { pad, unpad } from './padding';

const NONCE_LENGTH = 12;   // 96 bits, standard for AES-GCM
const TAG_LENGTH = 16;     // 128 bits

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
  return encryptBytes(pad(utf8(JSON.stringify(obj))), key);
}

export async function decryptItem(blob, key) {
  return JSON.parse(fromUtf8(unpad(await decryptBytes(blob, key))));
}

export { NONCE_LENGTH, TAG_LENGTH };