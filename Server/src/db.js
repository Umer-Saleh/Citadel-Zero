require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Thin wrapper so the rest of the app never touches the pool directly.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query, pool };