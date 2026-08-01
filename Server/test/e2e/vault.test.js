require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload } = require('../helpers/db');
const { encryptItem, decryptItem } = require('../../src/crypto');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

/** Sign up, log in, and return { token, kek }. */
async function createUserAndLogin(email = 'test@example.com') {
  const { payload, kek } = await makeSignupPayload(email);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  return { token: res.body.token, kek };
}

test('vault is empty for a new user', async () => {
  const { token } = await createUserAndLogin();

  const res = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.items, []);
});

test('an item can be stored and retrieved', async () => {
  const { token, kek } = await createUserAndLogin();
  const secret = { site: 'github.com', password: 'hunter2' };

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem(secret, kek));

  assert.strictEqual(created.status, 201);
  assert.ok(created.body.id);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(list.body.items.length, 1);
  assert.deepStrictEqual(decryptItem(list.body.items[0], kek), secret);
});

test('the server never returns plaintext', async () => {
  const { token, kek } = await createUserAndLogin();

  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'hunter2' }, kek));

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  // Precondition: the item must actually exist, or the checks below
  // pass vacuously against an empty list and prove nothing.
  assert.strictEqual(list.body.items.length, 1, 'precondition: item was not stored');

  const body = JSON.stringify(list.body);
  assert.ok(!body.includes('hunter2'), 'plaintext password leaked in response');
  assert.ok(!body.includes('github.com'), 'plaintext site leaked in response');
});

test('an item can be updated', async () => {
  const { token, kek } = await createUserAndLogin();

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'old' }, kek));

  const updated = await request(app)
    .put(`/api/vault/${created.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'new' }, kek));

  assert.strictEqual(updated.status, 200);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(decryptItem(list.body.items[0], kek).password, 'new');
});

test('an item can be deleted', async () => {
  const { token, kek } = await createUserAndLogin();

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com' }, kek));

  const deleted = await request(app)
    .delete(`/api/vault/${created.body.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(deleted.status, 200);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(list.body.items.length, 0);
});

// ---------- ADVERSARIAL ----------

test('vault requires a token', async () => {
  const res = await request(app).get('/api/vault');
  assert.strictEqual(res.status, 401);
});

test('a forged token is rejected', async () => {
  const res = await request(app)
    .get('/api/vault')
    .set('Authorization', 'Bearer not.a.real.token');

  assert.strictEqual(res.status, 401);
});

test('user A cannot read user B items', async () => {
  const alice = await createUserAndLogin('alice@example.com');
  const bob = await createUserAndLogin('bob@example.com');

  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`)
    .send(encryptItem({ site: 'secret.com' }, bob.kek));

  const aliceView = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${alice.token}`);

  assert.strictEqual(aliceView.body.items.length, 0, 'Alice can see Bob items');
});

test('user A cannot modify user B items', async () => {
  const alice = await createUserAndLogin('alice@example.com');
  const bob = await createUserAndLogin('bob@example.com');

  const bobItem = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`)
    .send(encryptItem({ site: 'secret.com', password: 'bob-secret' }, bob.kek));

  const attack = await request(app)
    .put(`/api/vault/${bobItem.body.id}`)
    .set('Authorization', `Bearer ${alice.token}`)
    .send(encryptItem({ site: 'hacked.com' }, alice.kek));

  assert.strictEqual(attack.status, 404, 'expected 404, not 403 — 403 confirms the item exists');

  // Bob's data must be untouched
  const bobView = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`);

  assert.strictEqual(decryptItem(bobView.body.items[0], bob.kek).password, 'bob-secret');
});

test('user A cannot delete user B items', async () => {
  const alice = await createUserAndLogin('alice@example.com');
  const bob = await createUserAndLogin('bob@example.com');

  const bobItem = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`)
    .send(encryptItem({ site: 'secret.com' }, bob.kek));

  const attack = await request(app)
    .delete(`/api/vault/${bobItem.body.id}`)
    .set('Authorization', `Bearer ${alice.token}`);

  assert.strictEqual(attack.status, 404);

  const bobView = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`);

  assert.strictEqual(bobView.body.items.length, 1, 'Alice deleted Bob item');
});