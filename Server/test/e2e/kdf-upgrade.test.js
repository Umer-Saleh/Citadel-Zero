require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF } = require('../helpers/db');
const {
  generateSalt, deriveKeys, wrapDEK, unwrapDEK,
  encryptItem, decryptItem, DEFAULT_KDF_PARAMS
} = require('../../src/crypto');

test.beforeEach(resetDatabase);
test.after(closeDatabase);

const EMAIL = 'test@example.com';
const PASSWORD = 'test-password-123';

// FAST_KDF sits at the OWASP floor, below production defaults —
// exactly the situation an upgrade exists to fix.
const STRONGER = { m:262144 , t: 3, p: 1 };

/** Build the client half of an upgrade: same password, stronger params. */
async function buildUpgrade(dek, currentAuthHash, params) {
  const newSalt = generateSalt();
  const { authHash, kek } = await deriveKeys(PASSWORD, newSalt, params);

  return {
    currentAuthHash,
    newAuthHash: authHash.toString('base64'),
    newKdfSalt: newSalt.toString('base64'),
    newKdfParams: params,
    newWrappedDek: wrapDEK(dek, kek)      // the SAME dek
  };
}

test('login flags accounts with stale KDF parameters', async () => {
  const { payload } = await makeSignupPayload(EMAIL, PASSWORD, FAST_KDF);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.body.kdfUpgradeAvailable, true);
  assert.deepStrictEqual(res.body.targetKdfParams, DEFAULT_KDF_PARAMS);
});

test('login does not flag accounts already at current defaults', async () => {
  const { payload } = await makeSignupPayload(EMAIL, PASSWORD, DEFAULT_KDF_PARAMS);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.body.kdfUpgradeAvailable, false);
});

test('upgrading preserves vault access with the same password', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, PASSWORD, FAST_KDF);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  // Store an item under the weak parameters.
  const secret = { site: 'github.com', password: 'hunter2' };
  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(encryptItem(secret, dek));

  // Upgrade.
  const res = await request(app)
    .post('/api/account/kdf-upgrade')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(await buildUpgrade(dek, payload.authHash, STRONGER));

  assert.strictEqual(res.status, 200);

  // Same password, but the client must now derive with the new params.
  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: EMAIL });

  assert.deepStrictEqual(params.body.kdfParams, STRONGER, 'parameters were not raised');

  const { authHash, kek } = await deriveKeys(
    PASSWORD,
    Buffer.from(params.body.kdfSalt, 'base64'),
    params.body.kdfParams
  );

  const newLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: authHash.toString('base64') });

  assert.strictEqual(newLogin.status, 200);

  const sameDek = unwrapDEK(newLogin.body.wrappedDek, kek);
  assert.deepStrictEqual(sameDek, dek, 'DEK changed during upgrade');

  const vault = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${newLogin.body.token}`);

  assert.deepStrictEqual(decryptItem(vault.body.items[0], sameDek), secret);
});

test('vault ciphertext is unchanged by an upgrade', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, PASSWORD, FAST_KDF);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(encryptItem({ site: 'github.com' }, dek));

  const before = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`);

  await request(app)
    .post('/api/account/kdf-upgrade')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(await buildUpgrade(dek, payload.authHash, STRONGER));

  const after = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`);

  assert.strictEqual(after.body.items[0].ciphertext, before.body.items[0].ciphertext);
});

// ---------- ADVERSARIAL ----------

test('a downgrade is rejected', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, PASSWORD, DEFAULT_KDF_PARAMS);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  // Legal per the schema (meets the OWASP floor) but below current defaults.
  const res = await request(app)
    .post('/api/account/kdf-upgrade')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(await buildUpgrade(dek, payload.authHash, FAST_KDF));

  assert.strictEqual(res.status, 400, 'a downgrade was accepted');

  // The account must be unchanged.
  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: EMAIL });

  assert.deepStrictEqual(params.body.kdfParams, DEFAULT_KDF_PARAMS);
});

test('upgrade requires the correct current password', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, PASSWORD, FAST_KDF);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  const wrongCurrent = Buffer.alloc(32, 7).toString('base64');

  const res = await request(app)
    .post('/api/account/kdf-upgrade')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(await buildUpgrade(dek, wrongCurrent, STRONGER));

  assert.strictEqual(res.status, 401);
});

test('upgrade requires authentication', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, PASSWORD, FAST_KDF);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/account/kdf-upgrade')
    .send(await buildUpgrade(dek, payload.authHash, STRONGER));

  assert.strictEqual(res.status, 401);
});