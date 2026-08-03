# ADR 0001: Envelope encryption for the vault key

**Status:** Accepted
**Date:** 2026-08-03

## Context

The original design derived the vault encryption key directly from the master
password:

```
master password --Argon2id--> master key --HKDF("enc")--> vault key --> encrypts items
```

This was cryptographically sound, but it made the vault key a deterministic
function of the master password. Changing the password necessarily changed the
key that protected every stored item.

The consequences only became visible when working through the product
requirements:

**Password change would require re-encrypting the entire vault.** The client
would have to download every item, decrypt each with the old key, re-encrypt
with the new key, and upload all of them atomically. For a large vault this is
minutes of work, and a failure partway through would leave the vault in a mixed
state — some items readable with the old key, some with the new, with no
reliable way for the client to tell which is which.

**Account recovery was impossible.** Zero-knowledge means the server cannot
reset a password. A printed recovery key should be able to restore access, but
there was exactly one path to the vault key and it ran through the master
password.

**KDF parameters could not be raised.** Per-user `kdf_params` were stored
specifically so Argon2 costs could increase as hardware improved. But raising
them changes the derived key, which again means re-encrypting everything. The
column existed for flexibility that the design could not actually deliver.

**Sharing was blocked.** Sharing a single item would require handing over the
key that decrypts all of them.

The underlying problem was not weak cryptography. It was that a key protecting
long-lived data was derived from something that changes.

## Options considered

### 1. Keep the current design; re-encrypt on password change

Rejected. It does not solve recovery, sharing, or KDF upgrades, and the atomicity
requirement on a multi-thousand-item re-encryption is a genuine data-loss risk
over an unreliable connection.

### 2. Store a server-side key that can re-encrypt on the user's behalf

Rejected outright. This would give the server the ability to decrypt vault
contents, which abandons the entire premise of the system.

### 3. Envelope encryption — a random data key wrapped by a password-derived key

Accepted.

## Decision

Generate a random 256-bit **Data Encryption Key (DEK)** at signup. Derive a
**Key Encryption Key (KEK)** from the master password, and use it to encrypt only
the DEK. Store the resulting **wrapped DEK** server-side.

```
master password --Argon2id--> master key --HKDF("kek")--> KEK
DEK = randomBytes(32)                    <- independent of the password
wrappedDEK = AES-256-GCM(DEK, key = KEK) <- stored server-side
DEK --> encrypts vault items
```

The DEK never changes for the lifetime of the account. A password change
unwraps it with the old KEK and re-wraps it under the new one — a single 32-byte
operation, with no vault item touched.

Account recovery uses the same mechanism: the DEK is wrapped a second time under
a key derived from a client-generated 128-bit recovery key, giving two
independent paths to the same vault.

## Consequences

### Positive

- Password change is one small write instead of a full vault re-encryption, and
  the atomicity problem reduces to a single database transaction over four
  columns.
- Account recovery is possible without the server ever holding anything that can
  decrypt the vault.
- KDF parameters can be raised transparently on login by re-wrapping.
- Multiple unlock methods become additive: each is just another wrapper around
  the same DEK.
- The zero-knowledge property is unchanged. The server stores two wrappers and
  ciphertext, and can open none of them.

### Negative

- One more layer of indirection to understand and to document. Anyone reading
  the code must grasp the DEK/KEK distinction before the auth flow makes sense.
- Four additional columns on `users`, and a wrapped DEK must be transmitted at
  signup and returned at login.
- A bug in the wrapping logic would be catastrophic and silent — an incorrectly
  wrapped DEK still looks like ciphertext. This is mitigated by unit tests
  asserting that the wrapper does not contain the plaintext DEK, that the wrong
  KEK fails, and that a tampered wrapper is rejected.
- DEK rotation, if ever required after a suspected compromise, still means
  re-encrypting the whole vault. That is now a rare deliberate operation rather
  than a routine one.

### Migration

Existing rows could not be migrated server-side. Re-wrapping requires the DEK,
which requires the KEK, which requires the master password — and the server has
no access to any user's password. A production migration would have to happen
client-side, at each user's next login, one account at a time.

This is a real operational constraint of zero-knowledge systems and worth stating
plainly: **the operator cannot migrate their own users' data.** For this project,
test data was truncated instead.

## Notes

This is the same pattern used by 1Password, Bitwarden, and AWS KMS. The naming
here (DEK, KEK, key wrapping) follows the standard vocabulary deliberately, so
the design is recognisable to anyone who has seen it elsewhere.
