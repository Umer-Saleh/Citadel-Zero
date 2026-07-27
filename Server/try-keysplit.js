const crypto = require('crypto');
const argon2 = require('argon2');

// HKDF: expand one strong key into independent sub-keys
function hkdf(masterKey, context) {
  return crypto.hkdfSync(
    'sha256',
    masterKey,          // input key material
    Buffer.alloc(0),    // salt (empty — masterKey is already strong)
    context,            // the "info" label: what this key is FOR
    32                  // 32 bytes out
  );
}

async function main() {
  const masterPassword = 'correct horse battery staple';
  const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

  const masterKey = await argon2.hash(masterPassword, {
    type: argon2.argon2id,
    salt,
    memoryCost: 131072,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
    raw: true
  });

  const authHash = Buffer.from(hkdf(masterKey, 'auth'));
  const vaultKey = Buffer.from(hkdf(masterKey, 'enc'));

  console.log('Master key:', masterKey.toString('hex'));
  console.log('Auth hash :', authHash.toString('hex'), '<- goes to server');
  console.log('Vault key :', vaultKey.toString('hex'), '<- NEVER leaves device');
}

main();