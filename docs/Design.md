# Citadel Zero — Design Notes

This document is about **why the system is shaped the way it is**. The README
explains what it does; this explains the decisions behind it, the alternatives
that were rejected, and the mistakes that were made and fixed along the way.

It is written for someone deciding whether the author understands the problem or
merely followed a tutorial. The bugs are included on purpose.

---

## 1. The one requirement

Everything follows from a single sentence:

> The server must be able to lose its entire database and still leak nothing
> usable.

That is a stronger claim than "the data is encrypted." Plenty of systems encrypt
data at rest and still hold the key somewhere on the same machine. Zero-knowledge
means the key **cannot exist server-side at all** — not in a config file, not in
an environment variable, not in a hardware module.

That single requirement has consequences that ripple through every other
decision:

- **No password reset is possible.** A reset requires the server to re-encrypt
  something, which requires a key. This forces the recovery-key design in §4.
- **The server cannot validate or inspect vault contents.** No search, no
  deduplication, no "this password appears in a breach" check server-side.
  Everything the product knows about the data, it knows in the browser — which is
  why duplicate detection lives there too (§12).
- **The crypto must exist twice** — Node for tests, WebCrypto for the browser —
  and the two must agree byte for byte. See §7.
- **Two-factor authentication protects less than people assume.** See §6.
- **Ciphertext length leaks plaintext length** unless something is done about it.
  See §8.

Where the design gets uncomfortable, it is almost always this requirement
refusing to bend.

---

## 2. The central decision: envelope encryption

### The obvious design, and why it fails

The first design anyone reaches for is:

```
master password ──► KDF ──► key ──► encrypts vault items directly
```

It works. It is also close to unusable, and the reason is worth spelling out.

**Changing the password means re-encrypting everything.** Every item, downloaded,
decrypted, re-encrypted, re-uploaded. For a vault of a few hundred entries that is
slow; worse, it is not atomic. A crash halfway leaves a vault where some items
open under the old key and some under the new one — and there is no way to tell
which is which, because the server cannot read either.

**Multiple unlock methods become impossible.** A recovery key, a second device, a
work profile — each would need its own copy of the entire encrypted vault.

**Raising KDF parameters means the same full re-encryption**, so in practice
nobody ever raises them, and accounts stay on 2015 cost factors forever.

### The design used instead

```
DEK = randomBytes(32)                      ← the key that encrypts data
KEK = HKDF(Argon2id(master password))      ← the key that encrypts the DEK
wrappedDEK = AES-256-GCM(DEK, KEK)         ← stored server-side
```

The DEK is **random**, not derived. It never changes for the life of the account.
The password-derived key only ever encrypts 32 bytes.

Every problem above dissolves:

| Operation | Cost |
|---|---|
| Change master password | Re-wrap 32 bytes. One row update. |
| Raise KDF parameters | Re-wrap 32 bytes. One row update. |
| Add or rotate a recovery key | One more wrapper of the same 32 bytes. |
| Vault items touched | **Zero, in all cases.** |

Three tests assert that vault ciphertext is byte-identical before and after a
password change, a KDF upgrade, and a recovery kit rotation. They are the most
important tests in the suite, because they are the design claim stated
executably.

### Alternative rejected: server-side key escrow

Many commercial products keep a server-held key in the chain, usually so they can
offer account recovery through support. It is a legitimate product decision — most
users lose passwords more often than they get breached.

It is incompatible with §1. If the server holds a key, then a malicious operator,
a subpoena, or a database dump plus a config leak all read the vault. This project
chose the stricter guarantee and accepted the cost: **forget your master password
and lose your recovery kit, and the data is gone.** That is stated plainly in the
UI, not buried.

---

## 3. Splitting authentication from decryption

A subtle failure mode: if the value that proves your identity is the same value
that decrypts your vault, a compromised server captures it at login and reads
everything. The encryption becomes theatre.

So the master key is split into two independent sub-keys:

