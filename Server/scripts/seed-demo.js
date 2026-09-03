#!/usr/bin/env node
/**
 * Seeding a shared demo account — deliberately does nothing.
 *
 * ---------------------------------------------------------------
 * WHY THIS FILE STILL EXISTS
 * ---------------------------------------------------------------
 * There is no longer a shared demo account to create. Every visitor
 * provisions their own throwaway vault in the browser, through the
 * ordinary signup path, encrypted under a key the server never sees.
 * See Web/src/lib/provisionDemo.js.
 *
 * The file is kept, and kept exiting 0, because
 * docker-compose.prod.yml declares a one-shot `seed` service that runs
 * it on every deploy. Deleting the script would make that service exit
 * non-zero every time the stack comes up. Removing the service is a
 * change to a file this work is not permitted to touch, so the honest
 * option is a no-op that says why rather than a deletion that breaks
 * the deploy.
 *
 * DEMO_EMAIL and DEMO_PASSWORD are likewise still declared as required
 * by compose and still read by nothing. Retiring them is a separate,
 * separately authorised change across compose, .env.prod.example and
 * DEPLOY.md.
 *
 * ---------------------------------------------------------------
 * WHAT THE SHARED ACCOUNT COST, FOR THE RECORD
 * ---------------------------------------------------------------
 * Its credentials were printed on the unlock screen, so every visitor
 * was authenticated AS it. Any one of them could change its password
 * and stop the printed credentials working, enable TOTP and lock out
 * everyone who came afterwards, rotate its recovery kit, or edit the
 * seeded entries that the next twenty-four hours of visitors would
 * see. Blocking those routes for that one account would have worked,
 * but every account route added later would have had to remember the
 * guard. Removing the shared identity removes the problem instead of
 * maintaining a list.
 *
 * The five fixture entries this script used to encrypt now live in
 * Web/src/lib/demoFixtures.js, which is the only copy.
 */

console.log('[seed] per-visitor demo vaults: nothing to seed.');
console.log('[seed] Visitors provision their own vault client-side; there is no');
console.log('[seed] shared demo account. This service is a no-op and exits 0.');

// Explicit, so nobody has to infer it from falling off the end.
process.exit(0);
