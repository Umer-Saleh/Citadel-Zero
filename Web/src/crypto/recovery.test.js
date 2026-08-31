import { describe, test, expect } from 'vitest';
import vectors from './vectors/crypto-vectors.json';
import { deriveRecoveryKek, deriveRecoveryAuthHash } from './recovery';
import { fromHex, toHex } from './bytes';

// ---------------------------------------------------------------
// CROSS-IMPLEMENTATION CONSISTENCY — deriveRecoveryAuthHash
//
// This constant is asserted in BOTH suites, here and in
// Server/test/unit/crypto.test.js, against the same input.
//
// What that proves: the browser and Node implementations agree. If
// they ever diverge, a vault sealed by one becomes unrecoverable
// through the other, and one of these two tests goes red.
//
// What it does NOT prove: that either implementation is correct. A
// shared bug would produce a matching wrong answer and both would
// pass. Agreement is the property that actually matters for this
// value, so a consistency test is the right test — but it is worth
// being honest about which of the two it is.
//
// The generated shared vectors in crypto-vectors.json already cover
// deriveRecoveryKek this way. Regenerating them to include this
// derivation is the tidier home for it, and a sensible follow-up;
// the vectors file is deliberately untouched on this branch.
// ---------------------------------------------------------------
const NODE_RECOVERY_AUTH_HEX =
  'c8730690de5280e1e77e72d59f5ae6594c8e0897c5465ac7f5b8b0a8fe69010a';

describe('recovery proof of possession', () => {
  test('deriveRecoveryAuthHash agrees with the Node implementation', async () => {
    const { recoveryKey, saltHex } = vectors.recovery;

    const proof = await deriveRecoveryAuthHash(recoveryKey, fromHex(saltHex));

    expect(toHex(proof)).toBe(NODE_RECOVERY_AUTH_HEX);
  });

  test('the recovery proof is independent of the recovery KEK', async () => {
    const { recoveryKey, saltHex, expected } = vectors.recovery;
    const salt = fromHex(saltHex);

    // Same key, same salt, different HKDF info label. Holding one must
    // reveal nothing about the other, which is what lets the proof be
    // sent to a server the KEK must never reach.
    const kek = await deriveRecoveryKek(recoveryKey, salt);
    const proof = await deriveRecoveryAuthHash(recoveryKey, salt);

    expect(toHex(proof)).not.toBe(toHex(kek));

    // And the KEK itself is unchanged by this branch, so recovery keys
    // printed before it still open the vaults they were issued for.
    expect(toHex(kek)).toBe(expected.recoveryKekHex);
  });

  test('formatting of the typed key does not change the proof', async () => {
    const { recoveryKey, saltHex } = vectors.recovery;
    const salt = fromHex(saltHex);

    // Users transcribe these from paper. Lower case and missing dashes
    // must derive the same proof, or a correct key would be rejected.
    const canonical = await deriveRecoveryAuthHash(recoveryKey, salt);
    const messy = await deriveRecoveryAuthHash(
      recoveryKey.replace(/-/g, '').toLowerCase(), salt
    );

    expect(toHex(messy)).toBe(toHex(canonical));
  });
});