```
masterKey ──┬── HKDF(masterKey, "auth") ──► authHash ──► sent to the server
            └── HKDF(masterKey, "kek")  ──► KEK      ──► never leaves the device
```

HKDF is one-way and the two contexts are domain-separated, so holding `authHash`
reveals nothing about `KEK`. The server receives proof of identity and nothing
else.

### Why the server re-hashes what it receives

The client sends `authHash`. If the server stored that value as-is, the
`auth_hash` column would be **password-equivalent**: steal the database, replay a
stored value straight to the login endpoint, and you are in. The encryption would
still hold, but the account would not.

So the server hashes it again with Argon2id before storing. The stored value is
not the value the endpoint accepts.

The server-side cost is deliberately **lower** than the client-side cost. The
input is already 256 bits of uniformly random output — there is no low-entropy
guess for a slow hash to defend against. Spending 300 ms there would buy nothing
and hand anyone a trivial denial-of-service vector against the login endpoint.

**This "what is the input's entropy?" question recurs throughout the project**, and
it is the reason for several choices that look inconsistent at first glance:

| Value | Hashed with | Why |
|---|---|---|
| Master password | Argon2id, 128 MiB | Low entropy, human-chosen, guessable |
| Client auth hash (server side) | Argon2id, cheap | Already 256 random bits |
| Recovery key | HKDF only | 128 machine-generated bits |
| Refresh token | SHA-256 | 256 random bits |
| TOTP backup code | SHA-256 | 40 random bits, rate limited |

A slow KDF exists to punish guessing. Where there is nothing to guess, it is pure
cost.

---

## 4. Recovery without a reset

Zero-knowledge forbids a password reset. But "forget your password and lose
everything" is a product with roughly no users.

The envelope design already provides the answer: the DEK can be wrapped more than
once.

```
DEK ──┬── AES-GCM under KEK(master password)  ──► wrapped_dek
      └── AES-GCM under KEK(recovery key)     ──► recovery_wrapped_dek
```

Two independent doors, one vault. The server stores both wrappers and can open
neither. The recovery key is generated in the browser, shown exactly once, and
never transmitted — the server cannot re-display it because it never had it.

### The server cannot verify a recovery key

This is the part that surprises people. `/api/account/recover` accepts a new
password and a new wrapper, and has no way to check the caller actually held the
recovery key.

Possession is proved **implicitly**: only someone who unwrapped the real DEK can
produce a valid new wrapper containing it. A client that guessed would seal a
garbage key and lock itself out of a vault it could never read.

So the attack is denial of service, not disclosure — which is why the endpoint is
heavily rate limited rather than authenticated. It cannot be authenticated; by
definition the user has lost their credentials.

### Details that matter more than they look

**Crockford base32, grouped in fours.** The user transcribes this by hand from
paper, possibly years later, in a bad moment. `I`, `L`, `O` and `U` are excluded
because they are misread as `1`, `1`, `0` and `V`. A typo in a recovery key is not
an inconvenience; it is data loss.

**The flow asks for the key before the new password.** Discovering a mistyped key
*after* choosing and confirming a new password would be an unnecessarily cruel
place to fail.

**Recovery rotates the kit.** Completing recovery issues a new recovery key and
invalidates the old one, so a key copied by someone else stops working. This is
the same reasoning as refresh token rotation in §5: using a single-use credential
is what retires it.

### Rotation without recovery

Rotating on use left a gap. A user who *knew* their key was exposed — a photo of
the printout, a shared machine — but still remembered their password had no way
to replace it except by performing a full recovery they did not need.

`/api/account/recovery-kit` closes that. It requires the master password despite
the session already being valid, because a recovery key is a permanent credential
to the vault and someone who borrowed an unlocked laptop should not be able to
mint one. Same reasoning as requiring a code to disable 2FA.

---

## 5. Sessions: rotation and reuse detection

The original design was a single 15-minute JWT. That number is a compromise
between two failures, and it is bad at both: long enough that a stolen token is
useful, short enough that real users get interrupted mid-task.

You cannot tune your way out of that. You have to split the credential:

