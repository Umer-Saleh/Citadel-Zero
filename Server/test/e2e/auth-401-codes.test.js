require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { TOTP, Secret } = require('otpauth');

const app = require('../../src/app');
const config = require('../../src/config');
const { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF } = require('../helpers/db');
const {
  generateSalt, deriveKeys, wrapDEK, unwrapDEK,
  generateRecoveryKey, deriveRecoveryKek, deriveRecoveryAuthHash
} = require('../../src/crypto');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

// ---------------------------------------------------------------
// WHAT A 401 CARRIES IN ITS BODY
//
// This server answers 401 for two unrelated situations, and a client
// has to tell them apart:
//
//   the ACCESS TOKEN is no good   -> refresh it and retry, silently
//   the CREDENTIAL is wrong       -> tell the user, retry nothing
//
// The status cannot separate them: both are 401, neither carries
// WWW-Authenticate, and no other field differs. The ONLY thing that
// distinguishes them is the `error` code in the body — INVALID_TOKEN
// and NO_TOKEN from requireAuth, against INVALID_CREDENTIALS and
// INVALID_TOTP_CODE from the services.
//
// Every existing 401 assertion in this directory checks the status and
// stops there, so until this file the codes were not pinned anywhere.
// That was survivable while nothing read them. It stops being
// survivable now: the web client is about to branch its
// refresh-and-retry on exactly these strings, and a rename here would
// silently turn "wrong password" back into a refresh, a retry and a
// rotated refresh token — four requests against an auth bucket that
// holds six in production, so two wrong attempts lock a real user out.
//
// WHY A FILE OF ITS OWN, rather than lines added beside the tests that
// already produce these 401s:
//
//   - There is nothing to join. This suite has no describe blocks; it
//     is flat tests under section banners.
//   - The contract spans requireAuth, accountService and authService.
//     No existing file owns more than one corner of it, and the
//     property that matters most — that the two KINDS of 401 differ
//     from each other — has no home in any of them. It is the last
//     test below.
//   - The expired-token case belongs to no feature file at all. It is
//     about the token, not about vaults, recovery or 2FA, and it needs
//     jwt and config, which no other e2e file imports.
//   - Nothing here edits an existing test, so no assertion anywhere
//     gets weaker. This file is additions only.
//
// If a code below has to change, the change is not local: the client's
// retry gate has to move in the same commit, or wrong passwords start
// spending the auth budget again.
// ---------------------------------------------------------------

const EMAIL = 'test@example.com';
const PASSWORD = 'test-password-123';

// Well-formed, valid base64, and not anybody's auth hash. The same
// shape the existing account and kdf-upgrade tests use, so these
// requests pass schema validation and fail at the credential check —
// which is the only place they can produce the code under test.
const WRONG_AUTH_HASH = Buffer.alloc(32, 7).toString('base64');

// Above the OWASP floor FAST_KDF sits on, so kdf-upgrade sees a real
// upgrade rather than a downgrade — a downgrade is a 400 and would
// never reach the credential check.
const STRONGER = { m: 262144, t: 3, p: 1 };

const PERIOD = 30;

function codeFor(secret, timestamp = Date.now()) {
  return new TOTP({
    algorithm: 'SHA1', digits: 6, period: PERIOD,
    secret: Secret.fromBase32(secret)
  }).generate({ timestamp });
}

/** A six-digit code that is definitely not the current one. */
function wrongCodeFor(secret) {
  return codeFor(secret) === '000000' ? '111111' : '000000';
}

/** Sign up and log in. Returns the token, the DEK and the payload. */
async function loggedIn() {
  const { payload, kek } = await makeSignupPayload(EMAIL, PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.status, 200, 'login helper failed');

  return { payload, token: res.body.token, dek: unwrapDEK(res.body.wrappedDek, kek) };
}

