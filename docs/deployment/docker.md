# Docker deployment

ScoutIQ ships as **one application image** running three roles, plus stock
PostgreSQL, Redis and (optionally) pgAdmin. Nothing is installed on the host
except Docker Engine and the Compose plugin - no Node.js, no Python, no
PostgreSQL client, no Playwright dependencies (§6).

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build of the application image |
| `docker-compose.yml` | Environment-neutral base stack |
| `docker-compose.dev.yml` | Development overrides (live reload, published ports) |
| `docker-compose.prod.yml` | Production overrides (limits, replicas, logging, backup sidecar) |

## Services

```
migrate     one-shot: applies migrations + SQL views, then exits
web         Next.js UI and REST API              (scales horizontally)
worker      imports, analytics, exports, PDF     (scales horizontally)
scheduler   registers the repeatable jobs        (exactly one)
postgres    PostgreSQL 17                        (replaceable by an external database)
redis       Redis 7                              (replaceable by an external Redis)
pgadmin     optional admin UI                     profile: admin
backup      periodic pg_dump                      profile: backup (prod file)
```

`migrate` is its own service on purpose: several `web` replicas can never race
each other over the schema. `scheduler` is deliberately a single replica,
because the schedules live in Redis and must be registered once.

## First run

```bash
cp .env.example .env

# Real secrets - never the placeholders
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f web
```

Create the first account and load the demo league:

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='a-strong-password' \
  web seed

docker compose run --rm web demo
docker compose run --rm web analytics
```

Check health - it reports which mounts the container actually received:

```bash
curl -s http://127.0.0.1:3000/api/health | jq
```

## Roles the image can run

The entrypoint selects a role from the command:

```bash
docker compose run --rm web migrate     # apply migrations
docker compose run --rm web seed        # admin user + system roles
docker compose run --rm web demo        # import the demo league
docker compose run --rm web analytics   # recompute analytics
docker compose run --rm web backup      # database backup
docker compose run --rm web bash        # anything else
```

## Development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Source is bind-mounted and the web and worker processes reload on change.
PostgreSQL and Redis are published on `127.0.0.1` so psql, DBeaver and Prisma
Studio can reach them.

## pgAdmin (§75)

```bash
docker compose --profile admin up -d
```

Then http://127.0.0.1:5050, connecting to host `postgres`, port `5432`.
pgAdmin is optional: the database is equally usable from psql, DBeaver or
DataGrip.

## Health checks and restarts (§71, §72)

Every service declares a health check, and production services use
`restart: unless-stopped`:

| Service | Check |
| --- | --- |
| `web` | `GET /api/health?probe=live` (does not touch the database) |
| `worker` | the worker process is running |
| `postgres` | `pg_isready` |
| `redis` | `redis-cli ping` |

`GET /api/health` (without `probe=live`) reports database, Redis and storage,
plus the optional archive targets - which are reported but never fail the check.

## Volumes (§70)

| Volume | Holds |
| --- | --- |
| `postgres_data` | The live database - always on the VM's own disk |
| `redis_data` | Queue state |
| `pgadmin_data` | pgAdmin settings |
| Bind: `${HOST_DATA_ROOT}:/data` | Raw datasets, exports, reports, backups |

Only one host path matters: `HOST_DATA_ROOT`. It may be a relative path, a local
SSD, a mounted disk, a NAS mount or VPS block storage - the application cannot
tell the difference.

```env
HOST_DATA_ROOT=/srv/scoutiq/data
```

Inside the container the layout comes from `DATA_ROOT`, `RAW_DATA_ROOT`,
`NORMALIZED_DATA_ROOT`, `PROCESSED_DATA_ROOT`, `EXPORT_ROOT`, `REPORT_ROOT` and
`BACKUP_ROOT`. Point any of them at a different mount and the application
follows without a code change.

## Resource limits (§3, §59)

`docker-compose.prod.yml` is sized for 4 vCPU / 6 GB:

```env
POSTGRES_MEMORY_LIMIT=2G
API_MEMORY_LIMIT=1G
WORKER_MEMORY_LIMIT=1G
REDIS_MEMORY_LIMIT=320M
WORKER_CONCURRENCY=2
```

Give the VM more and raise them; nothing in the application assumes a value.

## Using an external database or Redis

Remove (or stop using) the bundled service and repoint the URL:

```env
DATABASE_URL=postgresql://scoutiq:secret@db.internal:5432/scoutiq?schema=public
REDIS_URL=redis://cache.internal:6379
```

The images are unchanged. This is the same mechanism that later allows
PostgreSQL, Redis and the workers to live on separate machines.

## Building for another host

```bash
docker build -t scoutiq:0.2.0 .
docker save scoutiq:0.2.0 | gzip > scoutiq-0.2.0.tar.gz   # copy to the VPS

# on the target:
gunzip -c scoutiq-0.2.0.tar.gz | docker load
SCOUTIQ_IMAGE=scoutiq:0.2.0 docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The image contains no host-specific configuration, so the same tarball runs on
the Hyper-V VM and on the VPS. **A migration never requires rebuilding.**

## Reverse proxy

`web` binds to `127.0.0.1:3000` in production. Terminate TLS in a reverse proxy
so certificates and domains stay outside the application - see
[remote-access.md](remote-access.md) for LAN and
[production-vps.md](production-vps.md) for the internet.
