const crypto = require('crypto');

const TOKEN_BYTES = 32;

/**
 * Refresh tokens.
 *
 * The token is 32 bytes of CSPRNG output, sent to the client as
 * base64url. Only its SHA-256 is stored, never the token itself —
 * a database leak must not hand an attacker live sessions.
 *
 * SHA-256 rather than Argon2id here, deliberately. Argon2 exists to
 * slow down guessing of low-entropy secrets like master passwords.
 * A refresh token has 256 bits of entropy and there is nothing to
 * guess, so the only thing a slow hash would buy is a slow endpoint
 * on a path the client hits constantly.
 */

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Compare in constant time.
 *
 * We look tokens up BY hash, so this isn't on the main path — but
 * anywhere two secrets are compared, `===` leaks how many leading
 * characters matched through timing. Use this if you ever compare
 * a token or hash directly.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself be
  // a leak — so check length first and return early, since the
  // length of a hash isn't secret.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { generateToken, hashToken, safeEqual, TOKEN_BYTES };