- **Access token** — stateless JWT, 10 minutes, sent with every request
- **Refresh token** — 32 random bytes, 14 days, stored server-side as a SHA-256
  hash, used only to obtain a new access token

Now the short lifetime costs nothing (the client refreshes silently) and the
long-lived half is **revocable**, because there is a row for it.

### Rotation alone does not stop theft

Every refresh consumes its token and issues a new one. That sounds sufficient
until you trace an actual theft:

1. Attacker steals refresh token `R`
2. Attacker uses `R` first, gets `R2`, carries on indefinitely
3. Victim later tries `R`, gets rejected, shrugs, logs in again

Rotation detected nothing. But look at step 3 — a **spent token was presented
again**. That cannot happen in normal operation. A client that has just rotated
has no reason to replay the old one.

So a spent token coming back is evidence that two parties hold the same
credential. The server cannot tell which is the thief. The only safe response is
to distrust both.

### Families

Every token descended from one login shares a `family_id`. Reuse anywhere in the
chain revokes the entire family — **including the token that is currently valid.**
Attacker and victim are both forced back to the master password, which the
attacker does not have.

This answers a question that recurs across the whole project: *what does this
state belong to?* An individual token's lifetime is one refresh. The family's
lifetime is one login session. "This session is compromised" is a fact about the
session, so revocation state belongs on the family.

### Absolute expiry, not sliding

On rotation, the new token inherits the **original** `expires_at` rather than
getting a fresh 14 days. Sliding expiry feels friendlier and is a common mistake:
it lets a stolen family be renewed forever. The family dies 14 days after login
regardless of activity.

---

## 6. Two-factor authentication protects less than it appears to

TOTP was the last security feature added, and the interesting part is not the
implementation — it is being precise about what it does.

The instinct is that 2FA protects the vault. It does not, and it cannot.

The vault is sealed under a key derived from the master password, which the
server never sees. A server-side check cannot gate a key that never arrives. An
attacker who has the master password *and* a database dump can derive the KEK
offline and unwrap the DEK, with no server involved and therefore no TOTP prompt.

What 2FA actually gates is **the encrypted blobs**. Without a valid code, a
stolen password cannot log in, so it cannot download `wrappedDek` and the vault
items in the first place. No ciphertext, no offline attack.

That is genuinely valuable. It is just not "2FA protects your vault," and the
distinction is the sort of thing worth being able to state clearly.

It also has a hard consequence: **nothing in the key hierarchy may derive from the
TOTP secret.** TOTP is symmetric — the server holds the same secret the phone
does, necessarily in plaintext. Mixing it into key derivation would put a
server-known value under the vault and destroy §1.

### One error for two failures

A wrong TOTP code returns the same `INVALID_CREDENTIALS` as a wrong password.

The friendlier alternative — a distinct `INVALID_TOTP_CODE` — is an oracle. It
confirms the password was correct. An attacker working through a
credential-stuffing list learns exactly which passwords are live without ever
getting in, and can focus phishing or SIM-swap effort on precisely those accounts.

This is a real trade. The cost is a worse error message for legitimate users who
mistype a code, and plenty of production systems choose the other way. It was
chosen deliberately rather than by default.

---

## 7. The same crypto, twice

The client is a browser, so there are two implementations: Node's `crypto` for the
server and tests, WebCrypto plus `hash-wasm` in the browser. A vault encrypted by
one must open under the other, or the product does not work.

They are not assumed compatible — they are verified against shared test vectors,
generated from the Node implementation and checked by the browser suite.

That has caught two real problems.

**WebCrypto appends the GCM authentication tag to the ciphertext; Node returns it
as a separate value.** Same algorithm, same key, same nonce, different output
shape. Without byte-level vectors this would have shipped and appeared as "some
vaults mysteriously fail to decrypt." The browser implementation splits the last
16 bytes back out to match the wire format.

**Padding changed the wire format**, and the browser test failed on a vector
generated before the change — correctly, because a pre-padding ciphertext has no
length prefix and unpadding it reads four plaintext bytes as a length.

