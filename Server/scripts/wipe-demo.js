#!/usr/bin/env node
/**
 * Nightly wipe and reseed for the public demo.
 *
 * Deletes every account on the instance, then recreates the demo
 * account through the ordinary client path. The banner promises this
 * happens; the promise is the reason anyone can be told not to worry
 * about what they typed into a demo.
 *
 * ---------------------------------------------------------------
 * WHY DELETE AND NOT TRUNCATE
 * ---------------------------------------------------------------
 * Every child table — vault_items, refresh_tokens, totp_backup_codes
 * — has ON DELETE CASCADE from users, so a single DELETE clears all
 * four. TRUNCATE would need a privilege citadel_app deliberately does
 * not hold, and granting it would mean the application role could
 * empty a table by accident for the rest of the deployment's life. At
 * demo scale the performance difference is nothing.
 *
 * So this runs under exactly the same least-privilege role the API
 * uses. It needs no elevation of any kind.
 *
 * ---------------------------------------------------------------
 * WHY AN ADVISORY LOCK
 * ---------------------------------------------------------------
 * A wipe that overlaps a reseed would delete the account the other
 * half just created and leave the demo empty until the next night.
 * The lock makes a second invocation — a manual run during the
 * scheduled one, say — wait rather than interleave.
 *
 *   DATABASE_URL                required
 *   DEMO_EMAIL, DEMO_PASSWORD   required (used by the seed step)
 *   API_URL                     default http://server:3000
 */

const { Client } = require('pg');
const { seed } = require('./seed-demo');

// Arbitrary but fixed. Any process taking this id is asking for the
// same thing, which is the point.
const LOCK_ID = 0x0C17ADE1;

async function wipe() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log('[wipe] acquiring lock');
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    // Counted before and after so the log says what actually
    // happened. A wipe that silently did nothing is worse than one
    // that fails, because the banner keeps promising it ran.
    const before = await client.query('SELECT count(*)::int AS n FROM users');

    const { rowCount } = await client.query('DELETE FROM users');

    const items = await client.query('SELECT count(*)::int AS n FROM vault_items');
    const tokens = await client.query('SELECT count(*)::int AS n FROM refresh_tokens');

    console.log(
      `[wipe] deleted ${rowCount} of ${before.rows[0].n} accounts; ` +
      `vault_items now ${items.rows[0].n}, refresh_tokens now ${tokens.rows[0].n}`
    );

    if (items.rows[0].n !== 0 || tokens.rows[0].n !== 0) {
      // The cascade is the whole basis for using DELETE. If it ever
      // stops holding — a new table added without ON DELETE CASCADE —
      // fail loudly rather than leaving one user's rows behind on a
      // machine that told everyone it wipes itself.
      throw new Error('cascade left rows behind — check foreign keys on new tables');
    }
  } finally {
    // Releasing on the same connection that took it, then closing.
    // A crashed process drops the session and the lock with it.
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

async function main() {
  console.log(`[wipe] starting at ${new Date().toISOString()}`);
  await wipe();
  await seed();
  console.log(`[wipe] complete at ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('[wipe] failed:', err.message);
  process.exit(1);
});