/** 2FA switched on. Returns the token and the enrolled secret. */
async function enrolled() {
  const { token } = await loggedIn();

  const begin = await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(begin.status, 200, 'begin failed');

  const confirm = await request(app)
    .post('/api/account/totp/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: codeFor(begin.body.secret) });

  assert.strictEqual(confirm.status, 200, 'confirm failed');

  return { token, secret: begin.body.secret };
}

async function buildPasswordChange(dek, currentAuthHash) {
  const newSalt = generateSalt();
  const { authHash, kek } = await deriveKeys('a-different-password', newSalt, FAST_KDF);

  return {
    currentAuthHash,
    newAuthHash: authHash.toString('base64'),
    newKdfSalt: newSalt.toString('base64'),
    newKdfParams: FAST_KDF,
    newWrappedDek: wrapDEK(dek, kek)
  };
}

async function buildUpgrade(dek, currentAuthHash) {
  const newSalt = generateSalt();
  const { authHash, kek } = await deriveKeys(PASSWORD, newSalt, STRONGER);

  return {
    currentAuthHash,
    newAuthHash: authHash.toString('base64'),
    newKdfSalt: newSalt.toString('base64'),
    newKdfParams: STRONGER,
    newWrappedDek: wrapDEK(dek, kek)
  };
}

function buildKitRegeneration(dek, currentAuthHash) {
  const newRecoveryKey = generateRecoveryKey();
  const newRecoverySalt = generateSalt();
  const newRecoveryKek = deriveRecoveryKek(newRecoveryKey, newRecoverySalt);

  return {
    currentAuthHash,
    newRecoverySalt: newRecoverySalt.toString('base64'),
    newRecoveryWrappedDek: wrapDEK(dek, newRecoveryKek),
    newRecoveryAuthHash:
      deriveRecoveryAuthHash(newRecoveryKey, newRecoverySalt).toString('base64')
  };
}

/**
 * A correctly signed access token whose exp has already passed.
 *
 * Signed with the real secret, so it fails on expiry alone rather than
 * on its signature. This is the case the client's refresh-and-retry
 * exists for, and the one path that must keep retrying.
 */
function expiredToken(sub = '00000000-0000-0000-0000-000000000000') {
  return jwt.sign({ sub, exp: Math.floor(Date.now() / 1000) - 60 }, config.JWT_SECRET);
}

// ---------- THE TOKEN IS NO GOOD: retry after a refresh ----------

test('an expired access token is INVALID_TOKEN', async () => {
  const { dek, payload } = await loggedIn();

  const res = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${expiredToken()}`)
    .send(await buildPasswordChange(dek, payload.authHash));

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_TOKEN');
});

test('an expired access token is INVALID_TOKEN on a vault read too', async () => {
  // The client's retry gate is not per-route, so the code cannot be
  // per-route either.
  const res = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${expiredToken()}`);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_TOKEN');
});

test('a bearer that is not a token at all is INVALID_TOKEN', async () => {
  // Expiry and a bad signature deliberately share one code: both mean
  // "this token is no good", and a refresh is the right answer to
  // either.
  const res = await request(app)
    .get('/api/vault')
    .set('Authorization', 'Bearer not.a.real.token');

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_TOKEN');
});

test('no Authorization header at all is NO_TOKEN', async () => {
  const account = await request(app).post('/api/account/password').send({});
  assert.strictEqual(account.status, 401);
  assert.strictEqual(account.body.error, 'NO_TOKEN');

  const vault = await request(app).get('/api/vault');
  assert.strictEqual(vault.status, 401);
  assert.strictEqual(vault.body.error, 'NO_TOKEN');
});

// ---------- THE CREDENTIAL IS WRONG: say so, retry nothing ----------
//
// Three routes reach the same check in accountService from three
// different call sites, so each is pinned separately. A rename in one
// of them is exactly the drift this file is here to catch.

test('a wrong master password on /api/account/password is INVALID_CREDENTIALS', async () => {
  const { token, dek } = await loggedIn();

  const res = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildPasswordChange(dek, WRONG_AUTH_HASH));

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
});

test('a wrong master password on /api/account/kdf-upgrade is INVALID_CREDENTIALS', async () => {
  const { token, dek } = await loggedIn();

  const res = await request(app)
    .post('/api/account/kdf-upgrade')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildUpgrade(dek, WRONG_AUTH_HASH));

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
});

test('a wrong master password on /api/account/recovery-kit is INVALID_CREDENTIALS', async () => {
  const { token, dek } = await loggedIn();

  const res = await request(app)
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${token}`)
    .send(buildKitRegeneration(dek, WRONG_AUTH_HASH));

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_CREDENTIALS');
});

test('a wrong code on /api/account/totp/confirm is INVALID_TOTP_CODE', async () => {
  const { token } = await loggedIn();

  const begin = await request(app)
    .post('/api/account/totp/begin')
    .set('Authorization', `Bearer ${token}`);

  const res = await request(app)
    .post('/api/account/totp/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: wrongCodeFor(begin.body.secret) });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_TOTP_CODE');
});

test('a wrong code on /api/account/totp/disable is INVALID_TOTP_CODE', async () => {
  const { token, secret } = await enrolled();

  const res = await request(app)
    .post('/api/account/totp/disable')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: wrongCodeFor(secret) });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_TOTP_CODE');
});

// ---------- THE PROPERTY THE CLIENT ACTUALLY DEPENDS ON ----------

test('a dead token and a wrong password are the same status and different codes', async () => {
  const { token, dek, payload } = await loggedIn();

  // Same route, same body shape, same status. Everything a client can
  // see is identical except the one field under test.
  const deadToken = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${expiredToken()}`)
    .send(await buildPasswordChange(dek, payload.authHash));

  const wrongPassword = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildPasswordChange(dek, WRONG_AUTH_HASH));

  assert.strictEqual(deadToken.status, 401);
  assert.strictEqual(wrongPassword.status, 401);
  assert.strictEqual(deadToken.status, wrongPassword.status,
                     'the status was never the thing that told these apart');

  assert.notStrictEqual(
    deadToken.body.error, wrongPassword.body.error,
    'a client cannot tell a dead token from a wrong password, so it must refresh-and-retry on both'
  );
});
