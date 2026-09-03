#!/usr/bin/env node
/**
 * Nightly wipe for the public demo.
 *
 * Deletes every account on the instance. The banner promises this
 * happens; the promise is the reason anyone can be told not to worry
 * about what they typed into a demo.
 *
 * It used to reseed a shared demo account afterwards. There is no
 * shared account any more — every visitor provisions their own vault
 * in the browser — so the wipe now ends with an EMPTY database and
 * that is the correct outcome, not a failure. The log says so
 * explicitly, because the person reading `logs wipe` at 06:00 would
 * otherwise see "0 accounts" and reasonably assume the seed broke.
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
 * Two wipes running at once would have one deleting rows the other is
 * still counting, and the cascade assertion below would fire on a
 * count that was never inconsistent. The lock makes a second
 * invocation — a manual run during the scheduled one, say — wait
 * rather than interleave.
 *
 *   DATABASE_URL                required
 *   API_URL                     unused since the reseed was removed
 */

const { Client } = require('pg');

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

    // Spelled out because the alternative is someone reading this at
    // 06:00, seeing an empty database, and going looking for a seed
    // step that no longer exists.
    console.log(
      '[wipe] the database is now empty, which is the expected end state — ' +
      'there is no shared demo account to reseed. Visitors provision their ' +
      'own vault on demand.'
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
  console.log(`[wipe] complete at ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('[wipe] failed:', err.message);
  process.exit(1);
});
