const argon2 = require('argon2');
const { generateSalt, deriveKeys, DEFAULT_KDF_PARAMS } = require('./crypto');

// ---------- SERVER SIDE ----------
// These functions run on the server. Note what they never touch:
// the master password, the master key, or the vault key.

async function serverStoreAuth(authHash) {
  return argon2.hash(authHash, { type: argon2.argon2id });
}

async function serverVerifyAuth(authHash, storedAuth) {
  return argon2.verify(storedAuth, authHash);
}

// ---------- CLIENT SIDE ----------

async function clientSignup(email, masterPassword) {
  const salt = generateSalt();
  const params = DEFAULT_KDF_PARAMS;
  const { authHash, vaultKey } = await deriveKeys(masterPassword, salt, params);

  return {
    // what gets sent over the network
    payload: {
      email,
      authHash: authHash.toString('base64'),
      kdfSalt: salt.toString('base64'),
      kdfParams: params
    },
    // what stays on the device
    vaultKey
  };
}

async function clientLogin(masterPassword, kdfSalt, kdfParams) {
  const salt = Buffer.from(kdfSalt, 'base64');
  const { authHash, vaultKey } = await deriveKeys(masterPassword, salt, kdfParams);

  return {
    payload: { authHash: authHash.toString('base64') },
    vaultKey
  };
}

module.exports = { serverStoreAuth, serverVerifyAuth, clientSignup, clientLogin };