const { query, pool } = require('./src/db');

async function main() {
  const { rows } = await query('SELECT now() AS time, current_database() AS db');
  console.log('Connected:', rows[0]);

  const tables = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  console.log('Tables:', tables.rows.map(r => r.table_name));

  await pool.end();
}

main().catch(err => console.error('DB error:', err.message));