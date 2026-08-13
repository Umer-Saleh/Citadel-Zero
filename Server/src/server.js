const app = require('./app');
const config = require('./config');
const refreshTokenRepo = require('./repositories/refreshTokenRepo');

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;   // hourly

/**
 * Delete expired refresh tokens.
 *
 * This used to run opportunistically on login, which meant a dormant
 * account kept its expired rows indefinitely. An interval is not a
 * real scheduler — it dies with the process and every instance runs
 * its own copy — but DELETE on already-expired rows is idempotent, so
 * concurrent sweeps are harmless. pg_cron is the production answer.
 */
async function sweep() {
  try {
    const n = await refreshTokenRepo.deleteExpired();
    if (n > 0) console.log(`[server] swept ${n} expired refresh tokens`);
  } catch (err) {
    // Housekeeping must never take the process down.
    console.warn('[server] token sweep failed:', err.message);
  }
}

app.listen(config.PORT, () => {
  console.log(`Server on http://localhost:${config.PORT}`);

  sweep();                                  // once at boot
  // No unref() here. The HTTP server is what should keep the process
  // alive, and unref'ing this timer left Node with nothing it counted
  // as a reason to stay running — the process exited a few seconds
  // after boot, cleanly and silently.
  setInterval(sweep, SWEEP_INTERVAL_MS);
});