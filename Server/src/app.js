const express = require('express');
const helmet = require('helmet');

const authService = require('./services/authService');
const vaultService = require('./services/vaultService');
const { AppError } = require('./errors/AppError');

const { requireAuth } = require('./middleware/requireAuth');
const { authLimiter, apiLimiter } = require('./middleware/rateLimit');
const { validate } = require('./middleware/validate');
const {
  signupSchema, loginSchema, kdfParamsQuerySchema,
  vaultItemSchema, uuidParamSchema, upgradeKdfSchema, wrappedDekSchema, changePasswordSchema,
  recoveryMaterialQuerySchema, recoverSchema, refreshSchema, logoutSchema, totpConfirmSchema, totpDisableSchema,
  regenerateKitSchema
} = require('./routes/schemas');

const cors = require('cors');
const config = require('./config');

const accountService = require('./services/accountService');
  
const app = express();

// ---------------------------------------------------------------
// GLOBAL MIDDLEWARE
// Order matters: security headers first, then body parsing,
// then rate limiting before any route work happens.
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// PROXY TRUST
// Behind a reverse proxy, req.ip is the PROXY's address unless this
// is set — so express-rate-limit sees a single client for the whole
// internet and every visitor shares one bucket. With a 10-request
// auth limit that is a self-inflicted denial of service, not a
// hardening measure.
//
// Unset when the process is exposed directly, which is what local
// development does, so nothing changes there.
// ---------------------------------------------------------------
if (config.TRUST_PROXY !== undefined) {
  app.set('trust proxy', config.TRUST_PROXY);
}

app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true
}));

app.use(helmet());
app.use(express.json({ limit: '64kb' }));

app.use('/api/', apiLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/user/kdf-params', authLimiter);   // also an enumeration oracle
app.use('/api/account/password', authLimiter);
app.use('/api/account/recovery-material', authLimiter);
app.use('/api/account/recover', authLimiter);
app.use('/api/account/kdf-upgrade', authLimiter);
app.use('/api/account/totp/confirm', authLimiter);
app.use('/api/account/totp/disable', authLimiter);
app.use('/api/account/recovery-kit', authLimiter);

// ---------------------------------------------------------------
// ASYNC WRAPPER
// Forwards rejected promises to the error handler. Without this,
// an async route that throws hangs the request on Express 4.
// ---------------------------------------------------------------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

  console.log(`[server] registered user ${user.id}`);
  res.status(201).json({ ok: true });
}));

app.get('/api/user/kdf-params',
  validate(kdfParamsQuerySchema, 'query'),
  wrap(async (req, res) => {
    res.status(200).json(await authService.getKdfParams(req.validated.query.email));
  }));

app.post('/api/auth/login', validate(loginSchema), wrap(async (req, res) => {
  const { userId, token, refreshToken, refreshExpiresAt,
          wrappedDek, kdfUpgradeAvailable, targetKdfParams } =
    await authService.login(req.body);

  console.log(`[server] login success for user ${userId}`);

  // Named explicitly rather than spread: the service result also
  // carries userId and email, and a route should decide what goes
  // over the wire rather than forwarding whatever a service happens
  // to return today.
  res.status(200).json({
    ok: true,
    token, refreshToken, refreshExpiresAt,
    wrappedDek, kdfUpgradeAvailable, targetKdfParams
  });
}));

// Rate limit the refresh endpoint too — it's unauthenticated and hits
// the database on every call.

app.post('/api/auth/refresh',
  validate(refreshSchema),
  wrap(async (req, res) => {
    // No requireAuth. The whole point is to be usable when the access
    // token has already expired — the refresh token IS the credential
    // being presented here.
    const session = await authService.refresh(req.body.refreshToken);
    res.status(200).json(session);
  }));

app.post('/api/auth/logout',
  validate(logoutSchema),
  wrap(async (req, res) => {
    // Also no requireAuth, and always 204 whether or not the token
    // was real. Logout must work with an expired access token, and a
    // different response for an unknown token would confirm to an
    // attacker that a token they hold was once genuine.
    await authService.logout(req.body.refreshToken);
    res.status(204).end();
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
// ACCOUNT ROUTES
// Password change is authenticated and re-wraps the DEK under a new
// KEK. Recovery is deliberately NOT authenticated: the user has
// forgotten their password and cannot log in. Possession of the
// recovery key is proved implicitly, since only a client that
// unwrapped the real DEK can produce a valid new wrapper — someone
// without it can lock the account out but learns nothing.
// ---------------------------------------------------------------

app.post('/api/account/password',
  requireAuth,
  validate(changePasswordSchema),
  wrap(async (req, res) => {
    await accountService.changePassword(req.userId, req.body);
    res.status(200).json({ ok: true });
  }));

app.get('/api/account/recovery-material',
  validate(recoveryMaterialQuerySchema, 'query'),
  wrap(async (req, res) => {
    res.status(200).json(
      await accountService.getRecoveryMaterial(req.validated.query.email)
    );
  }));

app.post('/api/account/recover',
  validate(recoverSchema),
  wrap(async (req, res) => {
    await accountService.completeRecovery(req.body);
    res.status(200).json({ ok: true });
  }));

app.post('/api/account/kdf-upgrade',
  requireAuth,
  validate(upgradeKdfSchema),
  wrap(async (req, res) => {
    await accountService.upgradeKdf(req.userId, req.body);
    res.status(200).json({ ok: true });
  }));

app.post('/api/account/totp/begin',
  requireAuth,
  wrap(async (req, res) => {
    res.status(200).json(await authService.beginTotpEnrolment(req.userId));
  }));

app.post('/api/account/totp/confirm',
  requireAuth,
  validate(totpConfirmSchema),
  wrap(async (req, res) => {
    res.status(200).json(await authService.confirmTotpEnrolment(req.userId, req.body.code));
  }));

app.post('/api/account/totp/disable',
  requireAuth,
  validate(totpDisableSchema),
  wrap(async (req, res) => {
    await authService.disableTotp(req.userId, req.body.code);
    res.status(204).end();
  }));

app.post('/api/account/recovery-kit',
  requireAuth,
  validate(regenerateKitSchema),
  wrap(async (req, res) => {
    await accountService.regenerateRecoveryKit(req.userId, req.body);
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