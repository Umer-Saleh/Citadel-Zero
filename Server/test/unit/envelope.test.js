const test = require('node:test');
const assert = require('node:assert');

const {
  generateDEK, wrapDEK, unwrapDEK, deriveKeys, encryptItem, decryptItem
} = require('../../src/crypto');

const FAST = { m: 19456, t: 2, p: 1 };
const SALT = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const PASSWORD = 'correct horse battery staple';

// ---------- DEK GENERATION ----------

test('DEK is 32 random bytes', () => {
  const a = generateDEK();
  const b = generateDEK();

  assert.strictEqual(a.length, 32);
  assert.notDeepStrictEqual(a, b, 'two DEKs were identical');
});

test('DEKs do not repeat', () => {
  const seen = new Set();

  for (let i = 0; i < 1000; i++) {
    seen.add(generateDEK().toString('base64'));
  }

  assert.strictEqual(seen.size, 1000, 'DEK collision detected');
});

// ---------- WRAP / UNWRAP ----------

test('wrap then unwrap recovers the DEK', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const dek = generateDEK();

  assert.deepStrictEqual(unwrapDEK(wrapDEK(dek, kek), kek), dek);
});

test('wrapping uses a fresh nonce each time', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const dek = generateDEK();

  const a = wrapDEK(dek, kek);
  const b = wrapDEK(dek, kek);

  assert.notStrictEqual(a.nonce, b.nonce, 'nonce reused');
  assert.notStrictEqual(a.ciphertext, b.ciphertext, 'ciphertext repeated');

  // Both must still unwrap to the same DEK.
  assert.deepStrictEqual(unwrapDEK(a, kek), unwrapDEK(b, kek));
});

test('the wrapped DEK does not contain the DEK', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const dek = generateDEK();

  const wrapped = wrapDEK(dek, kek);

  assert.ok(!wrapped.ciphertext.includes(dek.toString('base64')),
            'plaintext DEK found inside the wrapper');
});

// ---------- ADVERSARIAL ----------

test('the wrong KEK cannot unwrap', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const { kek: wrongKek } = await deriveKeys('wrong password', SALT, FAST);

  const wrapped = wrapDEK(generateDEK(), kek);

  assert.throws(() => unwrapDEK(wrapped, wrongKek));
});

test('a tampered wrapper is rejected', async () => {
  const { kek } = await deriveKeys(PASSWORD, SALT, FAST);
  const wrapped = wrapDEK(generateDEK(), kek);

  const bytes = Buffer.from(wrapped.ciphertext, 'base64');
  bytes[0] ^= 1;
  wrapped.ciphertext = bytes.toString('base64');

  assert.throws(() => unwrapDEK(wrapped, kek));
});

// ---------- THE POINT OF ALL THIS ----------

test('a password change re-wraps the DEK without touching vault items', async () => {
  const oldSalt = Buffer.from('0000000000000000000000000000000f', 'hex');
  const newSalt = Buffer.from('ffffffffffffffffffffffffffffffff', 'hex');

  // Set up: user encrypts an item under their DEK.
  const { kek: oldKek } = await deriveKeys('old password', oldSalt, FAST);
  const dek = generateDEK();
  let wrapped = wrapDEK(dek, oldKek);

  const item = { site: 'github.com', password: 'hunter2' };
  const encryptedItem = encryptItem(item, dek);   // encrypted ONCE, never again

  // Password change: unwrap with the old KEK, re-wrap under the new one.
  const recoveredDek = unwrapDEK(wrapped, oldKek);
  const { kek: newKek } = await deriveKeys('new password', newSalt, FAST);
  wrapped = wrapDEK(recoveredDek, newKek);

  // The item was never re-encrypted, and still decrypts.
  const dekAfterChange = unwrapDEK(wrapped, newKek);
  assert.deepStrictEqual(decryptItem(encryptedItem, dekAfterChange), item);

  // The old password no longer opens the vault.
  assert.throws(() => unwrapDEK(wrapped, oldKek));
});