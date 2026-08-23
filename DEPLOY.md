# Deploying the public demo

How to put Citadel Zero on a single Ubuntu VPS behind HTTPS, as a demo
instance that wipes and reseeds itself nightly.

**This deployment is a portfolio demo, not a service.** It advertises that on
every screen, publishes the demo account's password, and deletes every account
once a day. Nothing here is suitable for real credentials, and the
[README's accepted limitations](README.md#accepted-limitations) say why.

Local development is unaffected by everything in this file — `docker-compose.yml`
still works exactly as the README describes.

---

## What runs

| Service | Image | Published | Notes |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | **80, 443** | TLS, Let's Encrypt, security headers |
| `web` | built from `Web/` | — | nginx serving the built frontend |
| `server` | built from `Server/` | — | API, connects as `citadel_app` |
| `db` | `postgres:17-alpine` | — | named volume `pgdata` |
| `redis` | `redis:7-alpine` | — | rate-limit counters, no persistence |
| `migrate` | built from `Server/` | — | one shot: migrations, then grants |
| `seed` | built from `Server/` | — | one shot: creates the demo account |
| `wipe` | built from `Server/` | — | sleeps until 03:00 UTC, wipes, reseeds |

Caddy is the only container that publishes a port. Postgres and Redis are
reachable only from inside the compose network.

---

## 1. Provision

A 2 GB / 2 vCPU box is enough. Anything smaller is not — see
[capacity](#capacity-and-why-the-rate-limits-are-low).

```bash
ssh root@YOUR_SERVER_IP
```

Create a non-root user and give it Docker:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Firewall — only SSH and the web ports:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

**Add swap.** With 2 GB and Argon2id running at 64 MiB per login verification, a
burst of logins can push the box into the OOM killer, and the process it picks is
usually Postgres. 2 GB of swap turns that into slowness instead of an outage:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Disable password SSH once your key works:

```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

---

## 2. DNS

Point an A record at the server:

```
Type  Name              Value
A     demo              YOUR_SERVER_IP
```

**Wait for it to resolve before starting the stack.** Caddy asks Let's Encrypt
for a certificate on its first boot; if DNS is not live yet the challenge fails,
and repeated failures hit a rate limit that will lock you out of issuing for
that name for an hour.

```bash
dig +short demo.example.com
```

Only continue once this prints your server's IP.

---

## 3. First deploy

```bash
su - deploy
git clone https://github.com/Umer-Saleh/Zero-Knowledge-Password-Manager.git
cd Zero-Knowledge-Password-Manager
cp .env.prod.example .env.prod
```

Generate three separate secrets:

```bash
for n in POSTGRES_PASSWORD APP_DB_PASSWORD JWT_SECRET; do
  echo "$n=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
done
```

Edit `.env.prod` and set every value: the three secrets above, `DOMAIN`,
`ACME_EMAIL`, and `DEMO_EMAIL` / `DEMO_PASSWORD`.

- `ACME_EMAIL` **must not be blank.** An empty value is not "no contact
  address" — it makes Caddy's `email` directive argument-less, which fails to
  parse and crash-loops the container.
- `DEMO_PASSWORD` is **not a secret**. It is printed on the unlock screen and
  compiled into the public JavaScript bundle. Never reuse a real password.

Bring it up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The first build takes several minutes — `argon2` compiles native code.

Check it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps -a
curl -sS https://demo.example.com/api/health
```

`-a`, not plain `ps`: `migrate` and `seed` run once and exit, and plain `ps`
hides them, so it looks like they never ran. Expect this:

```
caddy     running   0
db        running   0
migrate   exited    0     <- correct, one-shot
redis     running   0
seed      exited    0     <- correct, one-shot
server    running   0
web       running   0
wipe      running   0
```

A non-zero exit code on `migrate` or `seed` is the thing to investigate; both
are `restart: "no"`, so they will not retry on their own.

---

## 4. Redeploying after a push

```bash
cd ~/Zero-Knowledge-Password-Manager
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Migrations run automatically as their own service, and the server waits for them
to *complete* rather than merely start. The grants re-apply on every deploy,
which is how a table added by a new migration gets picked up. `seed` is a no-op
when the demo account already exists, so a redeploy never disturbs it.

### When you must rebuild the frontend from scratch

> **Vite inlines `VITE_*` values into the bundle at build time.** They are baked
> into the JavaScript, not read at runtime. The `web` image is therefore specific
> to one domain and one set of demo credentials.

If you change **`DOMAIN`**, **`DEMO_EMAIL`** or **`DEMO_PASSWORD`**, a plain
`up -d --build` may reuse a cached layer and keep serving the old values — the
site loads and every API call fails, or the unlock screen shows credentials that
no longer work. Force it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache web
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Changing `DOMAIN` also means a new certificate, so keep the `caddy_data` volume
and let Caddy request one for the new name.

---

## 5. Logs

```bash
# everything, following
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f

# one service
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f server
```

Worth knowing where to look:

| Question | Where |
|---|---|
| Did TLS work? | `logs caddy` — look for `certificate obtained successfully` |
| Did migrations apply? | `logs migrate` — ends `Migrations complete!` then `[grants] applied` |
| Is the least-privilege role in use? | `logs migrate` — `granted table privileges to citadel_app` |
| Did the demo seed? | `logs seed` — five `[seed] stored …` lines |
| When is the next wipe? | `logs wipe` — `[wipe-cron] next run in …` |
| Did last night's wipe run? | `logs wipe \| grep '\[wipe\]'` |

The API logs user **ids**, never email addresses. If you see an address in a log
line, that is a regression.

---

## 6. The nightly wipe

The `wipe` container sleeps until `WIPE_HOUR_UTC` (default 03:00), deletes every
account, and reseeds the demo one. A single `DELETE FROM users` clears everything
because all three child tables cascade — which also means it runs under the same
least-privilege role as the API, needing no elevation.

Run it by hand:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm wipe node scripts/wipe-demo.js
```

Reseed **without** wiping — safe, it exits immediately if the account exists:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm seed node scripts/seed-demo.js
```

An advisory lock stops a manual run from interleaving with the scheduled one.

### If the wipe breaks something

The wipe is destructive by design, so the recovery path is a backup you took
first. Take one before any risky change:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db pg_dump -U postgres password_manager | gzip > backup-$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c backup-2026-08-23.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db psql -U postgres -d password_manager
```

**If the demo account is simply missing** — the wipe ran but the reseed failed —
you do not need a backup. Nothing of value was lost; that is the entire premise
of a demo that wipes nightly. Just reseed:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm seed node scripts/seed-demo.js
```

**If the wipe container is crash-looping**, it will not take the site down — a
failed run logs and waits for the next slot rather than exiting. Stop it while
you investigate:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod stop wipe
```

**If the cascade assertion fires** (`cascade left rows behind`), a migration
added a table with a foreign key to `users` that lacks `ON DELETE CASCADE`. The
wipe deliberately refuses to continue rather than leave one user's rows on a
machine that advertises nightly deletion. Fix the foreign key.

---

## 7. Rotating secrets

`JWT_SECRET` — edit `.env.prod` and restart. Every existing access token becomes
invalid, so users are bounced to the unlock screen. Harmless here.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d server
```

`APP_DB_PASSWORD` is different, and it catches people out. It is read **once**,
at database initialisation, by `create-app-role.sh`. Editing `.env.prod` alone
changes the connection string but not the role, and the API then fails to
authenticate. Change both:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec db psql -U postgres -c "ALTER ROLE citadel_app WITH PASSWORD 'NEW_PASSWORD';"
# then set APP_DB_PASSWORD=NEW_PASSWORD in .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d server wipe
```

---

## Capacity, and why the rate limits are low

Every login costs **two** Argon2id derivations: 128 MiB in the browser, and 64 MiB
with 4 threads on the server, at the `argon2` library defaults. The server-side
one is the constraint — it is real RAM and real CPU per request, on a box with
2 GB of both.

So `AUTH_RATE_LIMIT_MAX` defaults to 6 per IP per 15 minutes here. That is as
much a capacity control as a security one, and it is why the `server` container
gets a 640 MB limit while `web` gets 48 MB.

If the demo feels sluggish under attention, raise the box before raising the
limit.

---

## What is still exposed

Stated plainly, because a runbook that implies everything is covered is worse
than one that does not.

- **Rate limits are per IP.** Redis makes the counters survive restarts and
  shared across instances; it does not help against a distributed source. Anyone
  with a proxy pool gets a multiple of the budget.
- **`/api/user/kdf-params` is an account-enumeration oracle.** It is rate
  limited, not fixed. See the README.
- **The demo account's password is public**, so that account has no
  confidentiality. It holds invented data.
- **Google Fonts is a third-party origin** in the CSP. Self-hosting the two
  families would let both `fonts.googleapis.com` and `fonts.gstatic.com` come
  out of the policy entirely, and is the one CSP improvement left.
- **HSTS is sent without `preload`.** Adding it commits the domain to a
  browser-baked list that is slow to leave. Add it only when you are sure every
  present and future subdomain will be HTTPS.
- **There is no offsite backup.** The `pg_dump` above writes to the same disk.
  For a demo that deletes itself nightly this is deliberate, not an oversight.
