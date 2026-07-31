require('./setup');

const { query, pool } = require('../../src/db');
const { generateSalt, deriveKeys } = require('../../src/crypto');

// Cheap KDF params for tests. We are testing logic, not cost.
const FAST_KDF = { m: 8192, t: 1, p: 1 };

async function resetDatabase() {
  await query('TRUNCATE vault_items, users RESTART IDENTITY CASCADE');
}

async function closeDatabase() {
  await pool.end();
}

/** Build a valid signup payload plus the keys the client would keep. */
async function makeSignupPayload(email = 'test@example.com', password = 'test-password-123') {
  const salt = generateSalt();
  const { authHash, vaultKey } = await deriveKeys(password, salt, FAST_KDF);

  return {
    payload: {
      email,
      authHash: authHash.toString('base64'),
      kdfSalt: salt.toString('base64'),
      kdfParams: FAST_KDF
    },
    vaultKey,
    password
  };
}

module.exports = { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF, query };