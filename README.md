# Zero-Knowledge Password Manager

[![CI](https://github.com/Umer-Saleh/Zero-Knowledge-Password-Manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Umer-Saleh/Zero-Knowledge-Password-Manager/actions/workflows/ci.yml)

A password manager where **the server never receives the master password, any
encryption key, or any plaintext vault data.** If the database, the server
process, and all network traffic were handed to an attacker, they could not read
a single stored credential.

Node.js · Express · PostgreSQL · Argon2id · AES-256-GCM · 64 tests

> **This is an educational implementation.** It has not been independently
> audited and is not intended to store real credentials.

---

## The guarantee

Everything in this design follows from one requirement:

> The server must be able to lose its entire database and still leak nothing
> usable.

Three rules make that true:

1. **Encryption and decryption happen only on the client.** The server stores and
   moves ciphertext. It has no code path capable of producing a decryption key.
2. **The value that authenticates you is cryptographically independent of the
   value that decrypts your vault.** If they were the same secret, a compromised
   server could capture it at login and decrypt everything.
3. **The key that encrypts your data is not derived from your password.** It is
   random, and wrapped by a password-derived key — so the password can change, or
   be replaced by a recovery key, without touching the vault.

Rule 2 is what distinguishes a zero-knowledge password manager from "a password
manager that happens to use encryption." Rule 3 is what makes it usable.

---

## Cryptographic design

### Key hierarchy

```
Master password
      │
      ▼  Argon2id  (m = 128 MiB, t = 2, p = 1, per-user 16-byte salt)
  Master key  (256-bit, client memory only, never stored or transmitted)
      │
      ├── HKDF-SHA256(masterKey, "auth") ──► Auth hash  ──► sent to server at login
      │
      └── HKDF-SHA256(masterKey, "kek")  ──► KEK        ──► wraps the DEK, never leaves the device

  DEK = randomBytes(32)                      ← independent of the password
  wrappedDEK = AES-256-GCM(DEK, key = KEK)   ← stored server-side, unopenable by the server
  DEK ──► encrypts every vault item
```

| Term | Role |
|---|---|
| **DEK** (Data Encryption Key) | Random 256-bit key. Encrypts vault items. Never changes. |
| **KEK** (Key Encryption Key) | Derived from the master password. Encrypts only the DEK. |
| **Wrapped DEK** | The DEK under AES-GCM. Stored server-side. Useless without the password. |
| **Auth hash** | Proves identity to the server. Cannot decrypt anything. |

### Why each piece

**Argon2id** for the password-to-key step, because it is memory-hard: each
derivation must allocate 128 MiB, which defeats the massive parallelism a GPU
brings to an offline attack. Parameters were tuned by measurement to land near
300 ms on the development machine, comfortably above the OWASP minimum of
19 MiB / t=2.

**HKDF** splits the master key into two independent sub-keys. HKDF is one-way, so
an attacker holding the auth hash cannot recover the master key and therefore
cannot compute the KEK. This is what lets the client prove its identity without
handing over the means to decrypt.

**Envelope encryption** breaks the coupling between the password and the vault.
Because the DEK is random rather than derived, a password change re-wraps 32
bytes instead of re-encrypting every item — and multiple unlock methods become
additive, since each is just another wrapper around the same DEK. See
[ADR 0001](docs/adr/0001-envelope-encryption.md).

**AES-256-GCM** for all encryption. GCM is authenticated: alongside the ciphertext
it produces a 16-byte tag, so any modification to stored data is detected at
decryption rather than silently returning corrupted plaintext. A fresh 96-bit
nonce is generated for every encryption, including every update.

**Server-side re-hashing.** The client's auth hash is hashed again with Argon2id
before storage. Without this, a stolen `auth_hash` column would be
password-equivalent — an attacker could replay a stored value directly to the
login endpoint. The server-side cost is deliberately lower than the client-side
cost: its input is already a 256-bit uniformly random value, not a guessable
password, so there is nothing brute-forceable to defend against.

### KDF parameters are per account

`kdf_salt` and `kdf_params` are stored per user and returned to the client before
login. Costs are not hardcoded, so defaults can be raised as hardware improves
without locking existing users out — the client always derives with the
parameters that account was registered under.

Login reports whether an account's parameters are below current defaults. If they
are, the client — which holds the master password at that moment, the only time
it legitimately can — re-derives the KEK under stronger parameters and re-wraps
the same DEK. Silent, automatic, no vault operation.

The server refuses parameters weaker than current defaults on **any** dimension,
so an authenticated client or a stolen session cannot silently downgrade an
account's work factor. Argon2 cost is not a single comparable number, so the
check is deliberately conservative rather than trying to rank trade-offs between
memory and time.

---

## Features

### Master password change

The client unwraps the DEK with the old KEK, derives a new KEK from the new
password, and re-wraps the same DEK. The server verifies the current auth hash
and writes four columns **in one transaction**.

The transaction is not optional. If `auth_hash` updated but the wrapped DEK did
not, the user would log in successfully with the new password and then fail to
unwrap their own vault — locked out with correct credentials, permanently.

Vault ciphertext is byte-identical before and after. There is a test asserting
exactly that.

### Account recovery

Zero-knowledge means no password reset — a reset would require the server to hold
a key. Instead, at signup the client generates a 128-bit **recovery key** and
wraps the same DEK a second time under a key derived from it:

```
DEK ──┬── wrapped under KEK(master password)  ──► wrapped_dek
      └── wrapped under KEK(recovery key)     ──► recovery_wrapped_dek
```

Two independent doors, one vault. The server stores both wrappers and can open
neither. The recovery key is displayed once, at signup, and never transmitted —
the server cannot re-display it because the server never had it.

Recovery rotates the kit, so a used recovery key stops working.

**HKDF, not Argon2id, for the recovery KEK.** Argon2id exists to make guessing a
low-entropy human password expensive. A 128-bit machine-generated key has nothing
to guess — brute-forcing it is infeasible regardless of KDF speed — so the slow
KDF would cost 300 ms and buy nothing.

The recovery key is formatted in Crockford base32 (no `I`, `L`, `O`, or `U`) in
groups of four, since a user transcribes it by hand from paper and recovery is a
once-in-a-crisis flow where a typo means data loss.

---

## Architecture

```
┌───────────────────────────┐    HTTPS     ┌──────────────────────┐          ┌──────────────┐
│  Client                   │  ciphertext  │  Node.js + Express   │   SQL    │  PostgreSQL  │
│  Argon2id, HKDF, AES-GCM  │ ───────────► │  Auth + vault CRUD   │ ───────► │  Ciphertext  │
│  DEK in memory only       │ ◄─────────── │  No crypto keys      │ ◄─────── │  only        │
└───────────────────────────┘              └──────────────────────┘          └──────────────┘
```

### Layers

```
src/
  config/         env validated with zod at startup; exits on invalid
  crypto/         keys, cipher, envelope, recovery — pure functions, no I/O
  repositories/   all SQL lives here, and nowhere else
  services/       business rules; knows nothing about HTTP
  routes/         zod schemas per endpoint
  middleware/     requireAuth, rate limiting, validation
  errors/         AppError, separating operational failures from bugs
  app.js          wiring only — exports the app, does not listen
  server.js       imports app, calls listen
```

Dependencies point one way: routes call services, services call repositories.
`req` and `res` never appear below the routes layer. `app.js` has no database
import, so the separation is structural rather than a convention.

The server imports only `serverStoreAuth` and `serverVerifyAuth` from the crypto
layer. It has no access to `deriveKeys`, `wrapDEK`, or `decryptItem`. That absence
is enforced by the module boundary.

---

## Threat model

| Adversary | Capability | Why it fails |
|---|---|---|
| Database theft | Full dump of every table | No key exists in any column. Vault rows are AES-GCM ciphertext; both DEK wrappers require a secret the server never holds; `auth_hash` is a hash of a hash. |
| Malicious server operator | Reads the database, logs all traffic | The server never possesses the master password, master key, KEK, or DEK at any point. |
| Network interception | Reads all traffic | TLS in transit; and a full TLS break exposes only the auth hash and ciphertext, neither of which decrypts anything. |
| Offline brute force | Unlimited guesses against a stolen dump | Each guess costs a 128 MiB Argon2id derivation, then a second Argon2id verification. Memory-hardness blocks GPU parallelism. |
| Rainbow tables | Precomputed hash lookups | Unique random 16-byte salt per user. |
| Credential replay | Sends a stored `auth_hash` to the login endpoint | Server-side re-hashing means the stored value is not the value the endpoint accepts. |
| SQL injection | Malicious input in any request field | All queries parameterized; no SQL built by string concatenation. |
| IDOR / cross-user access | Guesses another user's item UUID | Every vault query is scoped by `user_id` from the verified JWT, in the `WHERE` clause. A mismatch matches zero rows and returns 404 — not 403, which would confirm the item exists. |
| Token theft | Steals a session JWT | 15-minute expiry. More importantly, a token authorizes API calls but cannot decrypt: the DEK never leaves the client. |
| Token forgery | Modifies the JWT payload | Payload is readable but signature-protected; any change fails verification. |
| Data tampering | Flips bits in stored ciphertext | GCM auth tag fails loudly at decryption. |
| Username enumeration | Probes login to discover registered emails | Identical 401 for unknown account and wrong password — and login always performs an Argon2 verification, against a dummy hash when the account does not exist, so response time does not distinguish them either. |
| KDF downgrade | Authenticated client proposes weak parameters | Rejected at two levels: the schema enforces the OWASP floor, and the service refuses anything below current defaults on any dimension. |

### Accepted limitations

Stated deliberately, because a threat model that claims to cover everything is not
a threat model.

- **A forgotten master password with no recovery kit means permanent data loss.**
  No reset is possible, because a reset would require the server to hold a key.
- **The recovery endpoint is unauthenticated.** It has to be — the user has
  forgotten their password. An attacker who knows an email address can overwrite
  an account's credentials, but cannot produce a wrapper containing the real DEK,
  so they lock the account out rather than reading it. **Denial of service, not
  disclosure.** A production system would add email confirmation and notify the
  account holder.
- **Rate limiting is in-memory.** Counters reset on restart and are not shared
  across instances. A Redis-backed store is the production answer.
- **A weak master password weakens everything.** Argon2id makes guessing
  expensive; it cannot rescue a password from a wordlist.
- **A compromised client device is out of scope.** A keylogger sees plaintext at
  the moment the user does.
- **Item length is not hidden.** GCM ciphertext length reveals approximate
  plaintext length. Padding into fixed-size buckets would address this.
- **Email addresses are stored in plaintext**, since they are the login
  identifier.
- **No TLS in local development.** The architecture assumes TLS terminating at a
  reverse proxy in deployment.

---

## Database schema

Managed with `node-pg-migrate`; migrations are versioned and reversible.

```sql
users (
  id                          uuid primary key,
  email                       text unique not null,
  kdf_salt                    text not null,     -- public by design
  kdf_params                  jsonb not null,    -- {m,t,p}, upgradeable per account
  auth_hash                   text not null,     -- server-side Argon2id re-hash
  wrapped_dek                 text,              -- DEK under the password KEK
  wrapped_dek_nonce           text,
  wrapped_dek_tag             text,
  recovery_salt               text,
  recovery_wrapped_dek        text,              -- DEK under the recovery KEK
  recovery_wrapped_dek_nonce  text,
  recovery_wrapped_dek_tag    text,
  created_at                  timestamptz not null
)

vault_items (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  encrypted_data  text not null,   -- AES-256-GCM ciphertext, base64
  nonce           text not null,   -- 96-bit, unique per encryption
  auth_tag        text not null,
  created_at      timestamptz not null,
  updated_at      timestamptz not null
)
```

No column in this schema can hold plaintext. UUID primary keys prevent
enumeration; the foreign key with `on delete cascade` prevents orphaned rows.

---

## API

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | Liveness check |
| `POST` | `/api/auth/signup` | — | Register; accepts auth hash, salt, params, and both DEK wrappers |
| `GET` | `/api/user/kdf-params` | — | Salt and KDF params, needed before login |
| `POST` | `/api/auth/login` | — | Verifies auth hash; returns a JWT, the wrapped DEK, and any KDF upgrade signal |
| `GET` | `/api/vault` | Bearer | The user's encrypted items |
| `POST` | `/api/vault` | Bearer | Store a new encrypted item |
| `PUT` | `/api/vault/:id` | Bearer | Replace an encrypted item |
| `DELETE` | `/api/vault/:id` | Bearer | Delete an item |
| `POST` | `/api/account/password` | Bearer | Change the master password; re-wraps the DEK |
| `POST` | `/api/account/kdf-upgrade` | Bearer | Raise KDF parameters; re-wraps the DEK |
| `GET` | `/api/account/recovery-material` | — | Recovery salt and wrapper |
| `POST` | `/api/account/recover` | — | Complete recovery with a new password |

No endpoint accepts or returns plaintext vault data.

---

## Running it

Requires Node.js 20+ and PostgreSQL 15+.

```bash
cd server
npm install

createdb password_manager
createdb password_manager_test
```

Create `server/.env` from `.env.example`:

```
DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/password_manager
TEST_DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/password_manager_test
JWT_SECRET=<at least 32 random characters>
NODE_ENV=development
RATE_LIMIT_ENABLED=true
```

Configuration is validated at startup and the process exits on invalid values — a
short `JWT_SECRET` will refuse to start rather than silently producing forgeable
tokens.

```bash
npm run migrate up      # apply schema
npm run migrate:test    # and to the test database
npm start
npm test
```

---

## Testing

64 tests across four categories:

| Layer | Scope |
|---|---|
| Unit | Crypto primitives with no I/O |
| Integration | Services against a real test database |
| End-to-end | Full HTTP requests through the stack |
| **Adversarial** | **Asserts that attacks fail** |

The adversarial suite is the one that matters. In ordinary software, tests prove
features work; in security software, the valuable tests prove attacks do not.
Among them:

- A wrong master password produces a key that cannot decrypt
- Tampered ciphertext, tampered auth tags, and swapped nonces are all rejected
- 1000 encryptions produce 1000 distinct nonces
- User A gets 404 for user B's item ID — and B's data is verifiably unchanged
- Signup rejects KDF parameters below the OWASP floor
- An authenticated KDF downgrade is rejected and the account left untouched
- A wrong recovery key cannot unwrap the DEK
- The API response contains no plaintext, asserted by string search on the whole
  response body

Two tests state the central design claim directly: vault ciphertext is
**byte-identical** before and after a password change, and before and after a KDF
upgrade.

### Verifying the claims yourself

```sql
SELECT encrypted_data, nonce FROM vault_items;
```

Compare that against what the client displays. Same rows, and the difference is
possession of a key that exists in neither the database nor the server.

---

## Documentation

- [ADR 0001 — Envelope encryption](docs/adr/0001-envelope-encryption.md)

---

## Not yet implemented

- Refresh token rotation with reuse detection; access tokens expire with no
  renewal path
- TOTP two-factor authentication
- A browser client — the current client is a Node reference implementation
- Redis-backed rate limiting
- Least-privilege database role; the app currently connects as superuser
- Structured logging and an audit trail
- Docker and CI
