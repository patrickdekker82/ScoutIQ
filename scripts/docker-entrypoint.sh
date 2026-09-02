#!/usr/bin/env bash
#
# Container entrypoint. The command selects the role (§6):
#
#   web        - Next.js server (UI + API)
#   worker     - queue workers: imports, analytics, exports, reports
#   scheduler  - registers the repeatable jobs
#   migrate    - apply Prisma migrations and exit
#   seed       - seed the admin user and the system roles, then exit
#   demo       - import the demo league, then exit
#   backup     - create a database backup and exit
#   <other>    - executed verbatim
#
# `migrate` is its own role rather than something the web process does at boot,
# so multiple replicas can never race each other over the schema.

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

case "${1:-web}" in
  web)
    wait_for_db
    exec node server.js
    ;;
  worker)
    wait_for_db
    exec npx tsx jobs/worker-main.ts
    ;;
  scheduler)
    wait_for_db
    exec npx tsx jobs/scheduler-main.ts
    ;;
  migrate)
    wait_for_db
    exec npx prisma migrate deploy
    ;;
  seed)
    wait_for_db
    exec npx tsx scripts/seed.ts
    ;;
  demo)
    wait_for_db
    exec npx tsx scripts/ingest.ts demo
    ;;
  analytics)
    wait_for_db
    exec npx tsx scripts/analytics-refresh.ts "${@:2}"
    ;;
  backup)
    exec bash scripts/db-backup.sh "${@:2}"
    ;;
  *)
    exec "$@"
    ;;
esac
