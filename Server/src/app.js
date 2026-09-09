const express = require('express');
const helmet = require('helmet');

const authService = require('./services/authService');
const vaultService = require('./services/vaultService');
const { AppError } = require('./errors/AppError');

const { requireAuth } = require('./middleware/requireAuth');
const { authLimiter, apiLimiter, signupLimiter } = require('./middleware/rateLimit');
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
const demoService = require('./services/demoService');
  
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

// ---------------------------------------------------------------
// 96 KB, AND THE 96 IS DERIVED — DO NOT ROUND IT BACK TO 64.
//
// A vault item is padded into a fixed-size bucket before it is
// encrypted (crypto/padding.js, BUCKETS) and base64 costs four bytes
// for every three. So the largest bucket, 65536, travels as 87,384
// characters inside an 81-character JSON envelope: 87,465 bytes.
// Under the old 64 KB limit (65,536) the client could PRODUCE that
// body and never send it — an entry whose padded size crossed 32768
// was refused with a 413 however far under 64 KB the entry itself
// looked, because the buckets step 16384 -> 32768 -> 65536 with
// nothing in between. Measured on this stack: 32,764 bytes of
// serialised item saved, 32,765 did not.
//
// 96 KB (98,304) is the smallest round value that carries 87,465.
// Raising it costs bytes on disk and in memory, and every figure that
// depends on it moved with it — see services/vaultService.js, whose
// per-account and per-day arithmetic is built on this number, and
// routes/schemas.js, whose 100,000-character backstop now sits much
// closer to this ceiling than it did.
//
// This does NOT make every bucket carryable. bucketFor rounds sizes
// past 65536 up to multiples of it, and the next one, 131072, would
// travel as 174,845 bytes — beyond any body limit worth setting. The
// padder is unbounded and the transport cannot be; bounding the entry
// before it is padded is a separate piece.
// ---------------------------------------------------------------
app.use(express.json({ limit: '96kb' }));

app.use('/api/', apiLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/login', authLimiter);
// Its own bucket, not authLimiter. Account creation and credential
// guessing want different limits, and sharing one counter meant the
// tighter of the two governed both. Every other route below is
// unchanged.
app.use('/api/auth/signup', signupLimiter);
app.use('/api/user/kdf-params', authLimiter);   // also an enumeration oracle
app.use('/api/account/password', authLimiter);
app.use('/api/account/recovery-material', authLimiter);
app.use('/api/account/recover', authLimiter);
app.use('/api/account/kdf-upgrade', authLimiter);
// The enrolment trio shares one budget. confirm and disable are here
// because they VERIFY a code and are therefore guessing surfaces;
// begin is not, and was left off for that reason. It is still the odd
// one out of three routes that otherwise move the same credential, and
// it writes a fresh secret to the user's row on every call — so it
// joins them rather than staying an exception someone has to remember.
app.use('/api/account/totp/begin', authLimiter);
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
  const { userId, email, token, refreshToken, refreshExpiresAt,
          wrappedDek, kdfUpgradeAvailable, targetKdfParams } =
    await authService.login(req.body);

  console.log(`[server] login success for user ${userId}`);

  // Named explicitly rather than spread: the service result also
  // carries userId, and a route should decide what goes over the wire
  // rather than forwarding whatever a service happens to return today.
  //
  // `email` is the address AS STORED, which is not necessarily the one
  // the client just sent — lookups fold case, so signing in as
  // reviewer@example.com finds an account created as
  // Reviewer@Example.com. Returning it lets the client stop echoing
  // the typed string back to itself and show what the server actually
  // holds. It discloses nothing: the caller has just proved they hold
  // this account's password.
  res.status(200).json({
    ok: true,
    email,
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
// forgotten their password and has nothing left to authenticate
// with. It is still VERIFIED — the caller proves possession of the
// recovery key with a value derived from it under a separate HKDF
// label, checked before anything is written. Unauthenticated is not
// the same as unverified; treating them as the same is what once let
// anyone knowing an email address destroy that account.
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
// DEMO ROUTES
// Mounted only when DEMO_MODE is on, so they do not exist at all in a
// normal deployment — not "exist but refuse", do not exist.
//
// This one serves the caller's own stored rows so the UI can show
// them beside the plaintext it decrypted. requireAuth, and scoped to
// req.userId from the verified token: the same ownership rule the
// vault routes use, and no parameter names an account.
//
// It used to be pinned to one id resolved from DEMO_EMAIL, which was
// a stronger property than this. That pin depended on a single shared
// demo account, which per-visitor vaults deliberately remove. See
// services/demoService.js — the tradeoff is written out there rather
// than glossed here.
// ---------------------------------------------------------------
if (config.demoMode) {
  app.get('/api/demo/stored-material',
    requireAuth,
    wrap(async (req, res) => {
      res.status(200).json(await demoService.storedMaterial(req.userId));
    }));
}

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

/**
 * Failures raised by express.json before any route runs.
 *
 * These are NOT AppErrors, so they used to fall past the check below
 * and be reported as INTERNAL_ERROR — the server telling a caller it
 * had broken when the caller had sent something it could not accept.
 * All four were verified against the running server; each returned
 * 500 before this map existed:
 *
 *   entity.too.large      a body over the 96 KB limit        -> 413
 *   entity.parse.failed   malformed JSON, or bytes that are
 *                         not JSON in the declared charset    -> 400
 *   encoding.unsupported  an unknown Content-Encoding         -> 415
 *   charset.unsupported   an unknown charset                  -> 415
 *
 * Keyed on err.type rather than err.status, and closed rather than
 * generic. A rule like "any exposed 4xx" would cover more, but the
 * code it emitted would have to be derived from an unbounded set of
 * strings — and a code the client has no copy for is the exact problem
 * the shared error map exists to remove. Anything not listed here is
 * genuinely unexpected, and 500 is the honest answer for it.
 *
 * Only the code is sent. These errors carry a `body` property holding
 * the offending payload, which must never be echoed back.
 */
const BODY_ERRORS = {
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', status: 413 },
  'entity.parse.failed': { code: 'MALFORMED_JSON', status: 400 },
  'encoding.unsupported': { code: 'UNSUPPORTED_ENCODING', status: 415 },
  'charset.unsupported': { code: 'UNSUPPORTED_ENCODING', status: 415 }
};

app.use((err, req, res, next) => {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({ error: err.code });
  }

  const body = BODY_ERRORS[err?.type];
  if (body) {
    // Not logged as unhandled: this is a caller sending something
    // invalid, which is ordinary, not a defect in this process.
    return res.status(body.status).json({ error: body.code });
  }

  console.error('[server] unhandled:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

module.exports = app;