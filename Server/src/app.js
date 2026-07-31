require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const { serverStoreAuth, serverVerifyAuth } = require('./auth');
const userRepo = require('./repositories/userRepo');
const vaultRepo = require('./repositories/vaultRepo');

const DUMMY_HASH = '$argon2id$v=19$m=65536,p=4,t=3$rm29g6kvVdhtbZxachGdMw$' +
                   'V8EhUOs5sbp1qvmFPFlsVFl9x6QZkIYUlpSKmdEE2HI';

const app = express();

// ---------------------------------------------------------------
// GLOBAL MIDDLEWARE
// Order matters: security headers first, then body parsing.
// ---------------------------------------------------------------
app.use(helmet());
app.use(express.json({ limit: '64kb' }));

// Rate limiting is disabled in tests so the suite can exercise
// auth endpoints freely. It stays on everywhere else.
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false'
                      && process.env.NODE_ENV !== 'test';

const noLimit = (req, res, next) => next();

const apiLimiter = rateLimitEnabled ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' }
}) : noLimit;

const authLimiter = rateLimitEnabled ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' }
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
    return res.status(401).json({ error: 'no token' });
  }

  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).sub;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

// ---------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// ---------------------------------------------------------------
// SIGNUP
// Receives an auth hash, a salt, and KDF parameters.
// Never receives the master password or any encryption key.
// ---------------------------------------------------------------
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email, authHash, kdfSalt, kdfParams } = req.body;

  if (!email || !authHash || !kdfSalt || !kdfParams) {
    return res.status(400).json({ error: 'missing fields' });
  }

  try {
    const stored = await serverStoreAuth(authHash);
    const user = await userRepo.create({ email, kdfSalt, kdfParams, authHash: stored });

    console.log(`[server] registered ${email} as ${user.id}`);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {           // unique_violation
      return res.status(409).json({ error: 'account already exists' });
    }
    throw err;                            // hand off to the error handler
  }
}));

// ---------------------------------------------------------------
// KDF PARAMS
// Public by design: the client needs the salt and cost parameters
// before it can derive anything.
// ---------------------------------------------------------------
app.get('/api/user/kdf-params', wrap(async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'missing email' });
  }

  const user = await userRepo.findByEmail(email);

  if (!user) {
    return res.status(404).json({ error: 'not found' });
  }

  res.status(200).json({ kdfSalt: user.kdf_salt, kdfParams: user.kdf_params });
}));

// ---------------------------------------------------------------
// LOGIN
// Identical 401 for unknown account and wrong password, so the
// response cannot be used to discover which emails are registered.
// ---------------------------------------------------------------
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, authHash } = req.body;

  if (!email || !authHash) {
    return res.status(400).json({ error: 'missing fields' });
  }

  const user = await userRepo.findByEmail(email);

  // Always run a verification, even for unknown accounts, so the
  // response time does not reveal whether the email is registered.
  const valid = await serverVerifyAuth(authHash, user ? user.auth_hash : DUMMY_HASH)
                      .catch(() => false);

  if (!user || !valid) {
    console.log(`[server] failed login for ${email}`);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
  console.log(`[server] login success for ${email}`);
  res.status(200).json({ ok: true, token });
}));

// ---------------------------------------------------------------
// VAULT
// Ciphertext in, ciphertext out. Every repository call is scoped
// by the user_id carried in the verified token.
// ---------------------------------------------------------------
app.get('/api/vault', requireAuth, wrap(async (req, res) => {
  const rows = await vaultRepo.listByUser(req.userId);

  res.status(200).json({
    items: rows.map(r => ({
      id: r.id,
      ciphertext: r.encrypted_data,
      nonce: r.nonce,
      authTag: r.auth_tag,
      updatedAt: r.updated_at
    }))
  });
}));

app.post('/api/vault', requireAuth, wrap(async (req, res) => {
  const { ciphertext, nonce, authTag } = req.body;

  if (!ciphertext || !nonce || !authTag) {
    return res.status(400).json({ error: 'missing fields' });
  }

  const item = await vaultRepo.create(req.userId, { ciphertext, nonce, authTag });

  console.log(`[server] stored encrypted item ${item.id}`);
  res.status(201).json({ id: item.id });
}));

app.put('/api/vault/:id', requireAuth, wrap(async (req, res) => {
  const { ciphertext, nonce, authTag } = req.body;

  if (!ciphertext || !nonce || !authTag) {
    return res.status(400).json({ error: 'missing fields' });
  }

  const updated = await vaultRepo.update(req.userId, req.params.id,
                                         { ciphertext, nonce, authTag });

  if (!updated) {
    return res.status(404).json({ error: 'not found' });
  }
  res.status(200).json({ ok: true });
}));

app.delete('/api/vault/:id', requireAuth, wrap(async (req, res) => {
  const removed = await vaultRepo.remove(req.userId, req.params.id);

  if (!removed) {
    return res.status(404).json({ error: 'not found' });
  }
  res.status(200).json({ ok: true });
}));

// ---------------------------------------------------------------
// 404 — anything that matched no route
// ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// ---------------------------------------------------------------
// CATCH-ALL ERROR HANDLER
// Four parameters is what marks this as an error handler in Express.
// Details are logged server-side; the client gets nothing useful.
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[server] unhandled:', err.message);
  res.status(500).json({ error: 'internal error' });
});

module.exports = app;