const { test } = require('node:test');
const assert = require('node:assert');
const { generateToken, hashToken, safeEqual } = require('../../src/crypto/refreshToken');

test('generateToken produces a different token every time', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(generateToken());
  assert.strictEqual(seen.size, 100, 'tokens must not repeat');
});

test('generateToken produces 32 bytes of entropy', () => {
  // base64url of 32 bytes is 43 chars with no padding
  assert.strictEqual(generateToken().length, 43);
});

test('generateToken is url-safe', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateToken(), /^[A-Za-z0-9_-]+$/);
  }
});

test('hashToken is deterministic', () => {
  const t = generateToken();
  assert.strictEqual(hashToken(t), hashToken(t));
});

test('hashToken does not reveal the token', () => {
  const t = generateToken();
  const h = hashToken(t);
  assert.notStrictEqual(h, t);
  assert.ok(!h.includes(t), 'hash must not contain the token');
});

test('different tokens hash differently', () => {
  assert.notStrictEqual(hashToken(generateToken()), hashToken(generateToken()));
});

test('safeEqual matches identical strings', () => {
  const h = hashToken('anything');
  assert.strictEqual(safeEqual(h, h), true);
});

test('safeEqual rejects different strings of equal length', () => {
  const a = hashToken('one');
  const b = hashToken('two');
  // precondition: without this the test could pass vacuously if the
  // hashes happened to differ in length
  assert.strictEqual(a.length, b.length);
  assert.strictEqual(safeEqual(a, b), false);
});

test('safeEqual rejects different lengths without throwing', () => {
  assert.strictEqual(safeEqual('short', 'muchlongerstring'), false);
});