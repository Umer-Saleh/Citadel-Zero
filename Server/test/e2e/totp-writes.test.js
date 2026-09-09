require('../helpers/setup');

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert');
const { TOTP, Secret } = require('otpauth');

const authService = require('../../src/services/authService');
const totpRepo = require('../../src/repositories/totpRepo');
const { resetDatabase, closeDatabase, makeSignupPayload, query } = require('../helpers/db');

test.beforeEach(resetDatabase);
test.afterEach(() => mock.restoreAll());
test.after(closeDatabase);

/**
 * The three writes that decide whether an account has a second factor.
 *
 * setSecret, enable and disable each report whether they matched a
 * row, and all three callers used to throw that away. An UPDATE that
 * changed nothing was therefore indistinguishable from one that
 * worked — on exactly the statements where "it silently did nothing"
 * means a security control reporting itself on while providing
 * nothing.
 *
 * Two layers are pinned separately, because they fail differently:
 *
 *   1. The repository really does return false when it matches no row.
 *      Without this the service's check is reading a value that is
 *      always truthy and the guard is decorative.
 *   2. The service refuses when it does. That one needs the condition
 *      forced — see the note above the last test.
 */

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function makeUser(email = 'writes@example.com') {
  const { payload } = await makeSignupPayload(email);
  const user = await authService.signup(payload);
  return user.id;
}

// ---------------------------------------------------------------
// 1. The repository contract the services now rely on.
// ---------------------------------------------------------------

test('setSecret reports false when it matches no row', async () => {
  assert.strictEqual(await totpRepo.setSecret(UNKNOWN_ID, 'AAAA'), false);
});

test('setSecret reports true when it does', async () => {
  // The positive control. Without it a repo that returned false
  // unconditionally would pass every negative test in this file.
  const id = await makeUser();
  assert.strictEqual(await totpRepo.setSecret(id, 'AAAA'), true);
});

test('enable reports false when it matches no row', async () => {
  assert.strictEqual(await totpRepo.enable(UNKNOWN_ID, 1), false);
});

test('enable reports false when the row exists but the secret is gone', async () => {
  // The condition that matters: enable is
  // `WHERE id = $2 AND totp_secret IS NOT NULL`, so a cleared secret
  // makes it match nothing even though the account is perfectly real.
  const id = await makeUser();
  assert.strictEqual(await totpRepo.enable(id, 1), false);

  const { rows } = await query('SELECT totp_enabled FROM users WHERE id = $1', [id]);
  assert.strictEqual(rows[0].totp_enabled, false, 'enable flipped the flag with no secret');
});

test('enable reports true once a secret is present', async () => {
  const id = await makeUser();
  await totpRepo.setSecret(id, 'AAAA');
  assert.strictEqual(await totpRepo.enable(id, 1), true);
});

test('disable reports false when it matches no row', async () => {
  assert.strictEqual(await totpRepo.disable(UNKNOWN_ID), false);
});

test('disable reports true when it does', async () => {
  const id = await makeUser();
  assert.strictEqual(await totpRepo.disable(id), true);
});

// ---------------------------------------------------------------
// 2. The service refuses rather than reporting success.
// ---------------------------------------------------------------

/**
 * The condition is forced, and that is the honest description.
 *
 * enable() can only match nothing if totp_secret went NULL between
 * confirm's read and its write, and the only writer of NULL is
 * disable(), which itself requires totp_enabled to already be true —
 * which confirm has just established is false. Reaching it for real
 * needs the account owner to run two confirms and a successful disable
 * concurrently, with valid codes. So this is not reachable through the
 * API, and the test says so by stubbing rather than pretending to
 * race.
 *
 * It is worth pinning anyway: the failure mode is precisely the one
 * reported on the live site — backup codes and a success screen for an
 * account whose second factor is off — and the guard is one line.
 */
test('confirm refuses when the enable write matches nothing', async () => {
  const id = await makeUser();
  const { secret } = await authService.beginTotpEnrolment(id);

  const code = new TOTP({
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(secret)
  }).generate();

  mock.method(totpRepo, 'enable', async () => false);

  await assert.rejects(
    () => authService.confirmTotpEnrolment(id, code),
    /enable matched no row/
  );

  // Still off — the caller is not told it is protected.
  const { rows } = await query('SELECT totp_enabled FROM users WHERE id = $1', [id]);
  assert.strictEqual(rows[0].totp_enabled, false);

  // And the backup codes went back with the transaction, rather than
  // being left behind for an account with no second factor.
  const codes = await query(
    'SELECT count(*)::int AS n FROM totp_backup_codes WHERE user_id = $1', [id]
  );
  assert.strictEqual(codes.rows[0].n, 0, 'backup codes survived a rolled-back enable');
});

test('confirm still succeeds when the write lands', async () => {
  // The control for the test above: the stub is what makes it fail,
  // not the surrounding setup.
  const id = await makeUser();
  const { secret } = await authService.beginTotpEnrolment(id);

  const code = new TOTP({
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(secret)
  }).generate();

  const { backupCodes } = await authService.confirmTotpEnrolment(id, code);
  assert.strictEqual(backupCodes.length, 10);

  const { rows } = await query('SELECT totp_enabled FROM users WHERE id = $1', [id]);
  assert.strictEqual(rows[0].totp_enabled, true);
});
