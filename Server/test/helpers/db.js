require('./setup');

const { query, pool } = require('../../src/db');
const { generateSalt, deriveKeys } = require('../../src/crypto');

// Must satisfy the server-side minimum enforced in routes/schemas.js.
// Tests exercise the same floor production does.
const FAST_KDF = { m: 19456, t: 2, p: 1 };

async function resetDatabase() {
  await query('TRUNCATE vault_items, users RESTART IDENTITY CASCADE');
}

async function closeDatabase() {
  await pool.end();
}

/** Build a valid signup payload plus the keys the client would keep. */
async function makeSignupPayload(email = 'test@example.com', password = 'test-password-123') {
  const salt = generateSalt();
  const { authHash, kek } = await deriveKeys(password, salt, FAST_KDF);

  return {
    payload: {
      email,
      authHash: authHash.toString('base64'),
      kdfSalt: salt.toString('base64'),
      kdfParams: FAST_KDF
    },
    kek,
    password
  };
}

module.exports = { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF, query };