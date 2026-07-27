const crypto = require('crypto');
const argon2 = require('argon2');

async function main() {
  const masterPassword = 'correct horse battery staple';

  // The salt: 16 random bytes, unique per user, NOT secret (chapter 2)
  const salt = crypto.randomBytes(16);
  console.log('Salt (hex):', salt.toString('hex'));

  // Derive the master key with Argon2id (chapter 3)
  const start = Date.now();
  const masterKey = await argon2.hash(masterPassword, {
    type: argon2.argon2id,
    salt: salt,
    memoryCost: 131072,   // 128 MiB  -> the "m" parameter
    timeCost: 2,         // 2 passes -> the "t" parameter
    parallelism: 1,      // 1 thread -> the "p" parameter
    hashLength: 32,      // 32 bytes = 256-bit key
    raw: true            // give us raw key bytes, not an encoded string
  });
  const elapsed = Date.now() - start;

  console.log('Master key (hex):', masterKey.toString('hex'));
  console.log('Key length:', masterKey.length, 'bytes');
  console.log('Took:', elapsed, 'ms');
}

main();