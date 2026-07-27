const { clientSignup, clientLogin } = require('./src/auth');
const { encryptItem, decryptItem } = require('./src/crypto');

const BASE = 'http://localhost:3000';

async function request(method, path, { body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: res.status, data: await res.json() };
}

async function main() {
  const email = 'me@example.com';
  const password = 'correct horse battery staple';

  // ============ SIGNUP ============
  console.log('=== SIGNUP ===');
  const signup = await clientSignup(email, password);
  console.log('[client] sending:', signup.payload);

  const signupRes = await request('POST', '/api/auth/signup', { body: signup.payload });
  console.log('[client] response:', signupRes);

  // ============ LOGIN ============
  // Fresh session: the vault key from signup is deliberately forgotten.
  console.log('\n=== LOGIN ===');
  const params = await request('GET', `/api/user/kdf-params?email=${encodeURIComponent(email)}`);
  console.log('[client] fetched salt:', params.data.kdfSalt);

  const login = await clientLogin(password, params.data.kdfSalt, params.data.kdfParams);
  const loginRes = await request('POST', '/api/auth/login', {
    body: { email, authHash: login.payload.authHash }
  });

  console.log('[client] status:', loginRes.status);
  console.log('[client] token:', loginRes.data.token);

  const token = loginRes.data.token;
  const vaultKey = login.vaultKey;   // stays in memory, never sent

  // ============ SAVE AN ITEM ============
  console.log('\n=== SAVE ITEM ===');
  const secret = { site: 'github.com', username: 'me@example.com', password: 'hunter2' };
  const blob = encryptItem(secret, vaultKey);

  console.log('[client] plaintext :', secret);
  console.log('[client] sending   :', blob);

  const saved = await request('POST', '/api/vault', { body: blob, token });
  console.log('[client] saved as  :', saved.data.id);

  // ============ FETCH AND DECRYPT ============
  console.log('\n=== FETCH VAULT ===');
  const vault = await request('GET', '/api/vault', { token });
  const item = vault.data.items[0];

  console.log('[client] server returned :', item);
  console.log('[client] decrypted locally:', decryptItem(item, vaultKey));

  // ============ UPDATE ============
  console.log('\n=== UPDATE ITEM ===');
  const updated = encryptItem({ ...secret, password: 'new-password-456' }, vaultKey);
  await request('PUT', `/api/vault/${item.id}`, { body: updated, token });

  const after = await request('GET', '/api/vault', { token });
  console.log('[client] decrypted:', decryptItem(after.data.items[0], vaultKey));

  // ============ NEGATIVE TESTS ============
  console.log('\n=== NEGATIVE TESTS ===');

  const noToken = await request('GET', '/api/vault');
  console.log('[client] no token        :', noToken.status, noToken.data);

  const badToken = await request('GET', '/api/vault', { token: 'garbage.token.here' });
  console.log('[client] forged token    :', badToken.status, badToken.data);

  const bad = await clientLogin('wrong password', params.data.kdfSalt, params.data.kdfParams);
  const badLogin = await request('POST', '/api/auth/login', {
    body: { email, authHash: bad.payload.authHash }
  });
  console.log('[client] wrong password  :', badLogin.status, badLogin.data);
}

main().catch(err => console.error('Client error:', err));