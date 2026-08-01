const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.DATABASE_URL });

// Thin wrapper so the rest of the app never touches the pool directly.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query, pool };