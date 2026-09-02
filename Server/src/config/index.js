require('dotenv').config();

const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Number of reverse proxies in front of this process, or unset when
  // it is exposed directly. Unset is the default so local development
  // and the test suite behave exactly as they always have.
  //
  // A COUNT, deliberately, not `true`. Express's `trust proxy: true`
  // trusts the whole X-Forwarded-For chain, which a client can forge —
  // and since the rate limiter keys on the resulting IP, that would
  // let anyone mint an unlimited number of identities by prepending
  // addresses. express-rate-limit v8 refuses to start in that
  // configuration (ERR_ERL_PERMISSIVE_TRUST_PROXY) for this reason.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).optional(),

  // Redis-backed rate limiting. Unset means the in-memory store, so
  // local development and the test suite need no extra service.
  REDIS_URL: z.string().optional(),

  // Limits, tunable without a rebuild so a public demo can be
  // tightened without touching code. The defaults are the values that
  // were previously hardcoded.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // Public-demo mode. Off unless explicitly enabled, so nothing here
  // can switch itself on in a real deployment by accident.
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DEMO_EMAIL: z.string().email().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration:');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${errors.join(', ')}`);
  }
  process.exit(1);
}

const config = parsed.data;

// Rate limiting is off in tests so the suite can exercise auth
// endpoints freely.
config.rateLimitEnabled = config.RATE_LIMIT_ENABLED === 'true' && config.NODE_ENV !== 'test';

// Demo mode no longer points at an account. Each visitor provisions
// their own throwaway vault through the ordinary signup path, so
// there is no shared identity for the server to resolve.
//
// DEMO_EMAIL is therefore accepted but unused. It stays in the schema
// because docker-compose.prod.yml still passes it and .env.prod still
// declares it required; removing it there is a separate change to
// files this branch does not touch. Nothing in src/ reads it.
config.demoMode = config.DEMO_MODE === 'true';

module.exports = config;