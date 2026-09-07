require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { unwrapDEK } = require('../../src/crypto');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload } = require('../helpers/db');
const { encryptItem, decryptItem } = require('../../src/crypto');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

/** Sign up, log in, and return { token, dek }. */
async function createUserAndLogin(email = 'test@example.com') {
  const { payload, kek } = await makeSignupPayload(email);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: payload.email, authHash: payload.authHash });

  // The client unwraps the DEK returned by the server.
  const dek = unwrapDEK(res.body.wrappedDek, kek);

  return { token: res.body.token, dek };
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
  const { token, dek } = await createUserAndLogin();
  const secret = { site: 'github.com', password: 'hunter2' };

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem(secret, dek));

  assert.strictEqual(created.status, 201);
  assert.ok(created.body.id);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(list.body.items.length, 1);
  assert.deepStrictEqual(decryptItem(list.body.items[0], dek), secret);
});

test('the server never returns plaintext', async () => {
  const { token, dek } = await createUserAndLogin();

  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'hunter2' }, dek));

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
  const { token, dek } = await createUserAndLogin();

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'old' }, dek));

  const updated = await request(app)
    .put(`/api/vault/${created.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com', password: 'new' }, dek));

  assert.strictEqual(updated.status, 200);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(decryptItem(list.body.items[0], dek).password, 'new');
});

test('an item can be deleted', async () => {
  const { token, dek } = await createUserAndLogin();

  const created = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com' }, dek));

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
    .send(encryptItem({ site: 'secret.com' }, bob.dek));

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
    .send(encryptItem({ site: 'secret.com', password: 'bob-secret' }, bob.dek));

  const attack = await request(app)
    .put(`/api/vault/${bobItem.body.id}`)
    .set('Authorization', `Bearer ${alice.token}`)
    .send(encryptItem({ site: 'hacked.com' }, alice.dek));

  assert.strictEqual(attack.status, 404, 'expected 404, not 403 — 403 confirms the item exists');

  // Bob's data must be untouched
  const bobView = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`);

  assert.strictEqual(decryptItem(bobView.body.items[0], bob.dek).password, 'bob-secret');
});

test('user A cannot delete user B items', async () => {
  const alice = await createUserAndLogin('alice@example.com');
  const bob = await createUserAndLogin('bob@example.com');

  const bobItem = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`)
    .send(encryptItem({ site: 'secret.com' }, bob.dek));

  const attack = await request(app)
    .delete(`/api/vault/${bobItem.body.id}`)
    .set('Authorization', `Bearer ${alice.token}`);

  assert.strictEqual(attack.status, 404);

  const bobView = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${bob.token}`);

  assert.strictEqual(bobView.body.items.length, 1, 'Alice deleted Bob item');
});
test('the vault refuses a new item once it is full', async () => {
  const { token, dek } = await createUserAndLogin();
  const { MAX_ITEMS_PER_USER } = require('../../src/services/vaultService');
  const { query } = require('../../src/db');

  // Filled with one statement rather than MAX_ITEMS_PER_USER HTTP
  // round trips. What is under test is the service's refusal, not the
  // insert path, and a thousand requests would dominate the suite.
  const userId = (await query('SELECT id FROM users LIMIT 1')).rows[0].id;
  await query(
    `INSERT INTO vault_items (user_id, encrypted_data, nonce, auth_tag)
     SELECT $1, 'ciphertext', 'nonce', 'tag' FROM generate_series(1, $2)`,
    [userId, MAX_ITEMS_PER_USER]
  );

  const blob = encryptItem({ site: 'one too many' }, dek);
  const res = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(blob);

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'VAULT_FULL');
});

test('the item at the limit still stores, and the vault still reads', async () => {
  // The other half. A cap that refused one early — or that broke
  // listing once the vault was large — would pass the test above.
  const { token, dek } = await createUserAndLogin();
  const { MAX_ITEMS_PER_USER } = require('../../src/services/vaultService');
  const { query } = require('../../src/db');

  const userId = (await query('SELECT id FROM users LIMIT 1')).rows[0].id;
  await query(
    `INSERT INTO vault_items (user_id, encrypted_data, nonce, auth_tag)
     SELECT $1, 'ciphertext', 'nonce', 'tag' FROM generate_series(1, $2)`,
    [userId, MAX_ITEMS_PER_USER - 1]
  );

  const res = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'the thousandth' }, dek));

  assert.strictEqual(res.status, 201);

  const list = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.items.length, MAX_ITEMS_PER_USER);
});

test('the cap is per user, not global', async () => {
  // A COUNT(*) missing its WHERE would pass every assertion above.
  const first = await createUserAndLogin('full@example.com');
  const { query } = require('../../src/db');
  const { MAX_ITEMS_PER_USER } = require('../../src/services/vaultService');

  const fullUserId = (await query(
    'SELECT id FROM users WHERE email = $1', ['full@example.com']
  )).rows[0].id;
  await query(
    `INSERT INTO vault_items (user_id, encrypted_data, nonce, auth_tag)
     SELECT $1, 'ciphertext', 'nonce', 'tag' FROM generate_series(1, $2)`,
    [fullUserId, MAX_ITEMS_PER_USER]
  );

  // The first account is full.
  const refused = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${first.token}`)
    .send(encryptItem({ site: 'nope' }, first.dek));
  assert.strictEqual(refused.status, 409);

  // A second account is unaffected.
  const second = await createUserAndLogin('empty@example.com');
  const allowed = await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${second.token}`)
    .send(encryptItem({ site: 'fine' }, second.dek));
  assert.strictEqual(allowed.status, 201);
});
