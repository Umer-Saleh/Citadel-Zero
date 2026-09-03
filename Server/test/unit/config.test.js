const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

/**
 * Configuration defaults and coercion.
 *
 * SIGNUP_RATE_LIMIT_MAX is the reason this file exists. It cannot be
 * set from .env.prod on the deployed instance — docker-compose.prod.yml
 * passes environment through an explicit `environment:` map with no
 * `env_file:`, so a variable it does not name never reaches the
 * container. Production therefore runs the DEFAULT, and the default is
 * the value that governs how many demo vaults an address may create.
 * A silent change to it would change the deployment with nothing to
 * catch it, so it is pinned here.
 *
 * config/index.js reads process.env once at module load and calls
 * process.exit(1) on invalid input, so each case reloads the module
 * with a fresh environment rather than mutating a parsed object.
 */
const CONFIG_PATH = require.resolve('../../src/config');

function loadConfig(overrides) {
  const saved = process.env;

  // A complete, valid environment. Anything omitted here would fall to
  // a default and make the assertion below prove less than it looks.
  process.env = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    ...overrides
  };

  // dotenv is a no-op on an already-set key, but the cache is not:
  // without this the second call returns the first call's object.
  delete require.cache[CONFIG_PATH];

  try {
    return require('../../src/config');
  } finally {
    process.env = saved;
    delete require.cache[CONFIG_PATH];
  }
}

test('SIGNUP_RATE_LIMIT_MAX defaults to 20 when unset', () => {
  const config = loadConfig({});

  // Twenty demo vaults per address per window. Not a round number
  // chosen for looking tidy: signup costs exactly one request from its
  // own bucket, so this figure IS the provisions-per-address ceiling.
  assert.strictEqual(config.SIGNUP_RATE_LIMIT_MAX, 20);
});

test('SIGNUP_RATE_LIMIT_MAX coerces the string an environment supplies', () => {
  // Every value in process.env is a string. Without z.coerce this
  // would be '35' and express-rate-limit would compare a count
  // against a string.
  const config = loadConfig({ SIGNUP_RATE_LIMIT_MAX: '35' });

  assert.strictEqual(config.SIGNUP_RATE_LIMIT_MAX, 35);
  assert.strictEqual(typeof config.SIGNUP_RATE_LIMIT_MAX, 'number');
});

test('the signup limit is independent of the auth limit', () => {
  // The whole point of the split. Setting one must not move the other,
  // which is what sharing a single counter effectively did.
  const config = loadConfig({ AUTH_RATE_LIMIT_MAX: '6' });

  assert.strictEqual(config.AUTH_RATE_LIMIT_MAX, 6);
  assert.strictEqual(config.SIGNUP_RATE_LIMIT_MAX, 20);
});

test('the existing rate-limit defaults are unchanged by the split', () => {
  // A regression guard, not a restatement. These three were already
  // the deployed defaults; adding a fourth limit must not disturb them.
  const config = loadConfig({});

  assert.strictEqual(config.AUTH_RATE_LIMIT_MAX, 10);
  assert.strictEqual(config.API_RATE_LIMIT_MAX, 300);
  assert.strictEqual(config.RATE_LIMIT_WINDOW_MINUTES, 15);
});
