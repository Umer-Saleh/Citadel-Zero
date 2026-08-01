const test = require('node:test');
const assert = require('node:assert');

const {
  generateSalt, deriveKeys, encryptItem, decryptItem, DEFAULT_KDF_PARAMS
} = require('../../src/crypto');

const FAST = { m: 19456, t: 2, p: 1 };
const SALT = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const PASSWORD = 'correct horse battery staple';

// ---------- DERIVATION ----------

test('derivation is deterministic', async () => {
  const a = await deriveKeys(PASSWORD, SALT, FAST);
  const b = await deriveKeys(PASSWORD, SALT, FAST);

  assert.deepStrictEqual(a.kek, b.kek);
  assert.deepStrictEqual(a.authHash, b.authHash);
});

test('different salts produce different keys', async () => {
  const a = await deriveKeys(PASSWORD, generateSalt(), FAST);
  const b = await deriveKeys(PASSWORD, generateSalt(), FAST);

  assert.notDeepStrictEqual(a.kek, b.kek);
});

test('different passwords produce different keys', async () => {
  const a = await deriveKeys(PASSWORD, SALT, FAST);
  const b = await deriveKeys(PASSWORD + '!', SALT, FAST);

  assert.notDeepStrictEqual(a.kek, b.kek);
});

test('auth hash and vault key are independent 256-bit values', async () => {
  const { authHash, kek } = await deriveKeys(PASSWORD, SALT, FAST);

  assert.notDeepStrictEqual(authHash, kek);
  assert.strictEqual(authHash.length, 32);
  assert.strictEqual(kek.length, 32);
});

test('production KDF defaults meet the OWASP floor', () => {
  assert.ok(DEFAULT_KDF_PARAMS.m >= 19456, 'memory cost below 19 MiB');
  assert.ok(DEFAULT_KDF_PARAMS.t >= 2, 'time cost below 2 iterations');
  assert.ok(DEFAULT_KDF_PARAMS.p >= 1);
});

test('salts are 16 random bytes', () => {
  const a = generateSalt();
  const b = generateSalt();

  assert.strictEqual(a.length, 16);
  assert.notDeepStrictEqual(a, b);
});

// ---------- ENCRYPTION ----------

test('encrypt then decrypt round-trips', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const item = { site: 'github.com', username: 'me', password: 'hunter2' };

  assert.deepStrictEqual(decryptItem(encryptItem(item, kek), kek), item);
});

test('same plaintext encrypts to different ciphertext', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const item = { site: 'github.com', password: 'hunter2' };

  const a = encryptItem(item, kek);
  const b = encryptItem(item, kek);

  assert.notStrictEqual(a.ciphertext, b.ciphertext, 'ciphertext repeated');
  assert.notStrictEqual(a.nonce, b.nonce, 'nonce reused');
});

test('nonces do not repeat across many encryptions', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const seen = new Set();

  for (let i = 0; i < 1000; i++) {
    seen.add(encryptItem({ i }, kek).nonce);
  }

  assert.strictEqual(seen.size, 1000, 'nonce collision detected');
});

test('nonce is 12 bytes', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const blob = encryptItem({ x: 1 }, kek);

  assert.strictEqual(Buffer.from(blob.nonce, 'base64').length, 12);
});

// ---------- ADVERSARIAL ----------

test('wrong key cannot decrypt', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const { kek: wrong } = await deriveKeys('wrong password', SALT, FAST);

  const blob = encryptItem({ secret: 'value' }, kek);
  assert.throws(() => decryptItem(blob, wrong));
});

test('tampered ciphertext is rejected', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const blob = encryptItem({ secret: 'value' }, kek);

  const bytes = Buffer.from(blob.ciphertext, 'base64');
  bytes[0] ^= 1;
  blob.ciphertext = bytes.toString('base64');

  assert.throws(() => decryptItem(blob, kek));
});

test('tampered auth tag is rejected', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const blob = encryptItem({ secret: 'value' }, kek);

  const tag = Buffer.from(blob.authTag, 'base64');
  tag[0] ^= 1;
  blob.authTag = tag.toString('base64');

  assert.throws(() => decryptItem(blob, kek));
});

test('swapped nonce is rejected', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const a = encryptItem({ secret: 'one' }, kek);
  const b = encryptItem({ secret: 'two' }, kek);

  a.nonce = b.nonce;
  assert.throws(() => decryptItem(a, kek));
});