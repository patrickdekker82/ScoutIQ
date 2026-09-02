#!/usr/bin/env bash
# Shared helpers for the ScoutIQ database scripts.
#
# Everything is derived from DATABASE_URL and BACKUP_ROOT, so the same script
# runs on a Hyper-V VM, a bare-metal server, a VPS, or inside a container.

set -euo pipefail

log()  { printf '[scoutiq] %s\n' "$*" >&2; }
fail() { printf '[scoutiq] ERROR: %s\n' "$*" >&2; exit 1; }

# Load .env from the repository root when present (never required: in
# production the environment is supplied by the container runtime).
#
# Variables already present in the environment WIN over the file, so
# `DATABASE_URL=... npm run db:restore` targets what the operator asked for -
# which is exactly how the migration runbook restores onto a second machine.
load_env() {
  local root="${1:-$PWD}"
  local file="$root/.env"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"          # trim leading whitespace
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    line="${line#export }"
    if [[ "$line" != *"="* ]]; then
      continue
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"             # trim trailing whitespace
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi
    if [[ -n "${!key+x}" ]]; then
      continue                                        # already set: do not override
    fi

    # Strip one layer of matching quotes, if present.
    if [[ ${#value} -ge 2 && ( "$value" == \"*\" || "$value" == \'*\' ) ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file"

  return 0
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

# Parse DATABASE_URL into PG* variables understood by pg_dump/pg_restore/psql.
# Accepts postgres:// and postgresql:// URLs with optional query parameters.
parse_database_url() {
  local url="${DATABASE_URL:-}"
  [[ -n "$url" ]] || fail "DATABASE_URL is not set (see .env.example)"

  local stripped="${url#*://}"
  local creds="" hostpart=""

  if [[ "$stripped" == *"@"* ]]; then
    creds="${stripped%%@*}"
    hostpart="${stripped#*@}"
  else
    hostpart="$stripped"
  fi

  local user="${creds%%:*}"
  local pass=""
  if [[ "$creds" == *":"* ]]; then
    pass="${creds#*:}"
  fi

  local hostport="${hostpart%%/*}"
  local dbpart="${hostpart#*/}"
  local db="${dbpart%%\?*}"

  local host="${hostport%%:*}"
  local pgport="5432"
  if [[ "$hostport" == *":"* ]]; then
    pgport="${hostport#*:}"
  fi

  # URL-decode the password (passwords routinely contain %-escapes).
  if [[ -n "$pass" ]]; then
    pass="$(printf '%b' "${pass//%/\\x}")"
  fi

  export PGHOST="$host"
  export PGPORT="$pgport"
  export PGUSER="${user:-postgres}"
  export PGDATABASE="${db:-postgres}"
  # A password is optional (trust/peer auth, ~/.pgpass, or a socket).
  if [[ -n "$pass" ]]; then
    export PGPASSWORD="$pass"
  fi

  # Explicit: a trailing conditional must not become this function's exit
  # status, or `set -e` would abort the caller.
  return 0
}

backup_root() {
  local root="${BACKUP_ROOT:-${DATA_ROOT:-/data}/backups}"
  mkdir -p "$root"
  printf '%s' "$root"
}

timestamp() { date -u +%Y%m%dT%H%M%SZ; }
