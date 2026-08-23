#!/usr/bin/env node
/**
 * Apply migrations/sql/grant-app-role.sql.
 *
 * Runs straight after `node-pg-migrate up`, as the privileged user,
 * because the grants target tables migrations create. The SQL itself
 * is idempotent and skips when the role is absent, so this is safe on
 * every deploy and a no-op for a setup that connects as the superuser.
 *
 * Executed through pg rather than psql because the API image is
 * node:alpine and carries no Postgres client — adding one so a deploy
 * step can run four GRANTs is not worth the surface.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, '..', 'migrations', 'sql', 'grant-app-role.sql');

async function main() {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();

  // NOTICE is how the SQL reports which branch it took, and it is the
  // only way to tell "granted" from "skipped" from out here.
  client.on('notice', msg => console.log(`[grants] ${msg.message}`));

  try {
    await client.query(sql);
    console.log('[grants] applied');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[grants] failed:', err.message);
  process.exit(1);
});
