# ScoutIQ

Self-hosted scouting analytics platform: import player and match data, compute
per-90 metrics and position-aware scout scores, and produce scouting reports.

**Design constraint:** ScoutIQ is fully portable between self-hosted
environments. The same images and the same Compose files run on a Debian VM
under Hyper-V, a physical Debian/Ubuntu server, a VPS, a cloud VPS, and a
future multi-server deployment. Moving between them never requires rebuilding
or rewriting the application - only a different `.env`.

The full requirement is in
[docs/PORTABILITY_AND_FUTURE_VPS_MIGRATION.md](docs/PORTABILITY_AND_FUTURE_VPS_MIGRATION.md),
and `tests/portability.test.ts` enforces the parts that can be checked
automatically.

## Quick start

Only Docker is required on the host - no Node.js, Python, PostgreSQL or
Playwright installation.

```bash
git clone https://github.com/patrickdekker82/ScoutIQ.git
cd ScoutIQ
cp .env.example .env

printf 'AUTH_SECRET=%s\n'       "$(openssl rand -hex 32)" >> .env
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> .env

docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Create the first account (there is no default):

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='a-strong-password' \
  api seed
```

```bash
curl -s http://127.0.0.1:3000/health/ready | jq
```

## Local development without Docker

Requires Node.js 22+, plus a reachable PostgreSQL and Redis.

```bash
npm install
cp .env.example .env      # point DATABASE_URL / REDIS_URL at your instances
npm run db:migrate
npm run db:seed
npm run dev               # API
npm run dev:worker        # workers, in a second terminal
```

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` / `dev:worker` | API / workers with live reload |
| `npm run build` / `start` / `start:worker` | Compile and run |
| `npm run typecheck` / `test` | TypeScript and unit tests |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed an admin user and a demo dataset |
| `npm run db:backup` | `pg_dump` to `BACKUP_ROOT` (+ SHA-256, + optional archive) |
| `npm run db:verify` | Verify a backup (`-- --deep` test-restores it) |
| `npm run db:restore` | `pg_restore` into `DATABASE_URL` |
| `npm run storage:init` | Create the storage tree and report mount status |

## Configuration

Everything environment-specific is an environment variable; the application
contains no hard-coded host paths, hostnames or IP addresses. See
[.env.example](.env.example) for the full contract.

```env
DATABASE_URL=postgresql://scoutiq:secret@postgres:5432/scoutiq?schema=public
REDIS_URL=redis://redis:6379

DATA_ROOT=/data
RAW_DATA_ROOT=/data/raw
EXPORT_ROOT=/data/exports
REPORT_ROOT=/data/reports
BACKUP_ROOT=/data/backups
```

Each root may be a local SSD, a mounted disk, a NAS mount, attached storage,
VPS block storage or an object-storage mount - the application cannot tell.

Never commit `.env`, API keys, database passwords, authentication secrets or
private certificates. `.gitignore` blocks them; the portability test asserts
that no `.env` is present in the tree.

## API

All endpoints under `/api/v1` require `Authorization: Bearer <token>` from
`POST /api/v1/auth/login`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live`, `/health/ready` | Liveness / dependency readiness |
| `POST` | `/api/v1/auth/login` | Obtain a token |
| `GET` | `/api/v1/auth/me` | Current user |
| `GET` | `/api/v1/players` | Search players (`search`, `position`, `season`, `minScore`) |
| `GET` | `/api/v1/players/:id` | Player with metrics and reports |
| `GET` | `/api/v1/players/:id/matches` | Per-match statistics |
| `GET` | `/api/v1/providers` | Configured data providers |
| `GET`/`POST` | `/api/v1/imports` | List runs / trigger an import (admin) |
| `POST` | `/api/v1/analytics/recompute` | Recompute metrics (admin) |
| `GET`/`POST` | `/api/v1/reports` | List / create scouting reports |
| `GET` | `/api/v1/reports/:id/document` | Rendered report from `REPORT_ROOT` |

## Data providers

Providers are pluggable and optional; enable them with `ENABLED_PROVIDERS`.

- **`local-file`** (default) - reads JSON drops from `<RAW_DATA_ROOT>/inbox`.
  The reference implementation, and the guarantee that ScoutIQ is useful with
  no third-party service at all.
- **`http-json`** - any endpoint returning `{ players, matchStats }`.
- **Ingest service** (optional, `--profile ingest`) - a containerised
  Playwright scraper that writes into the same inbox.

## Documentation

| Document | |
| --- | --- |
| [architecture.md](docs/architecture.md) | Components, layers, scaling paths |
| [deployment/windows11-hyperv.md](docs/deployment/windows11-hyperv.md) | Hyper-V host preparation |
| [deployment/debian-vm.md](docs/deployment/debian-vm.md) | Debian/Ubuntu server setup |
| [deployment/docker.md](docs/deployment/docker.md) | Images, Compose stack, overrides |
| [deployment/nas.md](docs/deployment/nas.md) | Optional Synology/NAS storage |
| [deployment/backup.md](docs/deployment/backup.md) | Backup philosophy and restores |
| [deployment/migrate-home-to-vps.md](docs/deployment/migrate-home-to-vps.md) | 17-step migration runbook |
| [deployment/production-vps.md](docs/deployment/production-vps.md) | Production VPS deployment |
| [deployment/rollback.md](docs/deployment/rollback.md) | Rollback procedures |

## Tech stack

Node.js 22 · TypeScript · Fastify · Prisma · PostgreSQL 17 · Redis 7 · BullMQ ·
Vitest · Docker. Optional ingest service: Python + Playwright.
