const { test } = require('node:test');
const assert = require('node:assert');
const { pad, unpad, BUCKETS } = require('../../src/crypto/padding');

test('pad then unpad round-trips', () => {
  for (const s of ['', 'a', 'hello world', 'x'.repeat(500)]) {
    const out = unpad(pad(Buffer.from(s, 'utf8')));
    assert.strictEqual(Buffer.from(out).toString('utf8'), s);
  }
});

test('different lengths pad to the same size', () => {
  const a = pad(Buffer.from('short'));
  const b = pad(Buffer.from('a much longer password than the other one'));

  // The whole point: an observer cannot distinguish these by length.
  assert.strictEqual(a.length, b.length);
  assert.strictEqual(a.length, BUCKETS[0]);
});

test('plaintext ending in zero bytes survives', () => {
  const withZeros = Buffer.from([104, 105, 0, 0, 0]);
  const out = unpad(pad(withZeros));

  // This is why there's a length prefix — trailing zeros would be
  // ambiguous with the padding itself.
  assert.deepStrictEqual(Buffer.from(out), withZeros);
});

test('a corrupt length prefix is rejected', () => {
  const bad = pad(Buffer.from('hello'));
  bad[0] = 0xff;   // absurd length
  assert.throws(() => unpad(bad));
});