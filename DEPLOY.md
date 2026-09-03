# Deploying the public demo

How to put Citadel Zero on a single Ubuntu VPS behind HTTPS, as a demo
instance that wipes itself nightly.

**This deployment is a portfolio demo, not a service.** It advertises that on
every screen, gives each visitor a private throwaway vault rather than a shared
account, and deletes every account once a day. Nothing here is suitable for real credentials, and the
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
| `seed` | built from `Server/` | — | one shot: no-op, kept so compose still starts |
| `wipe` | built from `Server/` | — | sleeps until 03:00 UTC and wipes; no reseed |

Caddy is the only container that publishes a port. Postgres and Redis are
reachable only from inside the compose network.

---

## 1. Provision

2 GB / 2 vCPU is the floor, and anything smaller will not work — see
[capacity](#capacity-and-why-the-rate-limits-are-low). In practice 4 GB is what
you will end up with: the container limits total roughly 1.5 GB before the host
and the Docker daemon, and the build peak is higher still, since Vite and the
`argon2` native compile are the hungriest things that ever run on the box. As of
2026 the cheapest Hetzner shared-vCPU plan (CX23, €5.49/mo) ships 4 GB anyway,
so the headroom costs nothing. Add swap regardless.

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

**Add swap.** With Argon2id running at 64 MiB per login verification, a burst of
logins can push a small box into the OOM killer, and the process it picks is
usually Postgres. 2 GB of swap turns that into slowness instead of an outage:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Swap is an emergency reserve here, not a working tier, so drop the desktop
default that swaps eagerly:

```bash
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl --system
```

**Confirm the host clock is UTC.** The wipe schedule is expressed in UTC, and a
host on local time will fire it at the wrong hour:

```bash
timedatectl   # Time zone should read Etc/UTC (UTC, +0000)
```

Disable password SSH once your key works — in a second session, while the first
one is still open:

```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

---

## 2. DNS

Point an A record at the server. Either an apex record:

```
Type  Name              Value
A     @                 YOUR_SERVER_IP
```

or a subdomain, if you want the root free for something else:

```
Type  Name              Value
A     demo              YOUR_SERVER_IP
```

Whichever you choose, `DOMAIN` in `.env.prod` must match it exactly — the
Caddyfile has a single site block, so only that one hostname is served. A `www`
record pointing here would resolve to a host Caddy has no block for, and it
would burn ACME attempts failing to get a certificate for it.

**Do not add an AAAA record** unless you have confirmed Docker publishes
Caddy's ports on IPv6. Let's Encrypt prefers IPv6 when an AAAA exists; if the
v6 path does not work, validation fails while a perfectly good A record sits
unused.

**Wait for it to resolve before starting the stack.** Caddy asks Let's Encrypt
for a certificate on its first boot; if DNS is not live yet the challenge fails,
and repeated failures hit a rate limit that will lock you out of issuing for
that name for an hour.

```bash
dig +short demo.example.com
dig +trace demo.example.com | tail -5   # what the CA will actually see
dig CAA demo.example.com +short         # must be empty, or list letsencrypt.org
```

Only continue once the first prints your server's IP.

It is worth proving port 80 is reachable from outside before Caddy ever runs,
since that is the other half of the challenge:

```bash
cd /tmp && echo ok > ping.txt && python3 -m http.server 80
# from elsewhere: curl http://demo.example.com/ping.txt
```

---

## 3. First deploy

```bash
su - deploy
git clone https://github.com/Umer-Saleh/Citadel-Zero.git
cd Citadel-Zero
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Generate three separate secrets:

```bash
for n in POSTGRES_PASSWORD APP_DB_PASSWORD JWT_SECRET; do
  echo "$n=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"
done
```

`openssl` rather than `node`, because the host runs Docker and nothing else —
there is no Node on it. Same 48 bytes, same base64url alphabet.

Edit `.env.prod` and set every value: the three secrets above, `DOMAIN`,
`ACME_EMAIL`, and `DEMO_EMAIL` / `DEMO_PASSWORD`.

- `ACME_EMAIL` **must not be blank.** An empty value is not "no contact
  address" — it makes Caddy's `email` directive argument-less, which fails to
  parse and crash-loops the container.
- `DEMO_PASSWORD` is **not a secret**. It is printed on the unlock screen and
  compiled into the public JavaScript bundle. Never reuse a real password.
- The three secrets must be **three different values**. Different blast radius
  each: `POSTGRES_PASSWORD` is the superuser used only by migrations,
  `APP_DB_PASSWORD` is the least-privilege role the API runs as, `JWT_SECRET`
  signs access tokens.

Check the file parses and every variable resolved before spending a rate limit
on finding out:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config | grep -E 'DOMAIN|ACME_EMAIL'
```

Bring it up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The first build compiles `argon2` from source. Budget several minutes on 2 vCPU;
a faster box with a warm BuildKit cache does it in well under a minute.

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
cd ~/Citadel-Zero
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Migrations run automatically as their own service, and the server waits for them
to *complete* rather than merely start. The grants re-apply on every deploy,
which is how a table added by a new migration gets picked up. `seed` does
nothing at all now — visitors provision their own vaults — but it still runs and
still exits 0, because compose declares the service.

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

Docker's json-file driver grows without bound, and Caddy writes an access line
per request. Cap it before it matters:

```bash
# /etc/docker/daemon.json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

---

## 6. The nightly wipe

The `wipe` container sleeps until `WIPE_HOUR_UTC` (default 03:00) and deletes
every account. A single `DELETE FROM users` clears everything because all three
child tables cascade — which also means it runs under the same least-privilege
role as the API, needing no elevation.

**It no longer reseeds anything, so a successful wipe ends with an empty
database.** That is the expected outcome, not a failure. The log says so in
as many words; if you are reading `logs wipe` in the morning, "0 accounts" is
what a healthy night looks like. The next visitor to click "Start a demo vault"
creates one.

The scheduler is a shell loop rather than crond, because BusyBox crond wants to
run as root and this image runs as the unprivileged `node` user. It recomputes
its target from the real clock on every cycle, so a restart lands on the next
slot rather than drifting, and a long wipe does not push the following night
later.

`WIPE_ON_START=true` runs a wipe immediately at container start. Off by default,
deliberately: a redeploy should not destroy the instance's data as a side
effect. Useful for catching up a missed night, or for testing.

Run it by hand:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm wipe node scripts/wipe-demo.js
```

There is no reseed command any more. `seed` is a no-op kept only so the compose
service it belongs to still exits 0; running it by hand prints why and stops.

An advisory lock stops a manual run from interleaving with the scheduled one.

### If the wipe breaks something

The wipe is destructive by design, so the recovery path is a backup you took
first. Take one before any risky change:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db pg_dump -U postgres password_manager | gzip > backup-$(date +%F).sql.gz
```

`-T` is not optional. Without it Docker allocates a TTY and writes terminal
control characters into the stream, and you find out at restore time.

Restore:

```bash
gunzip -c backup-2026-08-23.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db psql -U postgres -d password_manager
```

Worth automating, an hour before the wipe, so there is always a pre-wipe
snapshot:

```
0 2 * * * /home/deploy/bin/backup-citadel.sh >> /home/deploy/backups/backup.log 2>&1
```

**If the site has no demo data**, that is not a fault to repair. After a wipe
the database is empty by design, and it stays that way until someone clicks
"Start a demo vault" on the unlock screen. Open the site and click it; if a
vault appears with five entries, the whole path is working.

**If the wipe container is crash-looping**, it will not take the site down — a
failed run logs and waits for the next slot rather than exiting. Stop it while
you investigate:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod stop wipe
```

**If the cascade assertion fires** (`cascade left rows behind`), a migration
added a table with a foreign key to `users` that lacks `ON DELETE CASCADE`. The
wipe deliberately refuses to continue rather than leave one user's rows on a
machine that advertises nightly deletion. Find the offender — `confdeltype`
should be `c` on every one of these:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec db psql -U postgres -d password_manager -c "
SELECT conrelid::regclass, conname, confdeltype
FROM pg_constraint
WHERE confrelid = 'users'::regclass AND contype = 'f';"
```

Then fix the migration, not production.

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
one is the constraint — it is real RAM and real CPU per request, on a box with a
couple of gigabytes of each.

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
- **A recovery kit issued before this deploy stops working.** Recovery now
  requires proof of possession of the recovery key, and accounts created
  earlier have no stored verifier — one cannot be derived server-side, since
  that needs the key itself. `/api/account/recover` refuses them, and
  `/api/account/recovery-material` returns 409 `RECOVERY_UNAVAILABLE` so the
  user is told at the start of the flow rather than after typing a key that
  cannot work. The master password still opens those vaults; issuing a new kit
  from Settings restores recovery. This self-heals here within a day, because
  the nightly wipe deletes every account and any vault provisioned afterwards
  always has a verifier.
- **Anyone can create demo vaults, without limit.** Each one costs two Argon2id
  derivations in the visitor's browser and three 64 MiB Argon2 operations on the
  API, and nothing caps how many a single address may create beyond the auth
  rate limit. The nightly wipe bounds how long they accumulate. Per-visitor
  quotas are the proper fix and are not implemented yet.
- **The CSP allows a WebAssembly compile and inline style attributes.**
  `'wasm-unsafe-eval'` is what lets hash-wasm derive an Argon2id key at all, and
  `style-src-attr 'unsafe-inline'` is what lets React's `style={{}}` props
  render. Both are the narrow token; every other fetch directive is `'self'`,
  and the page loads nothing from a third-party origin.
- **HSTS is sent without `preload`.** Adding it commits the domain to a
  browser-baked list that is slow to leave. Add it only when you are sure every
  present and future subdomain will be HTTPS.
- **A wipe is skipped if the container is down across the slot.** The scheduler
  recomputes its target from the real clock each cycle, so a restart lands on
  the next slot without drifting — but if the container is not running *at*
  `WIPE_HOUR_UTC:00`, because a host reboot or redeploy spanned that minute, the
  loop resolves to tomorrow and that night is skipped silently. The window is a
  minute wide and the consequence is that a day of visitor vaults survives an
  extra day, so this is accepted rather than fixed; persisting the last-run
  timestamp would be the fix. `logs wipe | grep '\[wipe\]'` shows whether last night's run
  happened, and a missed night can be caught up with the manual run above.
- **`TRUST_PROXY` is a hop count, not a list.** It is set to 1, meaning exactly
  one proxy — Caddy. Putting a CDN or another reverse proxy in front without
  raising it makes the rate limiter key on the wrong address, and every visitor
  shares one bucket.
- **Swap is unencrypted.** Anything that was in the server's memory can land on
  disk, including material the process had decrypted. `chmod 600` keeps it away
  from other local users, and for a demo holding invented data that is enough.
  A real deployment would use `dm-crypt` swap with a random key at boot, or no
  swap and more RAM.
- **There is no offsite backup.** The `pg_dump` above writes to the same disk.
  For a demo that deletes itself nightly this is deliberate, not an oversight.
