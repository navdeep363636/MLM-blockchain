# Database setup — MySQL on port 8084 (Docker + phpMyAdmin)

Two ways in. The first is the real one; the second exists so you can look at the
schema in phpMyAdmin within a minute.

---

## 1. The proper path — one command

From `members-trail-api/`:

```bash
./scripts/setup-database.sh --start
```

That does, in order:

1. copies `env.local` → `.env` if you have no `.env` yet
2. reads `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` from `.env`
   (already set to `127.0.0.1:8084`, `root` / `admin123`, `members_trail`)
3. checks MySQL is reachable and prints its version
4. `CREATE DATABASE IF NOT EXISTS members_trail` (utf8mb4 / utf8mb4_unicode_ci)
5. `npm ci` if `node_modules` is missing
6. **runs the three migrations** — this is what creates all 60 tables, 54 foreign
   keys, 250 indexes, 8 views, 11 routines and 14 triggers
7. **runs the seed** — 83 rows of reference data, idempotent
8. verifies the object counts and fails loudly if any are missing
9. starts the API (`--start`), or tells you the command to start it

Without `--start` it stops after step 8. With `--fresh` it drops the database
first. It is safe to re-run: migrations already applied are skipped, and the seed
creates 0 rows the second time.

**If there is no `mysql` client on your PATH** the script detects the running
MySQL container and goes in via `docker exec` instead. (That branch is written but
I could not exercise it from here — if it misidentifies the container, install the
client with `sudo apt-get install -y mysql-client` and re-run.)

### Two things it needs

- **Redis** on `127.0.0.1:6379`. The seed writes platform configuration, which
  invalidates cached values, so it refuses to run without Redis rather than
  leaving a stale cache. If it is not up the script stops with exactly that
  message.
- **The staff password.** There is no default. Either export
  `SEED_ADMIN_PASSWORD=…` before running, or a strong one is generated and
  printed **once** — copy it from the output. It is not stored anywhere else.

---

## 2. The shortcut — import the dump in phpMyAdmin

`scripts/members_trail_full.sql` (279 KB) is a complete dump taken from a database
built by those same migrations and seeded: schema, data, all 8 views, 11 routines
and 14 triggers, with `DEFINER` clauses stripped so it loads as any user.

In phpMyAdmin: create a database named `members_trail` (utf8mb4_unicode_ci) →
**Import** → choose the file → Go. Or from a shell:

```bash
mysql -h 127.0.0.1 -P 8084 -uroot -padmin123 \
  -e "CREATE DATABASE IF NOT EXISTS members_trail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -h 127.0.0.1 -P 8084 -uroot -padmin123 members_trail < scripts/members_trail_full.sql
```

The dump includes the `migrations` table with all three rows, so TypeORM knows the
migrations have run and `npm run start:dev` will not try to re-apply them.

**One caveat:** the staff accounts in the dump carry a password hash from the run
that produced it, and that plaintext is gone. Use this path to *look* at the
schema; when you need to sign in, `./scripts/setup-database.sh --fresh` and copy
the password it prints.

---

## Verifying it landed

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES   WHERE TABLE_SCHEMA='members_trail' AND TABLE_TYPE='BASE TABLE') AS tabs,
  (SELECT COUNT(*) FROM information_schema.VIEWS    WHERE TABLE_SCHEMA='members_trail') AS views,
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='members_trail') AS routines,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='members_trail') AS trigs,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='members_trail') AS fkeys;
```

Expected: `60 · 8 · 11 · 14 · 54`.

With the API running, the same check is served over HTTP:

```bash
curl -s localhost:4000/health/ready
```

`schema_objects` must read `views: 8, routines: 11, triggers: 14`. A half-migrated
database fails readiness rather than failing later on the first cron tick.

### Where to find things in phpMyAdmin

- **Views** appear in the table list with a different icon — `v_admin_kpis`,
  `v_commission_solvency`, `v_treasury_period`, `v_payout_ratio`, `v_points_drift`,
  `v_mtt_liability`, `v_member_signup_cohort`, `v_conversion_monthly`.
- **Routines** tab — `fn_month_key` plus ten `sp_*` procedures.
- **Triggers** tab — 14, all of them refusals. Try editing a `points_ledger` row in
  phpMyAdmin: it will refuse with `LEDGER_IMMUTABLE`. That is the design, not a
  fault; the API surfaces it as HTTP 409.

---

## If the API will not start

| symptom | cause |
| --- | --- |
| `Redis is not reachable at 127.0.0.1:6379` | start Redis |
| `ER_ACCESS_DENIED` / `ECONNREFUSED 8084` | the container's port is not published — check `docker ps` |
| `schema_objects` down in `/health/ready` | migrations did not finish; re-run with `--fresh` |
| `chain unreachable: no configured RPC endpoint answered` | expected. No RPC is configured yet; the chain layer is the one part not exercised against a live chain. |
| `relayer unhealthy: signer=false` | expected, same reason. |

Note the port variable is **`APP_PORT`**, not `PORT` — `PORT=3111 npm start` is
silently ignored. The API listens on 4000 by default.
