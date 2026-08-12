# VaultKeep — Zero-Knowledge Password Manager

[![CI](https://github.com/Umer-Saleh/Zero-Knowledge-Password-Manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Umer-Saleh/Zero-Knowledge-Password-Manager/actions/workflows/ci.yml)

A password manager where **the server never receives the master password, any
encryption key, or any plaintext vault data.** If the database, the server
process, and all network traffic were handed to an attacker, they could not read
a single stored credential.

React · Node.js · Express · PostgreSQL · Argon2id · AES-256-GCM · Docker · 134 tests

> **This is an educational implementation.** It has not been independently
> audited and is not intended to store real credentials.

> **Desktop only.** The interface is built for a desktop viewport and has no
> responsive layout yet. It will not lay out correctly on a phone.

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
additive, since each is just another wrapper around the same DEK.

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

### The same crypto, twice

The client is a browser, so the crypto exists in two implementations: Node's
`crypto` module server-side, and WebCrypto plus `hash-wasm` in the browser. They
must agree byte for byte or a vault encrypted in one cannot be opened by the
other.

They are verified against shared test vectors rather than assumed compatible.
That caught a real incompatibility: **WebCrypto appends the GCM authentication
tag to the ciphertext, while Node returns it separately.** The browser
implementation splits the last 16 bytes back out to match the wire format.

### KDF parameters are per account

`kdf_salt` and `kdf_params` are stored per user and returned to the client before
login. Costs are not hardcoded, so defaults can be raised as hardware improves
without locking existing users out — the client always derives with the
parameters that account was registered under.

Login reports whether an account's parameters are below current defaults. If they
are, the client — which holds the master password at that moment, the only time
it legitimately can — re-derives the KEK under stronger parameters and re-wraps
the same DEK. No vault operation is involved.

The server refuses parameters weaker than current defaults on **any** dimension,
so an authenticated client or a stolen session cannot silently downgrade an
account's work factor. Argon2 cost is not a single comparable number, so the
check is deliberately conservative rather than trying to rank trade-offs between
memory and time.

---

## Features

### Master password change

The client unwraps the DEK with the old KEK, derives a new KEK from the new
password, and re-wraps the same DEK. The server verifies the current auth hash,
writes the new credentials, and revokes every session — all in one transaction.

The transaction is not optional. If `auth_hash` updated but the wrapped DEK did
not, the user would log in successfully with the new password and then fail to
unwrap their own vault — locked out with correct credentials, permanently. And if
the credentials changed but sessions survived, the change would not lock out
whoever prompted it.

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

### Sessions: rotation and reuse detection

Access tokens are stateless JWTs lasting 10 minutes. Refresh tokens are 32 random
bytes, live 14 days, and are stored **only as a SHA-256 hash** — a database leak
must not hand over live sessions.

Every refresh consumes its token and issues a new one. Tokens descended from a
single login share a `family_id`.

**A spent token coming back is the theft signal.** It means two parties hold the
same credential, and the server cannot tell victim from thief — so it revokes the
entire family. Both are forced back to the master password, which the attacker
does not have.

Two details that took getting right:

- The spent check lives in the `UPDATE`'s `WHERE` clause, not in JavaScript.
  Read-then-write lets two concurrent refreshes both pass the check before either
  writes.
- Revocation commits in its own transaction. It fires on a failure path, and the
  401 that follows would otherwise roll back the very revocation it triggered.

Rotation does **not** extend expiry — the new token inherits the original
`expires_at`. A sliding window would let a stolen family be renewed indefinitely.

On the client, concurrent 401s share a single in-flight refresh promise. Without
that, several requests would each replay the same token and the app would trip
its own reuse detection, logging itself out.

**SHA-256, not Argon2id,** for refresh tokens and backup codes — the input is
already 256 bits of CSPRNG output, so there is no low-entropy guess for a slow
hash to defend against.

### Two-factor authentication (TOTP)

Standard TOTP (RFC 6238), with ten single-use backup codes stored as hashes.

Enrolment is two steps: the server issues a secret and a QR code, and 2FA is only
enabled once the user proves they scanned it by entering a valid code. Enabling on
the first step would lock out anyone who closed the tab mid-scan.

The consumed time-step is recorded, and codes at or below it are refused — so a
code observed over someone's shoulder cannot be replayed inside its 90-second
validity window.

A bad code returns the **same** `INVALID_CREDENTIALS` as a bad password. A
distinct error would confirm to an attacker that the password they hold is live,
letting them focus effort on exactly the accounts worth attacking.

**What 2FA protects here is the API, not the vault.** The vault is sealed under a
key the server never sees, so a server-side check cannot gate it. What it does
gate is the encrypted blobs: a stolen password alone can no longer download
`wrappedDek` and the vault items, and without the ciphertext the password is
worthless. Nothing in the key hierarchy derives from the TOTP secret, which the
server necessarily holds in plaintext.

### Client-side details

- **The DEK lives in memory only.** Never `localStorage`, never a cookie. A page
  refresh loses it, which is correct — the vault re-locks.
- **The UI is gated on possession of the key,** not on a screen name. `isUnlocked`
  is derived from `dek !== null`, so the interface cannot show a vault it cannot
  decrypt.
- **Auto-lock after 5 minutes** of inactivity.
- **Copied secrets clear from the clipboard after 30 seconds,** through a single
  module that owns the timer. The clipboard is a global resource, so the guard is
  global too.
- **Password strength via zxcvbn** — dictionary matches, keyboard walks, dates,
  and l33t-speak unmunging. Deliberately **no composition rules**: NIST dropped
  them from SP 800-63B because "one uppercase, one digit, one symbol" reliably
  produces `Password1!`.
- **The generator uses `crypto.getRandomValues` with modulo-bias rejection**, so
  every character is uniformly likely.

---

## Architecture

```
┌───────────────────────────┐    HTTPS     ┌──────────────────────┐          ┌──────────────┐
│  Browser (React)          │  ciphertext  │  Node.js + Express   │   SQL    │  PostgreSQL  │
│  Argon2id, HKDF, AES-GCM  │ ───────────► │  Auth + vault CRUD   │ ───────► │  Ciphertext  │
│  DEK in memory only       │ ◄─────────── │  No crypto keys      │ ◄─────── │  only        │
└───────────────────────────┘              └──────────────────────┘          └──────────────┘
```

```
Server/src/
  config/         env validated with zod at startup; exits on invalid
  crypto/         keys, cipher, envelope, recovery, refreshToken, totp — pure, no I/O
  repositories/   all SQL lives here, and nowhere else
  services/       business rules; knows nothing about HTTP
  routes/         zod schemas per endpoint
  middleware/     requireAuth, rate limiting, validation
  errors/         AppError, separating operational failures from bugs
  app.js          wiring only — exports the app, does not listen
  server.js       imports app, calls listen

Web/src/
  crypto/         the browser port, byte-verified against Node vectors
  api/            fetch wrapper with transparent token refresh
  context/        vault (holds the DEK), theme, mascot reactions
  lib/            strength, policy, clipboard, health
  components/     shared UI primitives and the pixel icon set
  screens/        signup, recovery kit, unlock, vault, generator, settings
```

Dependencies point one way: routes call services, services call repositories.
`req` and `res` never appear below the routes layer.

**Repositories do not open transactions; services do.** Only the service knows
which writes must land together, and a repository that opens its own cannot be
composed with anything else.

The server imports only `serverStoreAuth` and `serverVerifyAuth` from its crypto
layer. It has no access to `deriveKeys`, `wrapDEK`, or `decryptItem`. That absence
is enforced by the module boundary.

---

## Threat model

| Adversary | Capability | Why it fails |
|---|---|---|
| Database theft | Full dump of every table | No key exists in any column. Vault rows are AES-GCM ciphertext; both DEK wrappers require a secret the server never holds; `auth_hash` is a hash of a hash; refresh tokens and backup codes are stored as SHA-256. |
| Malicious server operator | Reads the database, logs all traffic | The server never possesses the master password, master key, KEK, or DEK at any point. |
| Network interception | Reads all traffic | TLS in transit; and a full TLS break exposes only the auth hash and ciphertext, neither of which decrypts anything. |
| Offline brute force | Unlimited guesses against a stolen dump | Each guess costs a 128 MiB Argon2id derivation, then a second Argon2id verification. Memory-hardness blocks GPU parallelism. |
| Rainbow tables | Precomputed hash lookups | Unique random 16-byte salt per user. |
| Credential replay | Sends a stored `auth_hash` to the login endpoint | Server-side re-hashing means the stored value is not the value the endpoint accepts. |
| Refresh token theft | Steals a refresh token and uses it | Rotation makes each token single-use. When the real user next refreshes, the server sees a spent token, cannot tell which party is legitimate, and revokes the whole family. |
| Session persistence after compromise | Wants access to survive a password change | Password change and recovery revoke every session for that user, in the same transaction as the credential write. |
| TOTP replay | Reuses an observed 6-digit code inside its window | The consumed time-step is recorded; codes at or below it are refused. |
| 2FA as an oracle | Probes to learn whether a password is valid | A wrong code and a wrong password return the same error. |
| Data tampering | Flips bits in stored ciphertext | GCM auth tag fails loudly at decryption. |
| SQL injection | Malicious input in any request field | All queries parameterized; no SQL built by string concatenation. |
| IDOR / cross-user access | Guesses another user's item UUID | Every vault query is scoped by `user_id` from the verified JWT, in the `WHERE` clause. A mismatch matches zero rows and returns 404 — not 403, which would confirm the item exists. |
| Token forgery | Modifies the JWT payload | Payload is readable but signature-protected; any change fails verification. |
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
  disclosure.** A production system would add email confirmation.
- **`/api/user/kdf-params` is an account-enumeration oracle,** and now also
  reveals whether an account has 2FA enabled. It is rate limited. The alternative
  — a two-step login with a separate pending-2FA token — was judged not worth the
  extra credential type for this project.
- **Clipboard clearing cannot reach OS clipboard history.** Windows `Win+V` and
  similar managers keep their own copy. The guarantee is "not left in the paste
  buffer," not "unrecoverable."
- **JavaScript cannot guarantee memory erasure.** `dek.fill(0)` is best effort;
  the runtime may have copied the buffer already.
- **Expired refresh tokens are swept on login,** not by a scheduler. A dormant
  account keeps its expired rows. Production wants `pg_cron` or similar.
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

## Running it

### With Docker (recommended)

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# put that in .env as JWT_SECRET, and set POSTGRES_PASSWORD

docker compose up --build
```

Then open **http://localhost:8080**.

Four services: Postgres, a one-shot migration run, the API, and nginx serving the
built frontend. Migrations are their own service rather than running at server
startup, so a schema failure is visible instead of buried in boot logs — and the
server waits for `service_completed_successfully`, not merely for the container to
start.

Neither `JWT_SECRET` nor `POSTGRES_PASSWORD` has a default. Compose fails loudly
if they are unset rather than starting with a value that is published in this
repository.

If ports 3000 or 8080 are taken, set `SERVER_PORT` or `WEB_PORT` in `.env` — but
note that changing `SERVER_PORT` requires `--build`, because Vite inlines the API
URL into the bundle at build time.

### Without Docker

Requires Node.js 24+ and PostgreSQL 17+.

```bash
createdb password_manager
createdb password_manager_test

cd Server
npm install
cp .env.example .env     # then fill in DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET
npm run migrate up
npm run migrate:test
npm start                # port 3000

cd ../Web
npm install
npm run dev              # port 5173
```

Configuration is validated at startup and the process exits on invalid values — a
short `JWT_SECRET` refuses to start rather than silently producing weakly signed
tokens.

---

## Testing

```bash
cd Server && npm test    # 110 tests
cd Web && npm test       # 24 tests
```

CI runs both on every push, against a real Postgres service container, and builds
both Docker images on Linux — which is where case-sensitive imports and native
module problems surface and a Windows machine never would.

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
- An authenticated KDF downgrade is rejected and the account left untouched
- A wrong recovery key cannot unwrap the DEK
- A replayed refresh token revokes the whole family, **including the token that
  was still valid**
- A TOTP code cannot be used twice, and a backup code cannot be used twice
- Login without a code fails once 2FA is on — the one test that proves the
  feature is not inert
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

## API

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | Liveness check |
| `POST` | `/api/auth/signup` | — | Register; accepts auth hash, salt, params, and both DEK wrappers |
| `GET` | `/api/user/kdf-params` | — | Salt, KDF params, and whether 2FA is on — all needed before login |
| `POST` | `/api/auth/login` | — | Verifies auth hash and any TOTP code; returns a token pair, the wrapped DEK, and any KDF upgrade signal |
| `POST` | `/api/auth/refresh` | — | Exchanges a refresh token for a new pair |
| `POST` | `/api/auth/logout` | — | Revokes the session family |
| `GET` | `/api/vault` | Bearer | The user's encrypted items |
| `POST` | `/api/vault` | Bearer | Store a new encrypted item |
| `PUT` | `/api/vault/:id` | Bearer | Replace an encrypted item |
| `DELETE` | `/api/vault/:id` | Bearer | Delete an item |
| `POST` | `/api/account/password` | Bearer | Change the master password; re-wraps the DEK |
| `POST` | `/api/account/kdf-upgrade` | Bearer | Raise KDF parameters; re-wraps the DEK |
| `GET` | `/api/account/recovery-material` | — | Recovery salt and wrapper |
| `POST` | `/api/account/recover` | — | Complete recovery with a new password |
| `POST` | `/api/account/totp/begin` | Bearer | Issue a TOTP secret and QR URI |
| `POST` | `/api/account/totp/confirm` | Bearer | Verify a code, enable 2FA, return backup codes once |
| `POST` | `/api/account/totp/disable` | Bearer | Turn 2FA off; requires a current code |

No endpoint accepts or returns plaintext vault data. Errors carry
machine-readable codes (`EMAIL_TAKEN`, `INVALID_CREDENTIALS`,
`WEAK_KDF_PARAMS`, …) rather than only prose.

---

## Documentation

- [ADR 0001 — Envelope encryption](docs/adr/0001-envelope-encryption.md)

---

## Not yet implemented

- Responsive layout for mobile
- Redis-backed rate limiting
- Least-privilege database role; the app currently connects as superuser
- Scheduled cleanup of expired refresh tokens
- Structured logging and an audit trail
- Padding vault items to fixed-size buckets to hide length
