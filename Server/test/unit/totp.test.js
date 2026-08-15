const { test } = require('node:test');
const assert = require('node:assert');
const { TOTP, Secret } = require('otpauth');
const {
  generateSecret, buildUri, verifyCode,
  generateBackupCodes, hashBackupCode, PERIOD
} = require('../../src/crypto/totp');

/** Generate the code a real authenticator app would show right now. */
function currentCode(secret, timestamp = Date.now()) {
  return new TOTP({
    algorithm: 'SHA1', digits: 6, period: PERIOD,
    secret: Secret.fromBase32(secret)
  }).generate({ timestamp });
}

test('generateSecret produces a different secret every time', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(generateSecret());
  assert.strictEqual(seen.size, 50);
});

test('generateSecret is 160 bits of base32', () => {
  // 20 bytes -> 32 base32 chars
  assert.strictEqual(generateSecret().length, 32);
  assert.match(generateSecret(), /^[A-Z2-7]+$/);
});

test('a current code verifies', () => {
  const secret = generateSecret();
  const step = verifyCode(secret, currentCode(secret));

  // Explicitly not-null: 0 would be a legitimate step and is falsy,
  // so assert.ok(step) would be the wrong check here.
  assert.notStrictEqual(step, null, 'a freshly generated code must verify');
});

test('a wrong code does not verify', () => {
  const secret = generateSecret();
  const wrong = currentCode(secret) === '000000' ? '111111' : '000000';

  assert.strictEqual(verifyCode(secret, wrong), null);
});

test('a code from another secret does not verify', () => {
  const a = generateSecret();
  const b = generateSecret();

  assert.strictEqual(verifyCode(a, currentCode(b)), null);
});

test('malformed codes are rejected without throwing', () => {
  const secret = generateSecret();
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', null, undefined]) {
    assert.strictEqual(verifyCode(secret, bad ?? ''), null);
  }
});

test('a code from one step ago still verifies (clock drift)', () => {
  const secret = generateSecret();
  const past = currentCode(secret, Date.now() - PERIOD * 1000);

  assert.notStrictEqual(verifyCode(secret, past), null,
    'a phone running one step slow must still be able to log in');
});

test('a code from far in the past does not verify', () => {
  const secret = generateSecret();
  const old = currentCode(secret, Date.now() - PERIOD * 10 * 1000);

  assert.strictEqual(verifyCode(secret, old), null);
});

test('the returned step increases over time', () => {
  const secret = generateSecret();
  const now = verifyCode(secret, currentCode(secret));
  const earlier = verifyCode(secret, currentCode(secret, Date.now() - PERIOD * 1000));

  // The step is what makes replay protection possible — it must
  // actually distinguish one window from the next.
  assert.ok(now > earlier, 'steps must be ordered');
});

test('buildUri produces a scannable otpauth URI', () => {
  const secret = generateSecret();
  const uri = buildUri(secret, 'test@example.com');

  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes('Citadel'));
  assert.ok(uri.includes(secret));
});

test('backup codes are unique and hashed one-way', () => {
  const codes = generateBackupCodes();

  assert.strictEqual(codes.length, 10);
  assert.strictEqual(new Set(codes).size, 10);

  for (const c of codes) {
    const h = hashBackupCode(c);
    assert.notStrictEqual(h, c);
    assert.ok(!h.includes(c), 'hash must not contain the code');
  }
});

test('backup code hashing ignores case and separators', () => {
  const code = generateBackupCodes(1)[0];

  // Someone typing off paper will add spaces or dashes, or use caps.
  assert.strictEqual(hashBackupCode(code), hashBackupCode(code.toUpperCase()));
  assert.strictEqual(hashBackupCode(code), hashBackupCode(code.replace(/(.{4})/, '$1-')));
});