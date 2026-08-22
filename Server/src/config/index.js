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

module.exports = config;