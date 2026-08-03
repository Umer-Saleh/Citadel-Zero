const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.DATABASE_URL });

// Thin wrapper so the rest of the app never touches the pool directly.
async function query(text, params) {
  return pool.query(text, params);
}


//Run a set of queries in a transaction. Commits on success,
//rolls back on any error.

async function withTransaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();       // always return the connection to the pool
  }
}

module.exports = { query, pool, withTransaction };