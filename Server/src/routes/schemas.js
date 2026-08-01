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

const signupSchema = z.object({
  email: z.string().email().max(254),
  authHash: base64(32),
  kdfSalt: base64(16),
  kdfParams
}).strict();

const loginSchema = z.object({
  email: z.string().email().max(254),
  authHash: base64(32)
}).strict();

const kdfParamsQuerySchema = z.object({
  email: z.string().email().max(254)
}).strict();

// Ciphertext length is capped to bound how much a single item can
// occupy. 64 KB of plaintext is far beyond any realistic entry.
const vaultItemSchema = z.object({
  ciphertext: z.string().min(1).max(100_000),
  nonce: base64(12),
  authTag: base64(16)
}).strict();

const uuidParamSchema = z.object({
  id: z.string().uuid()
});

module.exports = {
  signupSchema,
  loginSchema,
  kdfParamsQuerySchema,
  vaultItemSchema,
  uuidParamSchema
};