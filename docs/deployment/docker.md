# Docker deployment

ScoutIQ ships as **one application image** (API and workers differ only by the
command) plus stock PostgreSQL and Redis images. Nothing needs to be installed
on the host except Docker Engine and the Compose plugin - no Node.js, no
Python, no PostgreSQL client, no Playwright dependencies.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build of the application image |
| `docker-compose.yml` | Environment-neutral base stack |
| `docker-compose.dev.yml` | Development overrides (live reload, published ports) |
| `docker-compose.prod.yml` | Production overrides (limits, replicas, logging, backup sidecar) |
| `services/ingest/Dockerfile` | Optional Playwright ingest service |

## Services

```
migrate   one-shot; applies Prisma migrations, then exits
api       HTTP API                        (scales horizontally)
worker    import + analytics queue workers (scales horizontally)
postgres  PostgreSQL 17                   (replaceable by an external database)
redis     Redis 7                         (replaceable by an external Redis)
ingest    optional Playwright scraper      profile: ingest
backup    optional periodic pg_dump        profile: backup (prod file)
```

`migrate` is a separate service on purpose: multiple `api` replicas can never
race each other over the schema.

## First run

```bash
cp .env.example .env

# Generate real secrets - never reuse the placeholders.
printf 'AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> .env

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f api
```

Check readiness - it reports which mounts the container actually received:

```bash
curl -s http://127.0.0.1:3000/health/ready | jq
```

## Development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Source is bind-mounted and both `api` and `worker` reload on change. PostgreSQL
and Redis are published on `127.0.0.1` so host tooling (psql, redis-cli, Prisma
Studio) can reach them.

## Seeding a fresh install

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='a-strong-password' \
  api seed
```

There is no default account baked into the image.

## Where the data lives

Only one host path matters: `HOST_DATA_ROOT`, mounted at `/data` inside every
container. It may be a relative path, a local SSD, a mounted disk, a NAS mount
or VPS block storage - the application cannot tell the difference.

```env
HOST_DATA_ROOT=/srv/scoutiq/data
```

Inside the container the layout is driven by `DATA_ROOT`, `RAW_DATA_ROOT`,
`EXPORT_ROOT`, `REPORT_ROOT` and `BACKUP_ROOT`. Point any of them at a
different mount and the application follows without a code change.

## Using an external database or Redis

Remove (or simply stop using) the bundled service and repoint the URL:

```env
DATABASE_URL=postgresql://scoutiq:secret@db.internal:5432/scoutiq?schema=public
REDIS_URL=redis://cache.internal:6379
```

The application images are unchanged. This is the same mechanism that later
allows PostgreSQL, Redis and the workers to live on separate machines.

## Building for another host

```bash
docker build -t scoutiq:0.1.0 .
docker save scoutiq:0.1.0 | gzip > scoutiq-0.1.0.tar.gz   # copy to the VPS
# on the target:
gunzip -c scoutiq-0.1.0.tar.gz | docker load
SCOUTIQ_IMAGE=scoutiq:0.1.0 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The image contains no host-specific configuration, so the same tarball runs on
the Hyper-V VM and on the VPS. **A migration never requires rebuilding.**

## Reverse proxy

The `api` service binds to `127.0.0.1:3000` in production. Terminate TLS in a
reverse proxy (Caddy, nginx, Traefik) so certificates and domains stay outside
the application. See [production-vps.md](production-vps.md).
