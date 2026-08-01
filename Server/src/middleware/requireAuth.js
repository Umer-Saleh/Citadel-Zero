const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verifies the bearer token and attaches the authenticated user's id.
 *
 * The id comes from the signed token only — never from the request body
 * or query — so a client cannot choose whose vault it operates on.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'NO_TOKEN' });
  }

  try {
    req.userId = jwt.verify(token, config.JWT_SECRET).sub;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

module.exports = { requireAuth };