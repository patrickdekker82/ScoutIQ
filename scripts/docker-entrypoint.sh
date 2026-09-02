#!/usr/bin/env bash
#
# Container entrypoint. Selects the role from the command:
#
#   api      - HTTP API (default)
#   worker   - queue workers (imports + analytics)
#   migrate  - apply Prisma migrations and exit
#   seed     - seed the database and exit
#   backup   - create a database backup and exit
#   <other>  - executed verbatim
#
# `migrate` is a separate role rather than something the API does at boot, so
# multiple API replicas can never race each other over the schema.

set -euo pipefail

wait_for_db() {
  local attempts="${DB_WAIT_ATTEMPTS:-30}"
  for ((i = 1; i <= attempts; i++)); do
    if node -e "
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      p.\$queryRaw\`SELECT 1\`.then(() => p.\$disconnect()).then(() => process.exit(0))
        .catch(() => process.exit(1));
    " >/dev/null 2>&1; then
      return 0
    fi
    echo "[scoutiq] waiting for database ($i/$attempts)..." >&2
    sleep 2
  done
  echo "[scoutiq] ERROR: database not reachable via DATABASE_URL" >&2
  return 1
}

case "${1:-api}" in
  api)
    wait_for_db
    exec node dist/main.js
    ;;
  worker)
    wait_for_db
    exec node dist/worker.js
    ;;
  migrate)
    wait_for_db
    exec npx prisma migrate deploy
    ;;
  seed)
    wait_for_db
    exec node dist/cli/seed.js
    ;;
  backup)
    exec bash scripts/db-backup.sh "${@:2}"
    ;;
  *)
    exec "$@"
    ;;
esac
