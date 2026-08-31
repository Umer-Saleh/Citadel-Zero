require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF, query } = require('../helpers/db');
const {
  generateSalt, deriveKeys, wrapDEK, unwrapDEK, encryptItem, decryptItem,
  generateRecoveryKey, deriveRecoveryKek, deriveRecoveryAuthHash
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

// ---------- RECOVERY ----------

/** Build the client-side half of a recovery, given the recovery key. */
async function buildRecovery(email, recoveryKey, recoveryMaterial, newPassword) {
  // Unwrap the DEK using the recovery key — this is the whole point.
  const recoveryKek = deriveRecoveryKek(
    recoveryKey,
    Buffer.from(recoveryMaterial.recoverySalt, 'base64')
  );
  const dek = unwrapDEK(recoveryMaterial.recoveryWrappedDek, recoveryKek);

  // Set up new credentials around the recovered DEK.
  const newSalt = generateSalt();
  const { authHash, kek } = await deriveKeys(newPassword, newSalt, FAST_KDF);

  // Issue a fresh recovery kit too — the old one has been used.
  const newRecoveryKey = generateRecoveryKey();
  const newRecoverySalt = generateSalt();
  const newRecoveryKek = deriveRecoveryKek(newRecoveryKey, newRecoverySalt);

  return {
    dek,
    newRecoveryKey,
    payload: {
      email,
      // Proof that we hold the CURRENT key, derived under the same
      // salt the server stored the verifier against.
      recoveryAuthHash: deriveRecoveryAuthHash(
        recoveryKey, Buffer.from(recoveryMaterial.recoverySalt, 'base64')
      ).toString('base64'),
      newRecoveryAuthHash: deriveRecoveryAuthHash(
        newRecoveryKey, newRecoverySalt
      ).toString('base64'),
      newAuthHash: authHash.toString('base64'),
      newKdfSalt: newSalt.toString('base64'),
      newKdfParams: FAST_KDF,
      newWrappedDek: wrapDEK(dek, kek),
      newRecoverySalt: newRecoverySalt.toString('base64'),
      newRecoveryWrappedDek: wrapDEK(dek, newRecoveryKek)
    }
  };
}

/**
 * Build the client-side half of a kit regeneration: a fresh recovery
 * key wrapping the SAME dek. Nothing password-derived is touched.
 */
function buildKitRegeneration(dek, currentAuthHash) {
  const newRecoveryKey = generateRecoveryKey();
  const newRecoverySalt = generateSalt();
  const newRecoveryKek = deriveRecoveryKek(newRecoveryKey, newRecoverySalt);

  return {
    newRecoveryKey,
    payload: {
      currentAuthHash,
      newRecoverySalt: newRecoverySalt.toString('base64'),
      newRecoveryWrappedDek: wrapDEK(dek, newRecoveryKek),
      newRecoveryAuthHash: deriveRecoveryAuthHash(
        newRecoveryKey, newRecoverySalt
      ).toString('base64')
    }
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

test('the recovery key unwraps the same DEK as the password', async () => {
  const { payload, dek, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  assert.strictEqual(material.status, 200);

  const recoveryKek = deriveRecoveryKek(
    recoveryKey,
    Buffer.from(material.body.recoverySalt, 'base64')
  );

  assert.deepStrictEqual(
    unwrapDEK(material.body.recoveryWrappedDek, recoveryKek),
    dek,
    'recovery wrapper does not contain the same DEK'
  );
});

test('recovery restores access to the vault', async () => {
  const { payload, dek, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  // Store an item under the original password.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  const secret = { site: 'github.com', password: 'hunter2' };
  await request(app)
    .post('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(encryptItem(secret, dek));

  // The password is now forgotten. Recover with the kit.
  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);

  const res = await request(app)
    .post('/api/account/recover')
    .send(recovery.payload);

  assert.strictEqual(res.status, 200);

  // Log in with the new password and read the vault.
  const params = await request(app)
    .get('/api/user/kdf-params')
    .query({ email: EMAIL });

  const { authHash, kek } = await deriveKeys(
    NEW_PASSWORD,
    Buffer.from(params.body.kdfSalt, 'base64'),
    params.body.kdfParams
  );

  const newLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: authHash.toString('base64') });

  assert.strictEqual(newLogin.status, 200);

  const recoveredDek = unwrapDEK(newLogin.body.wrappedDek, kek);
  assert.deepStrictEqual(recoveredDek, dek, 'DEK changed during recovery');

  const vault = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${newLogin.body.token}`);

  assert.deepStrictEqual(decryptItem(vault.body.items[0], recoveredDek), secret);
});

test('the old password stops working after recovery', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);
  await request(app).post('/api/account/recover').send(recovery.payload);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(res.status, 401);
});

test('the old recovery key stops working after recovery', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);
  await request(app).post('/api/account/recover').send(recovery.payload);

  // The wrapper was replaced, so the old key can no longer unwrap it.
  const after = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const oldKek = deriveRecoveryKek(
    recoveryKey,
    Buffer.from(after.body.recoverySalt, 'base64')
  );

  assert.throws(() => unwrapDEK(after.body.recoveryWrappedDek, oldKek));
});

test('a wrong recovery key cannot unwrap the DEK', async () => {
  const { payload } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const wrongKek = deriveRecoveryKek(
    generateRecoveryKey(),
    Buffer.from(material.body.recoverySalt, 'base64')
  );

  assert.throws(() => unwrapDEK(material.body.recoveryWrappedDek, wrongKek));
});

test('recovery material is not available for an unknown account', async () => {
  const res = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: 'nobody@nowhere.com' });

  assert.strictEqual(res.status, 404);
});

// ---------- KIT REGENERATION ----------
//
// Recovery rotates the kit as a side effect, but there was no way to
// rotate it on its own — so a user who knew their key was exposed had
// to go through a full recovery to replace it. This is that.

test('regenerating the kit issues a working new recovery wrapper', async () => {
  const { payload, dek, recoveryKey: oldKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  const regen = buildKitRegeneration(dek, payload.authHash);

  const res = await request(app)
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(regen.payload);

  assert.strictEqual(res.status, 200);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  // The NEW key opens the vault...
  const newKek = deriveRecoveryKek(
    regen.newRecoveryKey,
    Buffer.from(material.body.recoverySalt, 'base64')
  );
  assert.deepStrictEqual(
    unwrapDEK(material.body.recoveryWrappedDek, newKek), dek,
    'the new recovery key does not unwrap the same DEK'
  );

  // ...and the OLD one is dead. That is the whole point: a key you
  // know was exposed can be retired without a full recovery.
  const oldKek = deriveRecoveryKek(
    oldKey,
    Buffer.from(material.body.recoverySalt, 'base64')
  );
  assert.throws(() => unwrapDEK(material.body.recoveryWrappedDek, oldKek),
                'the old recovery key still works');
});

test('regenerating leaves the master password working', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  await request(app)
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(buildKitRegeneration(dek, payload.authHash).payload);

  // Unlike recovery, this must NOT touch the password path.
  const after = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(after.status, 200, 'the master password stopped working');

  const { kek } = await deriveKeys(
    OLD_PASSWORD, Buffer.from(payload.kdfSalt, 'base64'), FAST_KDF
  );
  assert.deepStrictEqual(unwrapDEK(after.body.wrappedDek, kek), dek);
});

test('regenerating requires the master password', async () => {
  const { payload, dek, recoveryKey: oldKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  const wrongCurrent = Buffer.alloc(32, 7).toString('base64');

  const res = await request(app)
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(buildKitRegeneration(dek, wrongCurrent).payload);

  // A valid session is not enough. Someone who borrowed an unlocked
  // laptop must not be able to mint a permanent key to the vault.
  assert.strictEqual(res.status, 401);

  // And the existing kit is untouched.
  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const oldKek = deriveRecoveryKek(
    oldKey, Buffer.from(material.body.recoverySalt, 'base64')
  );
  assert.deepStrictEqual(unwrapDEK(material.body.recoveryWrappedDek, oldKek), dek);
});

test('regenerating does not touch vault ciphertext', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
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
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(buildKitRegeneration(dek, payload.authHash).payload);

  const after = await request(app)
    .get('/api/vault')
    .set('Authorization', `Bearer ${login.body.token}`);

  assert.strictEqual(after.body.items[0].ciphertext, before.body.items[0].ciphertext,
                     'vault items were re-encrypted');
});

test('regenerating requires authentication', async () => {
  const { payload, dek } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const res = await request(app)
    .post('/api/account/recovery-kit')
    .send(buildKitRegeneration(dek, payload.authHash).payload);

  assert.strictEqual(res.status, 401);
});

// ---------------------------------------------------------------
// PROOF OF POSSESSION
//
// /api/account/recover used to verify nothing. It looked an account
// up by email and overwrote auth_hash, kdf_salt, kdf_params, both DEK
// wrappers and every session, so one unauthenticated request with
// syntactically valid garbage permanently destroyed any account whose
// email was known. These tests exist so that cannot come back.
// ---------------------------------------------------------------

/** Everything a recovery is able to destroy, in one comparable value. */
async function accountFingerprint(email) {
  const { rows } = await query(
    `SELECT auth_hash, kdf_salt, kdf_params, wrapped_dek,
            wrapped_dek_nonce, wrapped_dek_tag,
            recovery_salt, recovery_wrapped_dek,
            recovery_wrapped_dek_nonce, recovery_wrapped_dek_tag,
            recovery_auth_hash
     FROM users WHERE email = $1`,
    [email]
  );
  return JSON.stringify(rows[0]);
}

test('recovery with a correct proof succeeds', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);

  const res = await request(app).post('/api/account/recover').send(recovery.payload);

  assert.strictEqual(res.status, 200);
});

test('recovery with a WRONG proof is rejected and writes nothing', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);

  // Everything else about this request is valid. Only the proof is
  // wrong — which is exactly the shape of the original attack.
  recovery.payload.recoveryAuthHash = Buffer.alloc(32).toString('base64');

  const before = await accountFingerprint(EMAIL);

  const res = await request(app).post('/api/account/recover').send(recovery.payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_RECOVERY_KEY');

  // The regression test for the defect. Not "the response was an
  // error" — that the row is byte for byte what it was.
  assert.strictEqual(await accountFingerprint(EMAIL), before);

  // And the account is still usable: the original password still logs
  // in, which it would not if any credential column had moved.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  assert.strictEqual(login.status, 200);
});

test('recovery against an unknown email fails identically', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const known = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);

  // Same request, wrong proof, against an account that exists.
  const wrongProof = {
    ...known.payload,
    recoveryAuthHash: Buffer.alloc(32).toString('base64')
  };
  const a = await request(app).post('/api/account/recover').send(wrongProof);

  // Same request again, against an account that does not exist.
  const b = await request(app)
    .post('/api/account/recover')
    .send({ ...wrongProof, email: 'nobody@example.com' });

  // An attacker must not be able to tell "wrong key" from "no such
  // account", or this endpoint enumerates accounts.
  assert.strictEqual(a.status, b.status);
  assert.deepStrictEqual(a.body, b.body);
  assert.strictEqual(b.status, 401);
});

test('recovery is refused for an account with no stored proof', async () => {
  const { payload, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const material = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const recovery = await buildRecovery(EMAIL, recoveryKey, material.body, NEW_PASSWORD);

  // Simulate an account created before proof of possession existed.
  await query('UPDATE users SET recovery_auth_hash = NULL WHERE email = $1', [EMAIL]);

  const before = await accountFingerprint(EMAIL);

  // The correct recovery key must NOT be enough on its own. Falling
  // back to the old unverified path for these rows would leave the
  // defect open for exactly the accounts that cannot defend themselves.
  const res = await request(app).post('/api/account/recover').send(recovery.payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_RECOVERY_KEY');
  assert.strictEqual(await accountFingerprint(EMAIL), before);

  // The user is told at the START of the flow, where it is actionable,
  // rather than after typing a key that cannot work.
  const probe = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  assert.strictEqual(probe.status, 409);
  assert.strictEqual(probe.body.error, 'RECOVERY_UNAVAILABLE');
});

test('regenerating the kit invalidates the previous recovery key', async () => {
  const { payload, dek, recoveryKey } = await makeSignupPayload(EMAIL, OLD_PASSWORD);
  await request(app).post('/api/auth/signup').send(payload);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, authHash: payload.authHash });

  // What the OLD key would have proved, captured before rotation.
  const before = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const staleRecovery = await buildRecovery(
    EMAIL, recoveryKey, before.body, NEW_PASSWORD
  );

  const regen = buildKitRegeneration(dek, payload.authHash);
  const rotated = await request(app)
    .post('/api/account/recovery-kit')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send(regen.payload);

  assert.strictEqual(rotated.status, 200);

  // The retired key must no longer prove anything, though it was valid
  // moments ago.
  const res = await request(app)
    .post('/api/account/recover')
    .send(staleRecovery.payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'INVALID_RECOVERY_KEY');

  // And the NEW key does work, so rotation replaced rather than broke.
  const after = await request(app)
    .get('/api/account/recovery-material')
    .query({ email: EMAIL });

  const fresh = await buildRecovery(
    EMAIL, regen.newRecoveryKey, after.body, NEW_PASSWORD
  );
  const ok = await request(app).post('/api/account/recover').send(fresh.payload);

  assert.strictEqual(ok.status, 200);
});
