#!/usr/bin/env bash
#
# Restore a ScoutIQ backup into the database named by DATABASE_URL.
#
#   npm run db:restore                        # newest backup, prompts first
#   npm run db:restore -- path/to.dump
#   npm run db:restore -- --yes               # no prompt (automation)
#   npm run db:restore -- --clean             # drop existing objects first
#
# The target may be any PostgreSQL instance: the same dump restores on the home
# server and on a VPS. The source environment is never touched.

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
load_env "$REPO_ROOT"

ASSUME_YES=0
CLEAN=0
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --clean) CLEAN=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

require_cmd pg_restore
parse_database_url

if [[ -z "$TARGET" ]]; then
  ROOT="$(backup_root)"
  TARGET="$(find "$ROOT" -maxdepth 1 -name 'scoutiq-*.dump' -type f -print0 \
    | xargs -0 ls -1t 2>/dev/null | head -n1 || true)"
  [[ -n "$TARGET" ]] || fail "no backups found in $ROOT"
fi
[[ -s "$TARGET" ]] || fail "backup missing or empty: $TARGET"

# Always verify before overwriting a database.
"$SCRIPT_DIR/db-verify.sh" "$TARGET"

log "restore target: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "[scoutiq] This overwrites data in '$PGDATABASE'. Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "aborted by user"
fi

RESTORE_ARGS=(--dbname="$PGDATABASE" --no-owner --no-acl --single-transaction)
if [[ "$CLEAN" -eq 1 ]]; then
  RESTORE_ARGS+=(--clean --if-exists)
fi

pg_restore "${RESTORE_ARGS[@]}" "$TARGET" || fail "restore failed"

log "restore complete - run 'npm run db:migrate' to apply any newer migrations"
