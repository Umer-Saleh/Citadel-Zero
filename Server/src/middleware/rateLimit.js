const rateLimit = require('express-rate-limit');
const config = require('../config');

// Disabled in tests so the suite can exercise auth endpoints freely.
// Note this leaves the limiter itself untested — a dedicated test that
// re-enables it is still needed.
const noLimit = (req, res, next) => next();

/**
 * Shared counter store.
 *
 * The default store is a Map in the process, which means counters
 * reset on every restart and are not shared between instances — so
 * anything that restarts the API also clears whatever an attacker had
 * accumulated. Redis moves them out of the process.
 *
 * Built ONLY when REDIS_URL is set. Unset falls back to the in-memory
 * store, so local development and the test suite need no extra
 * service and behave exactly as they did before.
 *
 * Each limiter gets its own KEY PREFIX, and that is load-bearing.
 * rate-limit-redis defaults every store to the prefix "rl:", so two
 * stores keyed on the same address collide on one Redis key — while
 * the in-memory default gives each limiter a separate Map and keeps
 * them apart. Without distinct prefixes the switch to Redis silently
 * merges the counters, and since apiLimiter is mounted on all of
 * /api/, a handful of ordinary vault reads spends the auth budget and
 * locks every visitor out of login. Measured, not theorised: five GETs
 * to /api/vault turned three logins into 429s.
 */
let client = null;

function redisClient() {
  if (client) return client;

  const { createClient } = require('redis');

  client = createClient({ url: config.REDIS_URL });

  // Without a listener, node-redis emits 'error' as an unhandled
  // event and takes the process down — so a Redis blip would become
  // an API outage. It reconnects on its own; this just keeps the
  // process alive while it does.
  client.on('error', (err) => {
    console.warn('[server] redis:', err.message);
  });

  // Not awaited: module load must not block on a network service.
  // Commands issued before the connection is up are queued.
  client.connect().catch(err => {
    console.warn('[server] redis connect failed:', err.message);
  });

  return client;
}

function buildStore(prefix) {
  if (!config.REDIS_URL) return undefined;   // in-memory default

  const { RedisStore } = require('rate-limit-redis');
  const c = redisClient();

  return new RedisStore({
    prefix,
    sendCommand: (...args) => c.sendCommand(args)
  });
}

const windowMs = config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;

const build = (prefix, options) => config.rateLimitEnabled
  ? rateLimit({
      standardHeaders: true,
      legacyHeaders: false,
      store: buildStore(prefix),
      ...options
    })
  : noLimit;

/** Auth endpoints trigger Argon2 work, so a cheap request costs real CPU. */
const authLimiter = build('rl:auth:', {
  windowMs,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: { error: 'TOO_MANY_ATTEMPTS' }
});

const apiLimiter = build('rl:api:', {
  windowMs,
  max: config.API_RATE_LIMIT_MAX,
  message: { error: 'TOO_MANY_REQUESTS' }
});

module.exports = { authLimiter, apiLimiter };
