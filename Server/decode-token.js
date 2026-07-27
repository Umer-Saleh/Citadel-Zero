const token = process.argv[2];

if (!token) {
  console.log('Usage: node decode-token.js <token>');
  process.exit(1);
}

const [header, payload, signature] = token.split('.');

console.log('\nHEADER (decoded):');
console.log(JSON.parse(Buffer.from(header, 'base64url').toString()));

console.log('\nPAYLOAD (decoded):');
const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
console.log(claims);

console.log('\nissued  :', new Date(claims.iat * 1000).toISOString());
console.log('expires :', new Date(claims.exp * 1000).toISOString());

console.log('\nSIGNATURE (still gibberish — needs the secret to verify):');
console.log(signature);