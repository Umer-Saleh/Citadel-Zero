#!/usr/bin/env node
/**
 * Seed the public demo account.
 *
 * ---------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT
 * ---------------------------------------------------------------
 *
 * This script is a CLIENT. It speaks HTTP to the public API and does
 * every piece of crypto itself, exactly as the browser does:
 *
 *   master password
 *     -> Argon2id (per-account salt, current default parameters)
 *     -> HKDF "auth"  -> authHash, which is all the server ever sees
 *     -> HKDF "kek"   -> KEK, which never leaves this process
 *   DEK = 32 random bytes, wrapped under the KEK and again under a
 *   recovery KEK, and used to AES-256-GCM every vault item after
 *   padding it into a bucket.
 *
 * It does NOT open a database connection, import a service or a
 * repository, insert a row, or hand the server anything it could
 * decrypt. Every byte it sends is a byte a browser would have sent.
 * The server's view of the demo account is indistinguishable from its
 * view of an account somebody created by hand.
 *
 * That is possible only because this repository already carries the
 * same crypto twice — Node here, WebCrypto plus hash-wasm in the
 * browser — verified byte for byte against shared test vectors. The
 * vectors are what make "client-equivalent" a checkable claim rather
 * than a hopeful one. If they ever diverge, this script produces a
 * vault the browser cannot open, and the demo breaks loudly instead
 * of silently storing something the model does not describe.
 *
 * The one real cost, stated plainly: the demo account's master
 * password is published, so THAT account has no confidentiality. It
 * is a throwaway holding invented data. No other account is affected,
 * and nothing about the key hierarchy changes to make this work.
 *
 * ---------------------------------------------------------------
 *   DEMO_EMAIL, DEMO_PASSWORD   required
 *   API_URL                     default http://server:3000
 * ---------------------------------------------------------------
 */

// Crypto only. Importing anything from ../src/services or
// ../src/repositories here would defeat the entire point of the
// script, which is that it holds no server privilege whatsoever.
const {
  deriveKeys, generateSalt, generateDEK, wrapDEK, encryptItem,
  generateRecoveryKey, deriveRecoveryKek, DEFAULT_KDF_PARAMS
} = require('../src/crypto');

const API_URL = (process.env.API_URL || 'http://server:3000').replace(/\/$/, '');
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;

const b64 = (buf) => Buffer.from(buf).toString('base64');

/**
 * Five invented entries.
 *
 * Chosen to make the vault UI show something real: a range of
 * password strengths so the health meter is not a flat 100%, one
 * entry with long notes so the padding buckets visibly differ when a
 * reviewer queries the table, and nothing resembling a real service
 * account.
 */
const DEMO_ITEMS = [
  {
    site: 'GitHub',
    username: 'demo-reviewer',
    password: 'X7#mQv2$Ld9pRt4Wz!Kn',
    url: 'https://github.com',
    notes: ''
  },
  {
    site: 'Northwind Bank',
    username: 'demo.reviewer@example.com',
    password: 'correct-horse-battery-staple-97',
    url: 'https://example-bank.invalid',
    notes: 'Security questions are answered with generated nonsense, stored below.\n\nFirst pet: qv7-tamarind-loop\nFirst school: 44-brass-kettle-hz\n\nThis note exists so at least one item lands in a larger padding bucket than the rest — compare the ciphertext lengths in the vault_items table and you can see the bucketing at work.'
  },
  {
    site: 'Streamly',
    username: 'demo-reviewer',
    password: 'summer2024',
    url: 'https://example-streaming.invalid',
    notes: 'Deliberately weak, so the strength meter and the vault health readout have something to complain about.'
  },
  {
    site: 'Acme Corp SSO',
    username: 'u.reviewer',
    password: 'Tz8!vQ3wLm6@Yb1nHs5#',
    url: 'https://sso.example-corp.invalid',
    notes: 'Rotates every 90 days.'
  },
  {
    site: 'Parcel Tracker',
    username: 'demo-reviewer',
    password: 'summer2024',
    url: 'https://example-parcels.invalid',
    notes: 'Reuses the Streamly password on purpose, so the reused-password warning has something to find.'
  }
];

async function call(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { /* non-JSON */ } }

  return { status: res.status, data };
}

/** Wait for the API to answer, since compose ordering is not enough. */
async function waitForApi(attempts = 60) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const { status } = await call('GET', '/api/health');
      if (status === 200) return;
    } catch { /* not up yet */ }

    if (i === attempts) throw new Error(`API never became healthy at ${API_URL}`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('[seed] DEMO_EMAIL and DEMO_PASSWORD must both be set');
    process.exit(1);
  }

  console.log(`[seed] waiting for ${API_URL}`);
  await waitForApi();

  // ---- signup: everything below happens before a single byte moves
  const kdfSalt = generateSalt();
  const { authHash, kek } = await deriveKeys(PASSWORD, kdfSalt, DEFAULT_KDF_PARAMS);

  const dek = generateDEK();

  const recoveryKey = generateRecoveryKey();
  const recoverySalt = generateSalt();
  const recoveryKek = await deriveRecoveryKek(recoveryKey, recoverySalt);

  const signup = await call('POST', '/api/auth/signup', {
    email: EMAIL,
    authHash: b64(authHash),
    kdfSalt: b64(kdfSalt),
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedDek: wrapDEK(dek, kek),
    recoverySalt: b64(recoverySalt),
    recoveryWrappedDek: wrapDEK(dek, recoveryKek)
  });

  if (signup.status === 409 || signup.data?.error === 'EMAIL_TAKEN') {
    // Already seeded. Re-running must be harmless, because compose
    // runs this on every `up` and the wipe job runs it nightly.
    //
    // Nothing here can adopt the existing account: its DEK is sealed
    // under a KEK derived from the password, and while this script
    // holds that password, re-seeding items into a vault it did not
    // create would mean unwrapping and re-encrypting for no reason.
    // Skipping is correct — the wipe job deletes the account first.
    console.log('[seed] demo account already exists — nothing to do');
    return;
  }

  if (signup.status !== 201) {
    throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.data)}`);
  }

  console.log(`[seed] created ${EMAIL}`);

  // The recovery key is normally shown once and never recoverable.
  // Printing it here is safe only because this account's password is
  // already public; it lets the deployer exercise the recovery flow.
  console.log(`[seed] demo recovery key: ${recoveryKey}`);

  // ---- log in, exactly as the browser would
  const login = await call('POST', '/api/auth/login', {
    email: EMAIL,
    authHash: b64(authHash)
  });

  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.data)}`);
  }

  // ---- vault items, encrypted here, ciphertext sent
  for (const item of DEMO_ITEMS) {
    const blob = encryptItem(item, dek);
    const res = await call('POST', '/api/vault', blob, login.data.token);

    if (res.status !== 201) {
      throw new Error(`vault insert failed for ${item.site}: ${res.status} ${JSON.stringify(res.data)}`);
    }

    console.log(`[seed] stored ${item.site} (${blob.ciphertext.length} b64 chars of ciphertext)`);
  }

  // Drop the session. Leaving a live refresh token for a published
  // account in a log or a container layer is pointless risk.
  await call('POST', '/api/auth/logout', { refreshToken: login.data.refreshToken });

  console.log(`[seed] done — ${DEMO_ITEMS.length} items`);
}

main().catch(err => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});
