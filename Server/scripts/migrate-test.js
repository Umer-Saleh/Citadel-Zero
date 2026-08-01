require('dotenv').config();
const { execSync } = require('child_process');

if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is not set');
  process.exit(1);
}

execSync('npx node-pg-migrate -m migrations up', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }
});