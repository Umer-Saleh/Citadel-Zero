const rateLimit = require('express-rate-limit');
const config = require('../config');

// Disabled in tests so the suite can exercise auth endpoints freely.
// Note this leaves the limiter itself untested — a dedicated test that
// re-enables it is still needed.
const noLimit = (req, res, next) => next();

const build = (options) => config.rateLimitEnabled
  ? rateLimit({ standardHeaders: true, legacyHeaders: false, ...options })
  : noLimit;

/** Auth endpoints trigger Argon2 work, so a cheap request costs real CPU. */
const authLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'TOO_MANY_ATTEMPTS' }
});

const apiLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'TOO_MANY_REQUESTS' }
});

module.exports = { authLimiter, apiLimiter };