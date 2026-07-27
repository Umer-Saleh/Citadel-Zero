const crypto = require('crypto');

// Pretend this came from the key split. Later it will.
const vaultKey = Buffer.from(
  'de371da2d42cb6fa9e0e86d1cbccc38f9ed49b0586e3bf2e35ce80c4883bd176', 'hex'
);

function encrypt(plaintext, key) {
  const nonce = crypto.randomBytes(12);              // FRESH every time
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, nonce, authTag };
}

function decrypt({ ciphertext, nonce, authTag }, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

const item = JSON.stringify({
  site: 'github.com',
  username: 'me@example.com',
  password: 'hunter2'
});

const encrypted = encrypt(item, vaultKey);

encrypted.ciphertext[0] = encrypted.ciphertext[0] ^ 1;   // flip one bit

console.log('Plaintext :', item);
console.log('Ciphertext:', encrypted.ciphertext.toString('hex'));
console.log('Nonce     :', encrypted.nonce.toString('hex'));
console.log('Auth tag  :', encrypted.authTag.toString('hex'));
console.log('Decrypted :', decrypt(encrypted, vaultKey));