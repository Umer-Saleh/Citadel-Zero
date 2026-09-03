/**
 * The five entries a freshly provisioned demo vault starts with.
 *
 * WHY THIS PLAINTEXT IS IN THE BUNDLE
 * -----------------------------------
 * It has to be. The vault is zero-knowledge: items are encrypted under
 * a DEK only the browser ever holds, so the server cannot create a
 * readable vault on a visitor's behalf. Whatever seeds a demo vault
 * must run client-side, which means the plaintext ships in the bundle.
 *
 * That costs nothing. These are invented credentials for hosts that
 * cannot exist — example-bank.invalid and friends are RFC 2606
 * reserved — and the same five entries were already public in the
 * repository and in the seeded shared account. Nothing here was ever
 * secret, and nothing real is reachable with any of it.
 *
 * They previously lived in Server/scripts/seed-demo.js, which seeded
 * one shared account. That account is gone; this is the single
 * remaining copy, so there is nothing to keep in sync.
 *
 * Chosen to make the UI show something true rather than uniform:
 * a spread of password strengths so the vault-health readout is not a
 * flat 100%, one deliberate reuse so the reused-password warning has
 * something to find, and one long note so the padding buckets differ
 * visibly when a reviewer opens the stored-material panel.
 */
export const DEMO_FIXTURES = [
  {
    site: 'GitHub',
    username: 'demo-reviewer',
    password: 'X7#mQv2$Ld9pRt4Wz!Kn',
    url: 'https://github.com',
    notes: ''
  },
  {
    site: 'Northwind Bank',
    username: 'demo.reviewer@example.com',
    password: 'correct-horse-battery-staple-97',
    url: 'https://example-bank.invalid',
    notes: 'Security questions are answered with generated nonsense, stored below.\n\nFirst pet: qv7-tamarind-loop\nFirst school: 44-brass-kettle-hz\n\nThis note exists so at least one item lands in a larger padding bucket than the rest — compare the ciphertext lengths in the vault_items table and you can see the bucketing at work.'
  },
  {
    site: 'Streamly',
    username: 'demo-reviewer',
    password: 'summer2024',
    url: 'https://example-streaming.invalid',
    notes: 'Deliberately weak, so the strength meter and the vault health readout have something to complain about.'
  },
  {
    site: 'Acme Corp SSO',
    username: 'u.reviewer',
    password: 'Tz8!vQ3wLm6@Yb1nHs5#',
    url: 'https://sso.example-corp.invalid',
    notes: 'Rotates every 90 days.'
  },
  {
    site: 'Parcel Tracker',
    username: 'demo-reviewer',
    password: 'summer2024',
    url: 'https://example-parcels.invalid',
    notes: 'Reuses the Streamly password on purpose, so the reused-password warning has something to find.'
  }
];
