const { z } = require('zod');

// A 32-byte value encodes to exactly 44 base64 characters;
// a 16-byte salt to 24. Exact lengths reject malformed input
// at the door rather than deep inside the crypto layer.
const base64 = (bytes) => {
  const chars = Math.ceil(bytes / 3) * 4;
  return z.string().length(chars).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'not valid base64');
};

// Enforced SERVER-side. The client proposes its KDF cost, but a
// malicious client must not be able to register itself with a
// work factor low enough to be trivially cracked.
const kdfParams = z.object({
  m: z.number().int().min(19456, 'memory cost below the OWASP floor'),
  t: z.number().int().min(2, 'time cost below the OWASP floor'),
  p: z.number().int().min(1).max(4)
}).strict();

// The DEK encrypted under the password-derived KEK. The server
// stores these three values and can never unwrap them.
const wrappedDekSchema = z.object({
  ciphertext: base64(32),   // the DEK itself; the GCM tag is stored separately
  nonce: base64(12),
  authTag: base64(16)
}).strict();

const signupSchema = z.object({
  email: z.string().email().max(254),
  authHash: base64(32),
  kdfSalt: base64(16),
  kdfParams,
  wrappedDek: wrappedDekSchema,
  recoverySalt: base64(16),
  recoveryWrappedDek: wrappedDekSchema
}).strict();

// Six digits for TOTP, or a 10-char hex backup code. One field, two
// shapes: the server tries it as a TOTP code first and falls back to
// a backup code, so the client doesn't have to know which it holds.
const totpCodeField = z.string().regex(/^(\d{6}|[0-9a-fA-F]{10})$/, 'invalid code format');

const totpConfirmSchema = z.object({ code: totpCodeField }).strict();
const totpDisableSchema = z.object({ code: totpCodeField }).strict();


const loginSchema = z.object({
  email: z.string().email().max(254),
  authHash: base64(32),
  // Optional: only accounts with 2FA on need it. The server decides
  // whether it was required, not the client.
  totpCode: totpCodeField.optional()
}).strict();

const kdfParamsQuerySchema = z.object({
  email: z.string().email().max(254)
}).strict();

// Ciphertext length is capped to bound how much a single item can
// occupy. This is far beyond any realistic vault entry.
const vaultItemSchema = z.object({
  ciphertext: z.string().min(1).max(100_000),
  nonce: base64(12),
  authTag: base64(16)
}).strict();

const uuidParamSchema = z.object({
  id: z.string().uuid()
});

const changePasswordSchema = z.object({
  currentAuthHash: base64(32),
  newAuthHash: base64(32),
  newKdfSalt: base64(16),
  newKdfParams: kdfParams,
  newWrappedDek: wrappedDekSchema
}).strict();

const recoveryMaterialQuerySchema = z.object({
  email: z.string().email().max(254)
}).strict();

// Recovery replaces the password-derived wrapper with a new one.
// The client proves possession of the recovery key by successfully
// unwrapping the DEK — the server never sees the recovery key itself.
const recoverSchema = z.object({
  email: z.string().email().max(254),
  newAuthHash: base64(32),
  newKdfSalt: base64(16),
  newKdfParams: kdfParams,
  newWrappedDek: wrappedDekSchema,
  newRecoverySalt: base64(16),
  newRecoveryWrappedDek: wrappedDekSchema
}).strict();

const upgradeKdfSchema = z.object({
  currentAuthHash: base64(32),
  newAuthHash: base64(32),
  newKdfSalt: base64(16),
  newKdfParams: kdfParams,
  newWrappedDek: wrappedDekSchema
}).strict();

// The refresh token is 32 random bytes as base64url — 43 chars, no
// padding. Pinning the length and alphabet means a malformed token is
// rejected by validation before it ever reaches a database query.
const refreshSchema = z.object({
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'malformed refresh token')
}).strict();

// Same shape, separate name: logout and refresh mean different things
// and shouldn't share a schema just because they look alike today.
const logoutSchema = refreshSchema;

module.exports = {
  signupSchema,
  loginSchema,
  kdfParamsQuerySchema,
  vaultItemSchema,
  uuidParamSchema,
  wrappedDekSchema,
  changePasswordSchema,
  recoveryMaterialQuerySchema,
  recoverSchema,
  upgradeKdfSchema,
  refreshSchema,
  logoutSchema,
  totpCodeField,
  totpConfirmSchema,
  totpDisableSchema
};