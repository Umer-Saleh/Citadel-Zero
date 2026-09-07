require('../helpers/setup');

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../src/app');
const { closeDatabase } = require('../helpers/db');

test.after(closeDatabase);

/**
 * Failures express.json raises before any route runs.
 *
 * None of these is an AppError, so all four fell past the error
 * handler's `instanceof` check and were answered with 500
 * INTERNAL_ERROR — the server claiming it had broken when it had in
 * fact refused something specific about the request.
 *
 * No authentication anywhere below, deliberately: body parsing happens
 * before requireAuth, so these are reachable by anyone. A response of
 * NO_TOKEN would mean the body was accepted and the request got as far
 * as the auth check, which is what the last test uses it for.
 */

// The body limit is 64 KB. The JSON envelope around the ciphertext is
// 81 characters, so 65,455 is the largest ciphertext that fits and
// 65,456 is the first that does not.
const bodyOf = (ciphertextChars) => JSON.stringify({
  ciphertext: 'A'.repeat(ciphertextChars),
  nonce: 'A'.repeat(16),
  authTag: 'A'.repeat(24)
});

test('a body over the limit is 413, not 500', async () => {
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .send(bodyOf(65_456));

  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.body.error, 'PAYLOAD_TOO_LARGE');
});

test('a body exactly at the limit is accepted by the parser', async () => {
  // The other side of the boundary. Without this, a handler that
  // rejected everything large would pass the test above.
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .send(bodyOf(65_455));

  // Past the parser, refused by requireAuth — which is the proof that
  // the body itself was read successfully.
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'NO_TOKEN');
});

test('malformed JSON is 400, not 500', async () => {
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .send('{not json');

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'MALFORMED_JSON');
});

test('an unknown Content-Encoding is 415, not 500', async () => {
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .set('Content-Encoding', 'bogus')
    .send('{}');

  assert.strictEqual(res.status, 415);
  assert.strictEqual(res.body.error, 'UNSUPPORTED_ENCODING');
});

test('the offending body is never echoed back', async () => {
  // body-parser attaches the raw payload to the error as `body`. It
  // must not reach the response — the whole point of sending only a
  // code.
  const secret = 'do-not-repeat-this-value';
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .send(`{"oops": "${secret}"`);

  assert.strictEqual(res.status, 400);
  assert.strictEqual(JSON.stringify(res.body).includes(secret), false);
  assert.deepStrictEqual(Object.keys(res.body), ['error']);
});

test('a well-formed request is untouched by any of this', async () => {
  const res = await request(app)
    .post('/api/vault')
    .set('Content-Type', 'application/json')
    .send({ ciphertext: 'A', nonce: 'A', authTag: 'A' });

  // Reaches requireAuth rather than being mistaken for a body error.
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'NO_TOKEN');
});
