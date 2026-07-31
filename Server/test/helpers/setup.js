// MUST be required before anything that touches the database.
// db.js reads DATABASE_URL when it is first imported, so we
// redirect it to the test database before that happens.
require('dotenv').config();

process.env.NODE_ENV = 'test';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set — refusing to run tests');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;