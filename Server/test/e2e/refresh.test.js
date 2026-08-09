require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload } = require('../helpers/db');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

/** Create an account and log into it. Returns the login response body. */
async function login() {
  const { payload } = await makeSignupPayload();
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  // Fail loudly here rather than letting every test fall over later
  // with a confusing undefined — a broken helper should name itself.
  assert.strictEqual(res.status, 200, 'login helper failed');

  return res.body;
}

const refresh = (refreshToken) =>
  request(app).post('/api/auth/refresh').send({ refreshToken });

test('login returns a refresh token', async () => {
  const session = await login();

  assert.match(session.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(session.refreshExpiresAt);
});

test('a refresh token can be exchanged for a new pair', async () => {
  const session = await login();

  const res = await refresh(session.refreshToken);

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token, 'expected a new access token');
  // Rotation: the token we get back must not be the one we sent.
  assert.notStrictEqual(res.body.refreshToken, session.refreshToken);
});

test('rotation does not extend the session expiry', async () => {
  const session = await login();

  const res = await refresh(session.refreshToken);

  assert.strictEqual(res.status, 200);
  // Absolute expiry: the family dies 14 days after login whatever
  // happens in between. A sliding window would let a stolen family
  // be renewed indefinitely.
  assert.strictEqual(
    new Date(res.body.refreshExpiresAt).getTime(),
    new Date(session.refreshExpiresAt).getTime()
  );
});

test('a rotated token cannot be used twice', async () => {
  const session = await login();

  const first = await refresh(session.refreshToken);
  // Precondition — without it this passes vacuously if the first
  // refresh already failed for some unrelated reason.
  assert.strictEqual(first.status, 200);

  const replay = await refresh(session.refreshToken);

  assert.strictEqual(replay.status, 401);
});

test('reuse revokes the whole family, including the valid token', async () => {
  const session = await login();

  const rotated = await refresh(session.refreshToken);
  assert.strictEqual(rotated.status, 200);

  // Replay the SPENT token. Two parties holding one credential is the
  // theft signal.
  const replay = await refresh(session.refreshToken);
  assert.strictEqual(replay.status, 401);

  // THE POINT OF THE WHOLE FEATURE. The currently-valid token, held by
  // whoever rotated legitimately, is dead too. The server can't tell
  // victim from thief, so it distrusts both and forces everyone back
  // to the master password — which the attacker doesn't have.
  const after = await refresh(rotated.body.refreshToken);
  assert.strictEqual(after.status, 401, 'family should have been revoked');
});

test('a valid token still works if no reuse happened', async () => {
  const session = await login();

  const first = await refresh(session.refreshToken);
  assert.strictEqual(first.status, 200);

  // The negative control for the test above: without this, that test
  // would still pass if refresh were simply broken and rejected
  // everything. Chained rotation must keep working.
  const second = await refresh(first.body.refreshToken);
  assert.strictEqual(second.status, 200);

  const third = await refresh(second.body.refreshToken);
  assert.strictEqual(third.status, 200);
});

test('logout revokes the session', async () => {
  const session = await login();

  const out = await request(app)
    .post('/api/auth/logout')
    .send({ refreshToken: session.refreshToken });

  assert.strictEqual(out.status, 204);

  const res = await refresh(session.refreshToken);
  assert.strictEqual(res.status, 401);
});

test('logout revokes the whole family, not just the token presented', async () => {
  const session = await login();

  const rotated = await refresh(session.refreshToken);
  assert.strictEqual(rotated.status, 200);

  // Log out with the ORIGINAL token, which is already spent.
  await request(app)
    .post('/api/auth/logout')
    .send({ refreshToken: session.refreshToken });

  // The newer token dies with it: "log me out" means the session
  // ends, not that one link in the chain is spent.
  const res = await refresh(rotated.body.refreshToken);
  assert.strictEqual(res.status, 401);
});

test('logout is silent about unknown tokens', async () => {
  const res = await request(app)
    .post('/api/auth/logout')
    .send({ refreshToken: 'A'.repeat(43) });

  // 204 whether or not the token was real. A different response would
  // confirm to an attacker that a token they hold was once genuine.
  assert.strictEqual(res.status, 204);
});

test('an unknown refresh token is rejected', async () => {
  const res = await refresh('A'.repeat(43));
  assert.strictEqual(res.status, 401);
});

test('a malformed refresh token is rejected by validation', async () => {
  const res = await refresh('nope');
  assert.strictEqual(res.status, 400);
});