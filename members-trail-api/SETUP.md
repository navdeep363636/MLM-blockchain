# Local setup — Members Trail API

Everything in `members-trail-api/` is the verified backend: 24 feature modules,
228 routes, **891 unit tests** and **69 end-to-end tests** passing — against
MySQL 8.0.46 on **port 8084** with `root` / `admin123`, the same engine, port and
credentials you described. The migrations and the seed have already been run that
way, so what follows is a rehearsal of a path that works.

What it still needs on your machine: dependencies, a database, and two commands.

Run the steps in order. Each one has a check so you know it worked before moving
on.

> **In a hurry?** `./scripts/setup-database.sh --start` does the whole database
> setup and starts the API in one command. `DATABASE_SETUP.md` explains it, plus a
> `scripts/members_trail_full.sql` dump you can import straight into phpMyAdmin if
> you just want to look at the schema now.

---

## 1. Prerequisites

```bash
node -v      # 20 or newer
npm -v
```

Your MySQL is already listening on 8084. Redis is **not** optional — it holds the
locks the crons take, the rate-limit counters and the idempotency reservations:

```bash
sudo apt install -y redis-server && sudo systemctl enable --now redis-server
```

**Check:**

```bash
redis-cli ping                 # PONG
sudo mysqladmin status         # Uptime: ...
```

---

## 2. Create the database

```bash
mysql -h 127.0.0.1 -P 8084 -u root -padmin123 <<'SQL'
CREATE DATABASE IF NOT EXISTS members_trail
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- The end-to-end suite clears its own database, so it gets a separate one.
CREATE DATABASE IF NOT EXISTS members_trail_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SQL
```

On MariaDB `utf8mb4_0900_ai_ci` does not exist — use `utf8mb4_general_ci`.

A note worth ten seconds of thought: `root` is fine for local work, and it is
what the shipped `env.local` uses because it is what you have. For anything
shared, give the API its own user with rights on these two schemas only — a
compromised API credential should not be able to drop other databases:

```sql
CREATE USER 'mtt'@'127.0.0.1' IDENTIFIED BY '<a password you generate>';
GRANT ALL PRIVILEGES ON members_trail.*      TO 'mtt'@'127.0.0.1';
GRANT ALL PRIVILEGES ON members_trail_test.* TO 'mtt'@'127.0.0.1';
FLUSH PRIVILEGES;
```

**Check:**

```bash
mysql -h 127.0.0.1 -P 8084 -u root -padmin123 -e "SHOW DATABASES LIKE 'members_trail%';"
# members_trail
# members_trail_test
```

---

## 3. Install and configure

```bash
cd members-trail-api
npm install
```

Create your `.env` from the generated one shipped alongside it:

```bash
cp env.local .env
```

(`env.local` exists under that name because a file called `.env` cannot be
written to your machine remotely — a sensible guard, since it is the one file
that holds secrets. Its contents are already filled in with development secrets
generated for this machine.)

It is already filled in for your setup: `DB_PORT=8084`, `DB_USER=root`,
`DB_PASSWORD=admin123`, `DB_NAME=members_trail`, and freshly generated secrets.
Nothing else needs changing to run locally.

Two lines matter before anyone else uses this instance:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — rotating them invalidates every
  session, so set them now rather than after people have signed in.
- `ENCRYPTION_KEY` — 64 hex characters. **Lose it and the encrypted columns are
  unreadable.** Back it up somewhere that is not this repository.

The file is git-ignored; keep it that way.

**Check:**

```bash
npm run typecheck    # silence means clean
```

---

## 4. Schema and seed

```bash
npm run migration:run
npm run seed
```

The seed is idempotent — running it twice creates nothing the second time. It
prints a **staff password once**; copy it somewhere before you close the
terminal, or set `SEED_ADMIN_PASSWORD=... npm run seed` to choose your own.

It creates four staff accounts (`ops@`, `compliance@`, `finance@`, `support@`
`memberstrail.local`), the policy rows, the conversion rate, the commission plan,
the game and store catalogue, the staking pools, and the eight legal documents as
**drafts in review** — nothing is published, because that is an attorney's call
in each jurisdiction.

**Check** — the object counts, not just the tables. Three migrations run: the
tables, the two-factor purpose, then the hardening pass that adds the foreign
keys, indexes, views, routines and triggers.

