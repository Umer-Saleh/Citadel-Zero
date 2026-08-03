require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF } = require('../helpers/db');
const {
  generateSalt, deriveKeys, wrapDEK, unwrapDEK, encryptItem, decryptItem
} = require('../../src/crypto');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

const EMAIL = 'test@example.com';
const OLD_PASSWORD = 'test-password-123';
const NEW_PASSWORD = 'a-completely-different-password';

/** Sign up and log in. Returns the token, the DEK, and the signup payload. */
async function setup() {
  const { payload, kek } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  return {
    token: res.body.token,
    dek: unwrapDEK(res.body.wrappedDek, kek),
    payload
  };
}

/** Build the client-side half of a password change. */
async function buildPasswordChange(dek, currentAuthHash, newPassword = NEW_PASSWORD) {
  const newSalt = generateSalt();
  const { authHash: newAuthHash, kek: newKek } = await deriveKeys(newPassword, newSalt, FAST_KDF);

  return {
    currentAuthHash,
    newAuthHash: newAuthHash.toString('base64'),
    newKdfSalt: newSalt.toString('base64'),
    newKdfParams: FAST_KDF,
    newWrappedDek: wrapDEK(dek, newKek)      // the SAME dek, new wrapper
  };
}

// ---------- THE POINT ----------

test('vault items still decrypt after a password change', async () => {
  const { token, dek, payload } = await setup();
  const secret = { site: 'github.com', password: 'hunter2' };

  // Store an item under the original password.
  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem(secret, dek));

  // Change the master password.
  const change = await buildPasswordChange(dek, payload.authHash);
  const res = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(change);

  assert.strictEqual(res.status, 200);

  // Log in with the NEW password and unwrap the DEK afresh.
  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: EMAIL });

  const { authHash, kek } = await deriveKeys(
    NEW_PASSWORD,
    Buffer.from(params.body.kdfSalt, 'base64'),
    params.body.kdfParams
  );

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: authHash.toString('base64') });

  assert.strictEqual(login.status, 200);

  const newDek = unwrapDEK(login.body.wrappedDek, kek);
  assert.deepStrictEqual(newDek, dek, 'DEK changed across a password change');

  // The item was never re-encrypted, and still decrypts.
  const vault = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`);

  assert.deepStrictEqual(decryptItem(vault.body.items[0], newDek), secret);
});

test('the ciphertext is unchanged by a password change', async () => {
  const { token, dek, payload } = await setup();

  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${token}`)
    .send(encryptItem({ site: 'github.com' }, dek));

  const before = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildPasswordChange(dek, payload.authHash));

  const after = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(after.body.items[0].ciphertext, before.body.items[0].ciphertext,
                     'vault items were re-encrypted');
});

// ---------- AUTHENTICATION ----------

test('the old password no longer works', async () => {
  const { token, dek, payload } = await setup();

  await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildPasswordChange(dek, payload.authHash));

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.status, 401, 'old password still authenticates');
});

test('password change requires the correct current password', async () => {
  const { token, dek } = await setup();

  const wrongCurrent = Buffer.alloc(32, 7).toString('base64');
  const change = await buildPasswordChange(dek, wrongCurrent);

  const res = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(change);

  assert.strictEqual(res.status, 401);
});

test('password change requires authentication', async () => {
  const { dek, payload } = await setup();

  const res = await request(app)
    .post('/api/account/password')
    .send(await buildPasswordChange(dek, payload.authHash));

  assert.strictEqual(res.status, 401);
});

test('a failed password change leaves credentials intact', async () => {
  const { token, dek, payload } = await setup();

  const wrongCurrent = Buffer.alloc(32, 7).toString('base64');
  await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${token}`)
    .send(await buildPasswordChange(dek, wrongCurrent));

  // The original password must still work.
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(unwrapDEK(res.body.wrappedDek,
    (await deriveKeys(OLD_PASSWORD,
      Buffer.from(payload.kdfSalt, 'base64'), FAST_KDF)).kek), dek);
});

test('one user cannot change another user password', async () => {
  const alice = await setup();

  const { payload: bobPayload } = await makeSignupPayload('bob@example.com', OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(bobPayload);

  // Alice's token, Bob's current auth hash.
  const res = await request(app)
    .post('/api/account/password')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(await buildPasswordChange(alice.dek, bobPayload.authHash));

  assert.strictEqual(res.status, 401, 'cross-user password change succeeded');

  // Bob's password is unchanged.
  const bobLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'bob@example.com', authHash: bobPayload.authHash });

  assert.strictEqual(bobLogin.status, 200);
});