The second one exposed a process gap worth recording: the generator wrote only
the server's copy of the vectors, and the browser's copy had to be updated by
hand. A manual step gets forgotten, and then the test that exists to prove the
two implementations agree is comparing against a stale snapshot instead. The
generator now writes both.

The general lesson: **when two implementations must agree, test that they agree —
do not test each one separately and assume.**

---

## 8. Hiding length, and only partly

AES-GCM output is exactly as long as its input. So a database dump reveals
roughly how long every stored password is, and "short" is a useful thing for an
attacker to know when deciding where to spend effort.

Items are padded into power-of-two buckets from 256 bytes before encryption:

```
[4-byte big-endian length][plaintext][zero bytes to the bucket boundary]
```

The length prefix is what makes the padding removable. Trailing zeros alone would
be ambiguous with a plaintext that genuinely ends in zeros — there is a test for
exactly that case. The prefix sits **inside** the encryption, so it leaks nothing.

**This reduces the leak; it does not eliminate it.** A 6-character password and a
200-character passphrase both land in the first bucket and are indistinguishable.
But an observer can still tell which of nine buckets an item falls into, which in
practice mostly distinguishes "has notes" from "doesn't."

Eliminating it entirely means padding everything to the largest bucket and paying
64 KB per item. That was judged not worth it, and the residual leak is documented
rather than glossed.

Padding is applied in `encryptItem`, deliberately not in `encryptBytes` — the DEK
wrappers go through the same low-level function and are always exactly 32 bytes.
There is nothing to hide, and padding them would have changed the format of every
existing account's `wrapped_dek`.

---

## 9. Concurrency: check-then-act

The same bug shape appeared three times in this project, and it is worth its own
section because it is invisible in single-threaded testing.

The tempting way to make a token single-use:

```js
const row = await findByHash(hash);
if (row.used_at) throw new Error('already used');   // check
await markUsed(row.id);                             // act
```

Two concurrent requests carrying the same token both run the `SELECT` before
either runs the `UPDATE`. Both see `used_at` as null. Both proceed. Reuse
detection detects nothing, and the attacker and victim each get a valid session.

The fix is to make the check part of the write, so the database serialises it:

```sql
UPDATE refresh_tokens SET used_at = now()
WHERE id = $1 AND used_at IS NULL
RETURNING id
```

Exactly one caller gets a row back from `RETURNING`. The other gets nothing — and
**"nothing" is the reuse signal.**

The same pattern guards TOTP time-step consumption and backup-code redemption.
All three live in a `WHERE` clause, not in JavaScript.

---

## 10. Where state belongs

The most transferable lesson from building this, and one learned the hard way
four separate times: **state belongs with the thing whose lifetime it shares.**

| Bug | Wrong home | Right home |
|---|---|---|
| Clipboard clear timers | A `useRef` per row | Module level — the system clipboard is global |
| Vault selection | `VaultLayout`, which unmounts on tab switch | `App`, which does not |
| A half-typed entry | `ItemDetail`, same problem | Keep the component mounted, hide with CSS |
| Token refresh guard | Per request | Module level — the refresh token is shared |

The clipboard one is the clearest. Each vault row tracked its own 30-second clear.
Copy from row A, then row B five seconds later, and row A's timer fires at t=30 —
wiping row B's password 25 seconds early. Per-component state cannot coordinate
access to a resource the whole application shares.

The token refresh case is the same shape with sharper teeth: several requests
401ing together would each fire their own refresh, each replaying the same token,
and the application would trip **its own reuse detection** and log itself out. All
callers now await a single in-flight promise.

A related instance appeared later in the generator handoff. `VaultLayout` opened a
new entry whenever a forged password existed with nothing selected — but nothing
cleared the password, so every close reopened the panel, forever, surviving even
a lock. The cycle broke by consuming the value at the moment of handoff rather
than watching for it downstream.

---

## 11. Transactions belong to services, not repositories

