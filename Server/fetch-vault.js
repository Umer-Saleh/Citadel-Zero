const { clientLogin } = require('./src/auth');
const { decryptItem } = require('./src/crypto');

const BASE = 'http://localhost:3000';

async function main() {
  const email = 'me@example.com';
  const password = 'correct horse battery staple';

  // Log in from scratch — no memory of any previous session
  const paramsRes = await fetch(`${BASE}/api/user/kdf-params?email=${encodeURIComponent(email)}`);
  const { kdfSalt, kdfParams } = await paramsRes.json();

  const login = await clientLogin(password, kdfSalt, kdfParams);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, authHash: login.payload.authHash })
  });
  const { token } = await loginRes.json();

  // Fetch the vault
  const vaultRes = await fetch(`${BASE}/api/vault`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { items } = await vaultRes.json();

  console.log(`\nServer returned ${items.length} encrypted item(s):\n`);

  for (const item of items) {
    console.log('  ciphertext:', item.ciphertext.slice(0, 50) + '...');
    console.log('  decrypted :', decryptItem(item, login.vaultKey));
    console.log();
  }
}

main().catch(err => console.error('Error:', err.message));