const argon2 = require('argon2');

/**
 * Server-side re-hash of the client's auth hash.
 *
 * Without this, a stolen auth_hash column would be password-equivalent:
 * an attacker could replay a stored value straight to the login endpoint.
 * The cost is lower than the client-side KDF because the input is already
 * a 256-bit uniformly random value, not a guessable password.
 */
async function serverStoreAuth(authHash) {
  return argon2.hash(authHash, { type: argon2.argon2id });
}

async function serverVerifyAuth(authHash, storedAuth) {
  return argon2.verify(storedAuth, authHash);
}

module.exports = { serverStoreAuth, serverVerifyAuth };