Two repository functions originally wrapped a single `UPDATE` in a transaction.
That buys nothing — one statement is already atomic — but it actively blocked
something that mattered.

Changing a master password must do two things together: write the new credentials
and revoke every existing session. If they are separate, a crash between them
leaves an account with a new password and live old sessions — precisely the state
the change was meant to end.

That requires one transaction spanning both. But the repository already owned its
own, and `pg` does not nest transactions: the inner `BEGIN` warns and the inner
`COMMIT` commits the outer one early.

So repositories now take an optional client and open nothing:

```js
function q(client) { return client || db; }
```

Only the service knows which writes must land together. A repository that opens
its own transaction cannot be composed with anything else.

### The exception that proves it

`refresh()` revokes a compromised token family and then throws a 401. Both are
correct — the caller must be rejected *and* the family must die — but they want
opposite outcomes from the same transaction. The throw triggers a rollback, which
undid the revocation.

The symptom was maddening: the log line printed (`console.warn` is not
transactional) while the database was unchanged.

Revocation now commits in its own transaction, deliberately outside the one that
is about to roll back. **Audit and revocation writes on a failure path cannot
share the transaction that is about to be undone.** The same trap catches failed
login counters and lockout tracking.

---

## 12. What the client has to do, because the server can't

Zero-knowledge moves work to the browser that would normally live server-side.
Two features make this concrete.

**Duplicate entry names** are blocked client-side because the server has no idea
what an entry is called. It stores an opaque blob. The check is case-insensitive
and excludes the entry being edited from comparing against itself.

**Reused passwords** can only be *warned* about, and only for items currently
loaded. Two identical passwords encrypt to completely different bytes, because
every encryption gets a fresh nonce — that is the design working correctly, and
it also means the server could not compare them if it wanted to. With pagination,
a reuse on page two would go undetected.

The warning is amber and does not block the save. Reuse is a bad idea rather than
an error, and there are legitimate cases: two accounts on one service, a shared
household login.

This is the honest cost of the architecture. A conventional password manager can
run breach checks, deduplicate, and search server-side. This one cannot do any of
it, and pretending otherwise would mean weakening §1.

---

## 13. Password strength: rejecting composition rules

The first implementation scored passwords by entropy: charset size to the power of
length. It is the obvious formula and it is backwards.

It rated `Password1!` highly — four character classes, ten characters — and
`correct horse battery staple` poorly, because lowercase-only means a small
charset. The formula measures **the alphabet**, not the guessability.

zxcvbn replaced it: dictionary matching against ~30,000 words, keyboard-adjacency
graphs, date detection, repeat detection, and l33t-speak unmunging, so `P@ssw0rd`
scores as `password` and `qwertyui` scores as a keyboard walk.

The signup policy therefore has **no composition rules** — no "must contain an
uppercase letter and a symbol." NIST removed those from SP 800-63B for a reason:
users satisfy each rule in the cheapest way available, and the result is
`Password1!` at scale. The policy is a length floor plus a guessability score,
and the email is passed in so a password built from the user's own details is
penalised.

A related decision: a request came up to replace a 16-word blocklist with the 200
most common passwords. The right answer was neither. A substring blocklist plays
whack-a-mole with an infinite space and misses everything one character off the
list; a model that scores guessability covers the same ground properly and deletes
the list entirely.

---

## 14. Mistakes worth recording

A clean design document implies the design arrived clean. It did not. These are
real, and each taught something.

**A cleanup function that aborted halfway.** `lock()` zeroed the DEK, cleared the
items, then called `setemail(null)` — lowercase `e`, where the setter was
`setEmail`. The `ReferenceError` aborted the rest of the function, so
`clearToken()` never ran. The vault appeared locked while the session JWT stayed
live in memory. **Partial cleanup is worse than none, because it looks complete.**

**An animation that had never once run.** The unlock screen held ACCESS GRANTED
for 700 ms before entering the vault. It never did: `login()` set the DEK,
`isUnlocked` flipped, and the router replaced the whole screen in the same render
— tearing out the component before a frame drew. Proving it took setting the
animation to 20 seconds and observing that it was *still* instant. **When
something is instant at 20 seconds, the element is not slow; it is gone.**

