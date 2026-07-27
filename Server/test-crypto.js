const { generateSalt, deriveKeys, encryptItem, decryptItem } = require('./src/crypto');

async function main() {
  const password = 'correct horse battery staple';
  const salt = generateSalt();

  const { authHash, vaultKey } = await deriveKeys(password, salt);
  console.log('authHash:', authHash.toString('base64'));
  console.log('vaultKey:', vaultKey.toString('base64'));

  const item = { site: 'github.com', username: 'me@example.com', password: 'hunter2' };
  const blob = encryptItem(item, vaultKey);
  console.log('\nStored blob:', blob);

  const recovered = decryptItem(blob, vaultKey);
  console.log('\nRecovered:', recovered);

  // Wrong key should fail
  const { vaultKey: wrongKey } = await deriveKeys('wrong password', salt);
  try {
    decryptItem(blob, wrongKey);
    console.log('\nPROBLEM: wrong key decrypted successfully!');
  } catch (err) {
    console.log('\nWrong key rejected, as expected.');
  }
}

main();