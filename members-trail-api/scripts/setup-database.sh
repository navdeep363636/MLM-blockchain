#!/usr/bin/env bash
# =============================================================================
# Members Trail API — one-command database setup.
#
#   ./scripts/setup-database.sh            # create DB, migrate, seed, verify
#   ./scripts/setup-database.sh --start    # …then start the API
#   ./scripts/setup-database.sh --fresh    # DROP the database first, then all of the above
#
# Idempotent: safe to re-run. Migrations already applied are skipped by TypeORM;
# the seed creates 0 rows on a second run.
#
# Reads connection settings from .env (falling back to env.local), so there is
# nothing to edit here. Nothing is created by `synchronize` — the schema, the
# 8 views, 11 routines and 14 triggers all come from migrations.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

START=false; FRESH=false
for arg in "$@"; do
  case "$arg" in
    --start)  START=true ;;
    --fresh)  FRESH=true ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# --- 1. Configuration -------------------------------------------------------
if [[ ! -f .env ]]; then
  if [[ -f env.local ]]; then
    echo "→ no .env found; copying env.local → .env"
    cp env.local .env
  else
    echo "✗ neither .env nor env.local is present. Cannot read DB settings." >&2
    exit 1
  fi
fi

get() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
DB_HOST="$(get DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(get DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(get DB_USER)"; DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(get DB_PASSWORD)"
DB_NAME="$(get DB_NAME)"; DB_NAME="${DB_NAME:-members_trail}"

echo "→ target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# --- 2. Pick a client -------------------------------------------------------
# The MySQL server may be in Docker with no client on the host. If `mysql` is
# missing we fall back to `docker exec` into the running MySQL container.
MYSQL_CMD=""
if command -v mysql >/dev/null 2>&1; then
  MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" --protocol=TCP)
elif command -v docker >/dev/null 2>&1; then
  CID="$(docker ps --filter 'ancestor=mysql' --format '{{.ID}}' | head -1)"
  [[ -z "$CID" ]] && CID="$(docker ps --format '{{.ID}} {{.Image}}' | grep -iE 'mysql|mariadb' | awk '{print $1}' | head -1)"
  if [[ -z "$CID" ]]; then
    echo "✗ no mysql client on PATH and no running MySQL container found." >&2
    echo "  Install one:  sudo apt-get install -y mysql-client" >&2
    exit 1
  fi
  echo "→ no mysql client on PATH; using docker exec into container ${CID}"
  MYSQL_CMD=(docker exec -i "$CID" mysql -u "$DB_USER" "-p${DB_PASSWORD}")
else
  echo "✗ neither the mysql client nor docker is available." >&2
  exit 1
fi

sql() { "${MYSQL_CMD[@]}" -N -B -e "$1" 2>&1 | grep -v '\[Warning\] Using a password' || true; }

# --- 3. Reachability --------------------------------------------------------
if ! sql "SELECT 1" | grep -q '^1$'; then
  echo "✗ cannot reach MySQL. Checked ${DB_HOST}:${DB_PORT} as ${DB_USER}." >&2
  echo "  If MySQL is in Docker, confirm the port is published:  docker ps" >&2
  exit 1
fi
echo "✓ MySQL reachable — $(sql 'SELECT VERSION()')"

# --- 4. Create the database -------------------------------------------------
if $FRESH; then
  echo "→ --fresh: dropping ${DB_NAME}"
  sql "DROP DATABASE IF EXISTS \`${DB_NAME}\`;"
fi
sql "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "✓ database ${DB_NAME} present"

# --- 5. Dependencies --------------------------------------------------------
if [[ ! -d node_modules ]]; then
  echo "→ installing dependencies (first run only)"
  npm ci --no-audit --fund=false
fi

# --- 6. Migrations ----------------------------------------------------------
echo "→ running migrations"
npm run --silent migration:run
echo "✓ migrations applied"

# --- 7. Seed ----------------------------------------------------------------
# Needs Redis. Set SEED_ADMIN_PASSWORD to choose the staff password yourself;
# otherwise a strong one is generated and printed once — copy it.
echo "→ seeding reference data"
npm run --silent seed
echo "✓ seed complete"

# --- 8. Verify --------------------------------------------------------------
echo "→ verifying schema objects"
COUNTS="$(sql "
SELECT CONCAT(
  'tables=', (SELECT COUNT(*) FROM information_schema.TABLES  WHERE TABLE_SCHEMA='${DB_NAME}' AND TABLE_TYPE='BASE TABLE'),
  ' views=',    (SELECT COUNT(*) FROM information_schema.VIEWS   WHERE TABLE_SCHEMA='${DB_NAME}'),
  ' routines=', (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${DB_NAME}'),
  ' triggers=', (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${DB_NAME}'),
  ' fks=',      (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='${DB_NAME}')
)")"
echo "  ${COUNTS}"
EXPECTED="tables=60 views=8 routines=11 triggers=14 fks=54"
if [[ "$COUNTS" == "$EXPECTED" ]]; then
  echo "✓ all schema objects present (${EXPECTED})"
else
  echo "⚠ expected: ${EXPECTED}"
  echo "  got:      ${COUNTS}"
  echo "  A mismatch means a migration did not finish. Re-run with --fresh." >&2
  exit 1
fi

echo
echo "Database ready. Open phpMyAdmin and select '${DB_NAME}'."
echo "  Views are under the table list; routines under the 'Routines' tab;"
echo "  triggers under 'Triggers'."
echo

if $START; then
  echo "→ starting the API (Ctrl-C to stop)"
  exec npm run start:dev
else
  echo "Start the API with:   npm run start:dev"
  echo "Then check:           curl -s localhost:4000/health/ready"
fi
