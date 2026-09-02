#!/usr/bin/env bash
#
# Create a portable PostgreSQL backup of ScoutIQ.
#
#   npm run db:backup
#   npm run db:backup -- --label pre-migration
#
# Produces a custom-format dump (pg_restore-compatible) plus a SHA-256
# checksum under BACKUP_ROOT. The dump is restorable on ANY PostgreSQL
# instance of the same major version or newer - that is what makes the
# home -> VPS migration possible without rebuilding the application.

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
load_env "$REPO_ROOT"

LABEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --label=*) LABEL="${1#*=}"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

require_cmd pg_dump
require_cmd sha256sum
parse_database_url

ROOT="$(backup_root)"
NAME="scoutiq-${PGDATABASE}-$(timestamp)"
if [[ -n "$LABEL" ]]; then
  NAME="${NAME}-${LABEL//[^A-Za-z0-9_.-]/_}"
fi
DUMP="$ROOT/$NAME.dump"

log "backing up ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE} -> $DUMP"

# --format=custom: compressed and selectively restorable.
# --no-owner/--no-acl: the dump does not carry the source host's role names,
# so it restores cleanly under a different user on the target machine.
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$DUMP"

sha256sum "$DUMP" | awk -v n="$NAME.dump" '{print $1"  "n}' > "$DUMP.sha256"

SIZE="$(du -h "$DUMP" | cut -f1)"
log "backup complete ($SIZE)"

# Optional secondary copy (NAS, second disk, object-storage mount). Never
# fatal: the NAS is optional infrastructure.
if [[ -n "${ARCHIVE_ROOT:-}" ]]; then
  if mkdir -p "$ARCHIVE_ROOT/backups" 2>/dev/null && [[ -w "$ARCHIVE_ROOT/backups" ]]; then
    cp "$DUMP" "$DUMP.sha256" "$ARCHIVE_ROOT/backups/"
    log "archived to $ARCHIVE_ROOT/backups"
  else
    log "WARNING: ARCHIVE_ROOT ($ARCHIVE_ROOT) unavailable - local backup kept, archive skipped"
  fi
fi

# Retention pruning of local backups only; archived copies are left alone.
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
if [[ "$RETENTION" -gt 0 ]]; then
  find "$ROOT" -maxdepth 1 -name 'scoutiq-*.dump*' -type f -mtime "+$RETENTION" -print -delete \
    | sed 's/^/[scoutiq] pruned /' >&2 || true
fi

printf '%s\n' "$DUMP"
