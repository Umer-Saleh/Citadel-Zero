const { clientSignup, clientLogin, serverStoreAuth, serverVerifyAuth } = require('./src/auth');
const { encryptItem, decryptItem } = require('./src/crypto');

const fakeDatabase = {};   // pretend Postgres

async function main() {
  const email = 'me@example.com';
  const password = 'correct horse battery staple';

  // ===== SIGNUP =====
  console.log('--- SIGNUP ---');
  const signup = await clientSignup(email, password);
  console.log('Sent to server:', signup.payload);

  fakeDatabase[email] = {
    kdfSalt: signup.payload.kdfSalt,
    kdfParams: signup.payload.kdfParams,
    storedAuth: await serverStoreAuth(signup.payload.authHash),
    items: []
  };

  // Save an item using the vault key from signup
  fakeDatabase[email].items.push(
    encryptItem({ site: 'github.com', password: 'hunter2' }, signup.vaultKey)
  );

  console.log('\nDatabase now holds:');
  console.log(JSON.stringify(fakeDatabase, null, 2));

  // ===== LOGIN (new session, vault key is gone) =====
  console.log('\n--- LOGIN ---');
  const user = fakeDatabase[email];
  const login = await clientLogin(password, user.kdfSalt, user.kdfParams);
  const ok = await serverVerifyAuth(login.payload.authHash, user.storedAuth);
  console.log('Server says authenticated:', ok);

  const item = decryptItem(user.items[0], login.vaultKey);
  console.log('Decrypted after fresh login:', item);

  // ===== WRONG PASSWORD =====
  console.log('\n--- WRONG PASSWORD ---');
  const bad = await clientLogin('wrong password', user.kdfSalt, user.kdfParams);
  console.log('Server says authenticated:', 
    await serverVerifyAuth(bad.payload.authHash, user.storedAuth));
}

main();