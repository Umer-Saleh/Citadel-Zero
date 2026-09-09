require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload, query } = require('../helpers/db');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

/**
 * An account's identity does not depend on how it was capitalised.
 *
 * It used to. `email` is text with a UNIQUE constraint, Postgres
 * compares text case sensitively, and neither side folded — so
 * Reviewer@Example.com and reviewer@example.com were two accounts with
 * two vaults, two DEKs and two recovery keys. Someone who capitalised
 * inconsistently between visits was shown an EMPTY VAULT and had every
 * reason to think their entries were gone.
 *
 * Two properties are being pinned here, and they are different:
 *
 *   1. A colliding account cannot be CREATED. That is the unique index
 *      on lower(email), and it holds no matter what the application
 *      code does.
 *   2. An existing account can be FOUND under any casing. That is the
 *      lower() in the repository lookups.
 *
 * Property 1 is the one that matters most, because its failure is
 * silent. Property 2 failing is merely a visible not-found.
 */

const UPPER = 'Reviewer@Example.com';
const LOWER = 'reviewer@example.com';
const MIXED = 'ReViEwEr@eXaMpLe.CoM';

/** Sign up UPPER and return the payload, so a later login can reuse its hash. */
async function signUpUpper() {
  const { payload } = await makeSignupPayload(UPPER);
  const res = await request(app).post('/api/auth/signup').send(payload);
  assert.strictEqual(res.status, 201, 'setup: first signup should succeed');
  return payload;
}

test('a second account differing only by case is refused', async () => {
  await signUpUpper();

  // A DIFFERENT payload — its own salt, its own wrapped DEK — exactly
  // as a person retyping their address on another day would produce.
  const { payload: second } = await makeSignupPayload(LOWER);
  const res = await request(app).post('/api/auth/signup').send(second);

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'EMAIL_TAKEN');
});

test('an exact duplicate is still refused', async () => {
  // The control for the test above. Without it, a build that refused
  // every signup after the first would pass.
  const payload = await signUpUpper();

  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'EMAIL_TAKEN');
});

test('only one row exists after a colliding signup attempt', async () => {
  await signUpUpper();
  const { payload: second } = await makeSignupPayload(LOWER);
  await request(app).post('/api/auth/signup').send(second);

  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  assert.strictEqual(rows[0].n, 1, 'a colliding account reached the table');
});

test('login finds the account under a different casing', async () => {
  const payload = await signUpUpper();

  // The same authHash — it was derived from the same password and the
  // same salt. Only the spelling of the address differs.
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: LOWER, authHash: payload.authHash });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token, 'expected a session token');
});

test('login finds the account under mixed casing', async () => {
  const payload = await signUpUpper();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: MIXED, authHash: payload.authHash });

  assert.strictEqual(res.status, 200);
});

test('login still refuses an address that is genuinely different', async () => {
  // Folding must not make everything match. Without this, a lookup
  // that ignored the address entirely would pass every test above.
  const payload = await signUpUpper();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'someone-else@example.com', authHash: payload.authHash });

  assert.strictEqual(res.status, 401);
});

test('the stored address keeps the casing it was created with', async () => {
  const payload = await signUpUpper();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: LOWER, authHash: payload.authHash });
  assert.strictEqual(res.status, 200);

  // Signed in via the lowercase spelling, but what the server HOLDS is
  // what was typed at signup. Asserted against the column rather than
  // the response, because the login route does not currently return
  // the address at all — only comparison folds, storage is untouched.
  const { rows } = await query('SELECT email FROM users');
  assert.strictEqual(rows[0].email, UPPER, 'the stored value was rewritten');
});

test('kdf-params finds the account under a different casing', async () => {
  const payload = await signUpUpper();

  const res = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: LOWER });

  assert.strictEqual(res.status, 200);
  // The same salt either way, or the client would derive a key that
  // cannot unwrap the DEK.
  assert.strictEqual(res.body.kdfSalt, payload.kdfSalt);
});

test('recovery material is reachable under a different casing', async () => {
  // Recovery is reached precisely BECAUSE someone is already locked
  // out. An exact-match lookup here would tell them no vault exists at
  // the one moment they are least able to work out why.
  await signUpUpper();

  const res = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: LOWER });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.recoverySalt, 'expected recovery material');
});

test('recovery material is still 404 for an unknown address', async () => {
  await signUpUpper();

  const res = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: 'nobody@example.com' });

  assert.strictEqual(res.status, 404);
});
