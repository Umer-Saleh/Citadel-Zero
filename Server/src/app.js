const config = require('./config');

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const authService = require('./services/authService');
const vaultService = require('./services/vaultService');
const { AppError } = require('./errors/AppError');

const { validate } = require('./middleware/validate');
const { signupSchema, loginSchema, kdfParamsQuerySchema, vaultItemSchema, uuidParamSchema} = require('./routes/schemas');

const app = express();

// ---------------------------------------------------------------
// GLOBAL MIDDLEWARE
// Order matters: security headers first, then body parsing.
// ---------------------------------------------------------------
app.use(helmet());
app.use(express.json({ limit: '64kb' }));

// Rate limiting is disabled in tests so the suite can exercise
// auth endpoints freely. It stays on everywhere else.
const rateLimitEnabled = config.rateLimitEnabled;

const noLimit = (req, res, next) => next();

const apiLimiter = rateLimitEnabled ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' }
}) : noLimit;

const authLimiter = rateLimitEnabled ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS' }
}) : noLimit;

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/user/kdf-params', authLimiter);   // also an enumeration oracle

// ---------------------------------------------------------------
// ASYNC WRAPPER
// Forwards rejected promises to the error handler. Without this,
// an async route that throws hangs the request on Express 4.
// ---------------------------------------------------------------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------
// AUTH MIDDLEWARE
// The user's UUID comes from the signed token, never from the
// client's request body.
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// ---------------------------------------------------------------
// AUTH ROUTES
// Routes translate HTTP to and from service calls. They contain no
// business logic and no SQL.
// ---------------------------------------------------------------


app.post('/api/auth/signup', validate(signupSchema), wrap(async (req, res) => {
  const user = await authService.signup(req.body);

  console.log(`[server] registered ${req.body.email} as ${user.id}`);
  res.status(201).json({ ok: true });
}));

app.get('/api/user/kdf-params',
  validate(kdfParamsQuerySchema, 'query'),
  wrap(async (req, res) => {
    res.status(200).json(await authService.getKdfParams(req.validated.query.email));
  }));

app.post('/api/auth/login', validate(loginSchema), wrap(async (req, res) => {
  const { token } = await authService.login(req.body);

  console.log(`[server] login success for ${req.body.email}`);
  res.status(200).json({ ok: true, token });
}));


// ---------------------------------------------------------------
// VAULT ROUTES
// Ciphertext in, ciphertext out. Ownership is enforced in the
// service and repository layers using the token-derived userId.
// ---------------------------------------------------------------

app.get('/api/vault', requireAuth, wrap(async (req, res) => {
  res.status(200).json({ items: await vaultService.list(req.userId) });
}));

app.post('/api/vault', requireAuth, validate(vaultItemSchema), wrap(async (req, res) => {
  const item = await vaultService.create(req.userId, req.body);

  console.log(`[server] stored encrypted item ${item.id}`);
  res.status(201).json({ id: item.id });
}));

app.put('/api/vault/:id',
  requireAuth,
  validate(uuidParamSchema, 'params'),
  validate(vaultItemSchema),
  wrap(async (req, res) => {
    await vaultService.update(req.userId, req.params.id, req.body);
    res.status(200).json({ ok: true });
  }));

app.delete('/api/vault/:id',
  requireAuth,
  validate(uuidParamSchema, 'params'),
  wrap(async (req, res) => {
    await vaultService.remove(req.userId, req.params.id);
    res.status(200).json({ ok: true });
  }));

// ---------------------------------------------------------------
// 404 — anything that matched no route
// ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

// ---------------------------------------------------------------
// ERROR HANDLER
// Four parameters is what marks this as an error handler in Express.
// Operational errors carry a safe client-facing code; anything else
// is a bug, logged in full and reported as a generic 500.
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({ error: err.code });
  }

  console.error('[server] unhandled:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

module.exports = app;