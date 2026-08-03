import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // Node 20+ exposes the same WebCrypto API browsers do, so the
    // crypto port can be tested without a headless browser.
    environment: 'node',
    globals: true
  }
});