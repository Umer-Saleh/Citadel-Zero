require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload } = require('../helpers/db');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

test('signup returns 201', async () => {
  const { payload } = await makeSignupPayload();
  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.ok, true);
});

test('duplicate signup returns 409', async () => {
  const { payload } = await makeSignupPayload();

  await request(app).post('/api/auth/signup').send(payload);
  const second = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(second.status, 409);
});

test('signup with missing fields returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ email: 'x@y.com' });

  assert.strictEqual(res.status, 400);
});

test('kdf-params returns salt and params for a known user', async () => {
  const { payload } = await makeSignupPayload();
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: payload.email });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.kdfSalt, payload.kdfSalt);
  assert.deepStrictEqual(res.body.kdfParams, payload.kdfParams);
});

test('kdf-params returns 404 for an unknown user', async () => {
  const res = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: 'nobody@nowhere.com' });

  assert.strictEqual(res.status, 404);
});

test('login with correct credentials returns a token', async () => {
  const { payload } = await makeSignupPayload();
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token, 'expected a token');
});

test('login with wrong authHash returns 401', async () => {
  const { payload } = await makeSignupPayload();
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });

  assert.strictEqual(res.status, 401);
});

test('login for an unknown account returns 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@nowhere.com', authHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });

  assert.strictEqual(res.status, 401);
});

test('signup rejects KDF parameters below the OWASP floor', async () => {
  const { payload } = await makeSignupPayload();
  payload.kdfParams = { m: 8, t: 1, p: 1 };

  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 400, 'weak KDF params were accepted');
});

test('signup rejects unknown fields', async () => {
  const { payload } = await makeSignupPayload();
  payload.isAdmin = true;

  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 400);
});

test('signup rejects a malformed email', async () => {
  const { payload } = await makeSignupPayload();
  payload.email = 'not-an-email';

  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 400);
});

test('signup rejects a wrong-length authHash', async () => {
  const { payload } = await makeSignupPayload();
  payload.authHash = 'dG9vc2hvcnQ=';

  const res = await request(app).post('/api/auth/signup').send(payload);

  assert.strictEqual(res.status, 400);
});