#!/usr/bin/env bash
#
# Verify a ScoutIQ backup.
#
#   npm run db:verify                    # verify the newest backup
#   npm run db:verify -- path/to.dump    # verify a specific file
#   npm run db:verify -- --deep          # also test-restore into a scratch DB
#
# Checks performed:
#   1. the file exists and is non-empty
#   2. the SHA-256 checksum still matches
#   3. pg_restore can read the archive's table of contents
#   4. the expected ScoutIQ tables are present in the dump
#   5. (--deep) a real restore into a temporary database succeeds
#
# Exit code 0 means the backup is restorable. Run this BEFORE decommissioning
# any environment.

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
load_env "$REPO_ROOT"

DEEP=0
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep) DEEP=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

require_cmd pg_restore

if [[ -z "$TARGET" ]]; then
  ROOT="$(backup_root)"
  TARGET="$(find "$ROOT" -maxdepth 1 -name 'scoutiq-*.dump' -type f -print0 \
    | xargs -0 ls -1t 2>/dev/null | head -n1 || true)"
  [[ -n "$TARGET" ]] || fail "no backups found in $ROOT"
fi

[[ -s "$TARGET" ]] || fail "backup missing or empty: $TARGET"
log "verifying $TARGET"

if [[ -f "$TARGET.sha256" ]]; then
  require_cmd sha256sum
  ( cd "$(dirname "$TARGET")" && sha256sum -c "$(basename "$TARGET").sha256" >/dev/null ) \
    || fail "checksum mismatch - backup is corrupt"
  log "checksum ok"
else
  log "WARNING: no .sha256 next to the dump; skipping checksum check"
fi

TOC="$(pg_restore --list "$TARGET")" || fail "pg_restore cannot read the archive"
log "archive readable ($(printf '%s\n' "$TOC" | grep -c 'TABLE DATA' || true) data sections)"

MISSING=()
for table in users players teams matches player_match_stats player_metrics scouting_reports; do
  printf '%s\n' "$TOC" | grep -q " $table " || MISSING+=("$table")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  fail "expected tables missing from dump: ${MISSING[*]}"
fi
log "schema contents ok"

if [[ "$DEEP" -eq 1 ]]; then
  require_cmd psql
  require_cmd createdb
  require_cmd dropdb
  parse_database_url

  SCRATCH="scoutiq_verify_$(date -u +%s)"
  log "deep verify: restoring into scratch database $SCRATCH"
  createdb "$SCRATCH" || fail "could not create scratch database (needs CREATEDB rights)"
  # shellcheck disable=SC2064
  trap "dropdb --if-exists '$SCRATCH' >/dev/null 2>&1 || true" EXIT

  pg_restore --dbname="$SCRATCH" --no-owner --no-acl --exit-on-error "$TARGET" \
    || fail "test restore failed"

  COUNT="$(psql --dbname="$SCRATCH" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [[ "$COUNT" -ge 8 ]] || fail "restored database has only $COUNT tables"
  log "deep verify ok ($COUNT tables restored)"
fi

log "BACKUP VERIFIED: $TARGET"
