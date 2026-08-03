require('./setup');

const { query, pool } = require('../../src/db');
const {
  generateSalt, deriveKeys, generateDEK, wrapDEK,
  generateRecoveryKey, deriveRecoveryKek
} = require('../../src/crypto');


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
async function makeSignupPayload(email = 'test@example.com', password = 'test-password-123', kdfParams = FAST_KDF) {
  const salt = generateSalt();
  const { authHash, kek } = await deriveKeys(password, salt, kdfParams);
  
  // The client generates a random DEK and wraps it under the KEK.
  // Only the wrapper is ever sent to the server.
  const dek = generateDEK();

  // The same DEK, wrapped a second time under a key derived from an
  // independent recovery key. Two doors, one vault.
  const recoveryKey = generateRecoveryKey();
  const recoverySalt = generateSalt();
  const recoveryKek = deriveRecoveryKek(recoveryKey, recoverySalt);

  return {
    payload: {
      email,
      authHash: authHash.toString('base64'),
      kdfSalt: salt.toString('base64'),
      kdfParams,
      wrappedDek: wrapDEK(dek, kek),
      recoverySalt: recoverySalt.toString('base64'),
      recoveryWrappedDek: wrapDEK(dek, recoveryKek)
    },
    dek,
    kek,
    recoveryKey,
    password
  };
}

module.exports = { resetDatabase, closeDatabase, makeSignupPayload, FAST_KDF, query };