```bash
mysql -h 127.0.0.1 -P 8084 -u root -padmin123 members_trail -e "
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA='members_trail' AND TABLE_TYPE='BASE TABLE') AS tabs,
  (SELECT COUNT(*) FROM information_schema.VIEWS
    WHERE TABLE_SCHEMA='members_trail') AS views,
  (SELECT COUNT(*) FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA='members_trail') AS routines,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA='members_trail') AS trigs,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA='members_trail') AS fkeys;"
# tabs 60 · views 8 · routines 11 · trigs 14 · fkeys 54
```

If a count is short the migration did not finish — re-run it and read the error
rather than continuing. `/health/ready` checks these counts too, so a
half-migrated database fails the probe instead of failing later inside a cron.

---

## 5. Run it

```bash
npm run start:dev
```

- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/api/docs
- Health: http://localhost:4000/health/ready

**Check:** the startup log ends with `listening on port 4000`, and

```bash
curl -s localhost:4000/health/ready | head -c 200
curl -s localhost:4000/api/v1/games | head -c 200
```

The games call should return the eight seeded titles without a token — it is one
of the few public routes. Everything else answers 401 without one, by design.

---

## 6. Run the tests

```bash
npm test          # 891 unit tests, mocked repositories
npm run test:e2e  # 69 tests against real MySQL + Redis
```

The e2e suite uses `members_trail_test` (set in `test/setup.ts`), clears it before
and after each run, and runs the seed itself — so migrate that database once
first:

```bash
DB_NAME=members_trail_test npm run migration:run
```

Point it at a throwaway database only. It covers two things: the API through real
HTTP (`api.e2e-spec.ts`), and the database's own guarantees
(`database.e2e-spec.ts`) — every foreign key rule, every guard trigger's refusal,
each view's arithmetic and each procedure's behaviour, asserted against real
MySQL rather than a mock that would agree with anything.

---

## What is deliberately not wired

Three seams record what happened instead of pretending to succeed. Each is one
adapter away from working, and each is visible in the logs and the ops
dashboard:

| Seam | Current behaviour |
| --- | --- |
| Email / SMS delivery | Recorded `suppressed` with a reason. Never reported as sent. |
| Outbound webhooks | Recorded `failed` with the reason, on an exponential backoff. |
| Fiat payouts | Stay `processing` and appear in the ops queue. Never sent on chain. |

And the chain layer stays idle until the contracts are deployed: fill in
`MTT_TOKEN_ADDRESS`, `STAKING_ADDRESS`, `REFERRAL_DISTRIBUTOR_ADDRESS` and set
`INDEXER_ENABLED=true`. Until then the API runs fine — it simply mirrors no
on-chain events, and outbound transactions refuse to sign because no relayer key
is configured. Both are the correct defaults.

---

## Running it as a fleet later

One process is right for local work. In deployment the same build splits three
ways by environment variable alone:

| Role | `QUEUE_WORKERS_ENABLED` | `SCHEDULER_ENABLED` |
| --- | --- | --- |
| API (scale freely) | false | false |
| Workers (scale freely) | true | false |
| Scheduler | false | **true — exactly one deployment** |

Extra scheduler instances are safe but pointless: every cron takes a Redis lock
first, so the losers log `skipped — lock held`. More detail in `README.md`, and
the money rules and shared-file conventions in `BACKEND_CONVENTIONS.md`.

---

## The database is not just tables

The third migration adds 54 foreign keys, 24 indexes, 8 views, 11 stored
routines and 14 guard triggers. Two consequences you will meet in normal use:

**A 409 with a code like `LEDGER_IMMUTABLE` or `BALANCE_NEGATIVE` is a trigger
refusing a write.** That is the database enforcing an invariant — an append-only
Points ledger, a balance that cannot go negative, commission depth of three — for
every client, not only the code paths that remember to check. It is information,
not a bug.

**`Cannot delete or update a parent row` is a `RESTRICT` foreign key doing its
job.** The row you are deleting has financial or compliance history hanging off
it. Deal with the history explicitly rather than working around the constraint.

For retention or lawful erasure, the destructive guards yield to one declared
session variable:

```sql
SET @mt_maintenance = 1;   -- deliberate, one session only
-- … the deletion …
SET @mt_maintenance = 0;
```

`README.md` has the full inventory, what each view and procedure replaced, and
the measured effect of the indexes.