**A route that discarded what the service returned.** Refresh tokens were
implemented, tested, and returned by `authService.login`, then dropped by a route
handler that destructured four named fields and rebuilt the response. Destructuring
silently discards what it does not name. The fix kept the explicit allowlist rather
than spreading the whole object — a passthrough that occasionally leaks an
internal field is a worse failure than one that occasionally needs updating.

**A stylesheet nobody noticed.** Vite's template `index.css` was still imported
months in, quietly applying a purple accent theme, `#root { text-align: center }`,
and 56px headings. Its symptoms had been patched one screen at a time for weeks
before the cause was found.

**A test that passed for the wrong reason.** A test asserting "a wrong password
fails even with a valid TOTP code" was returning 401 — from replay protection,
because enrolment had consumed the code, not from the wrong password it claimed to
test. It would have passed with the password check entirely removed.

**A server that exited silently.** Adding an hourly token sweep, the interval was
`unref()`'d so it would not hold the process open at shutdown. But the HTTP
server handle was the only other thing keeping Node alive, and the reasoning
applied to the timer was wrong in context: the process exited cleanly a few
seconds after boot, with exit code 0 and no error. The tests never caught it
because they import `app.js` directly and never run `server.js`.

**`position: fixed` that wasn't.** The delete confirmation centred on the 380px
detail panel instead of the viewport. A transformed ancestor — the panel's
entrance animation — becomes the containing block for fixed positioning. The
modal is now portalled to `document.body`.

**A meter that claimed 100% for nothing.** An empty vault reported perfect health,
because the "nothing weak in it" reasoning was sound and the conclusion was not.
It now renders nothing when there is nothing to measure.

The general habit these produced: **check that a value actually arrived; do not
infer it from a passing test.** After adding anything exported,
`node -e "console.log(Object.keys(require('./src/PATH')))"` takes two seconds and
turns a confusing twelve-failure run into a non-event.

And a second: **when a diagnostic produces nothing, doubt the diagnostic first.**
Two long debugging detours came from a `console.error` that was in a function that
was not running, and from a browser extension flooding the console so the real
error could not be seen.

---

## 15. What I would do differently

**Rate limiting is in-memory.** Counters reset on restart and are not shared
across instances. Two containers means two independent limits. Redis is the
answer, and it was scoped out.

**The client crypto is not audited.** Argon2id via `hash-wasm` in a browser is
slower and more variable than native code, and 128 MiB is a lot to allocate on a
low-end phone. A production version would measure on real devices and probably
lower the memory cost with eyes open rather than by accident.

**`/api/user/kdf-params` is an enumeration oracle.** It 404s for unknown emails
and reveals whether an account has 2FA. Closing it properly means a two-step login
with a separate pending-2FA token — a whole extra credential type, judged not
worth it here, but it is a real weakness and it is rate limited rather than
solved.

**The least-privilege database role is documented but not the default.** Wiring it
into the container setup requires splitting role creation from the grants, since
init scripts run before the tables exist. The SQL is there; compose still connects
as `postgres`.

**No responsive layout.** Documented rather than hidden, but on a portfolio piece
that someone may open on a phone, it is the most visible gap.

**No email confirmation on recovery.** The endpoint cannot be authenticated, so
the only real defence against the denial-of-service case is confirming out of
band. That means an email pipeline, which was out of scope.

---

## 16. What this project is not

It is an educational implementation. It has not been independently audited, it has
never been attacked by anyone competent, and it should not hold real credentials.

The cryptographic primitives are standard and used in standard ways, which is the
easy part. The hard part of shipping a real password manager is everything around
them: key rotation at scale, secure sync across devices, browser extension attack
surface, supply-chain integrity of the client bundle, and the operational
discipline to keep all of it true over years.

What this project demonstrates is that the design is understood well enough to
build, to attack in tests, and to explain — including the parts that are wrong.