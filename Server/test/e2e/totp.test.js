require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { TOTP, Secret } = require('otpauth');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload } = require('../helpers/db');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

const PERIOD = 30;

function codeFor(secret, timestamp = Date.now()) {
  return new TOTP({
    algorithm: 'SHA1', digits: 6, period: PERIOD,
    secret: Secret.fromBase32(secret)
  }).generate({ timestamp });
}

/**
 * A code from the NEXT time-step.
 *
 * Enrolment consumes a code and records its step, so a code from the
 * SAME window is correctly rejected afterwards as a replay. Real users
 * never hit this — nobody enrols and then logs in within 30 seconds —
 * but tests run in milliseconds, so they have to step forward.
 */
function nextCode(secret) {
  return codeFor(secret, Date.now() + PERIOD * 1000);
}

/** Signup + login. Returns { payload, token, session }. */
async function loggedIn() {
  const { payload } = await makeSignupPayload();
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  assert.strictEqual(res.status, 200, 'login helper failed');
  return { payload, token: res.body.token, session: res.body };
}

/** Full enrolment. Returns { payload, token, secret, backupCodes }. */
async function enrolled() {
  const { payload, token } = await loggedIn();

  const begin = await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(begin.status, 200, 'begin failed');

  // codeFor, not nextCode: this is the FIRST use of the secret, so
  // there is no prior step to collide with.
  const confirm = await request(app)
    .post('/api/account/totp/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: codeFor(begin.body.secret) });

  assert.strictEqual(confirm.status, 200, 'confirm failed');

  return { payload, token, secret: begin.body.secret, backupCodes: confirm.body.backupCodes };
}

test('begin returns a secret and a scannable URI', async () => {
  const { token } = await loggedIn();

  const res = await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.match(res.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(res.body.uri, /^otpauth:\/\/totp\//);
});

test('begin does not enable 2FA on its own', async () => {
  const { payload, token } = await loggedIn();

  await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  const res = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: payload.email });

  // A user who closes the tab mid-enrolment must not be locked out.
  assert.strictEqual(res.body.totpEnabled, false);
});

test('confirming with a wrong code does not enable 2FA', async () => {
  const { payload, token } = await loggedIn();

  const begin = await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  const wrong = codeFor(begin.body.secret) === '000000' ? '111111' : '000000';

  const res = await request(app)
    .post('/api/account/totp/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: wrong });

  assert.strictEqual(res.status, 401);

  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: payload.email });

  assert.strictEqual(params.body.totpEnabled, false);
});

test('confirming issues backup codes and enables 2FA', async () => {
  const { payload, backupCodes } = await enrolled();

  assert.strictEqual(backupCodes.length, 10);
  assert.strictEqual(new Set(backupCodes).size, 10);

  const res = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: payload.email });

  assert.strictEqual(res.body.totpEnabled, true);
});

test('login WITHOUT a code fails once 2FA is on', async () => {
  const { payload } = await enrolled();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  // THE test. Without it the whole feature could be inert — every
  // other test here would still pass if TOTP were never checked.
  assert.strictEqual(res.status, 401, '2FA is not actually being enforced');
});

test('login with a valid code succeeds', async () => {
  const { payload, secret } = await enrolled();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: nextCode(secret) });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token);
});

test('a code cannot be replayed', async () => {
  const { payload, secret } = await enrolled();
  const code = nextCode(secret);

  const first = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: code });

  assert.strictEqual(first.status, 200);

  // Still inside the 90-second validity window, but the step was
  // consumed. Each code is strictly single-use.
  const second = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: code });

  assert.strictEqual(second.status, 401, 'a used code was accepted again');
});

test('a wrong password fails even with a valid code', async () => {
  const { payload, secret } = await enrolled();

  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: payload.email,
      authHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      totpCode: nextCode(secret)
    });

  assert.strictEqual(res.status, 401);
});

test('a wrong code returns the same error as a wrong password', async () => {
  const { payload } = await enrolled();

  const badCode = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: '000000' });

  const badPassword = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });

  // Distinguishing them would confirm to an attacker that a password
  // they hold is live, even though they can't get in.
  assert.strictEqual(badCode.status, badPassword.status);
  assert.strictEqual(badCode.body.error, badPassword.body.error);
});

test('a backup code works instead of a TOTP code', async () => {
  const { payload, backupCodes } = await enrolled();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: backupCodes[0] });

  assert.strictEqual(res.status, 200);
});

test('a backup code is single-use', async () => {
  const { payload, backupCodes } = await enrolled();

  const first = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: backupCodes[0] });

  assert.strictEqual(first.status, 200);

  const second = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash, totpCode: backupCodes[0] });

  assert.strictEqual(second.status, 401);
});

test('disabling requires a valid code', async () => {
  const { payload, token } = await enrolled();

  const res = await request(app)
    .post('/api/account/totp/disable')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: '000000' });

  assert.strictEqual(res.status, 401);

  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: payload.email });

  assert.strictEqual(params.body.totpEnabled, true, '2FA was removed without a code');
});

test('disabling with a valid code turns 2FA off', async () => {
  const { payload, token, secret } = await enrolled();

  const res = await request(app)
    .post('/api/account/totp/disable')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: nextCode(secret) });

  assert.strictEqual(res.status, 204);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  assert.strictEqual(login.status, 200, 'login should work without a code again');
});

test('2FA endpoints require authentication', async () => {
  const begin = await request(app).post('/api/account/totp/begin');
  assert.strictEqual(begin.status, 401);

  const confirm = await request(app)
    .post('/api/account/totp/confirm')
    .send({ code: '123456' });
  assert.strictEqual(confirm.status, 401);
});