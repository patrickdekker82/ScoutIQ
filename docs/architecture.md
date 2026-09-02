# Architecture

ScoutIQ is a self-hosted scouting analytics platform. This document explains
the boundaries that exist so the system can move between machines - and later
be split across several - without an application rewrite.

## Components

```
                       reverse proxy (TLS)
                               │
                     scoutiq-web (Next.js)        stateless, N replicas
                               │
              ┌────────────────┼────────────────┐
              │                │                │
          PostgreSQL         Redis        storage roots
        (DATABASE_URL)   (REDIS_URL)    (DATA_ROOT & friends)
              │                │                │
              ├──── scoutiq-worker ─────────────┤   imports, analytics,
              │      N replicas                 │   exports, PDF rendering
              │                                 │
              └──── scoutiq-scheduler ──────────┘   exactly one replica
                               │
                    optional archive (NAS / object storage)
```

Every arrow crosses a URL or a path that comes from the environment. There is
no in-process coupling between the API and the workers, and no shared state
other than PostgreSQL, Redis and the storage roots.

## Layers

| Layer | Location | Depends on |
| --- | --- | --- |
| Configuration | `lib/config.ts` | the environment only |
| Infrastructure | `lib/`, `db/` | configuration |
| Analytics (pure) | `analytics/` | nothing - no I/O at all |
| Providers | `providers/` | storage / HTTP |
| Services | `server/services/` | Prisma, storage, providers |
| Queues & workers | `jobs/` | Redis, services |
| Reports | `reports/` | analytics, Playwright |
| UI and API | `app/`, `components/` | services |

`analytics/` is deliberately I/O-free: metrics, DNA, roles, similarity, team
style, club fit, heatmaps, zones and tracking aggregation are pure functions
over plain objects. That is what lets them be unit-tested exhaustively and run
wherever there is CPU - in the worker today, on another machine tomorrow.

## The single configuration rule

`lib/config.ts` is the only module that reads `process.env` (the seed CLI reads
its own `SEED_*` inputs, and the worker passes the environment to the backup
child process). Everything else receives configuration. A test
(`tests/portability.test.ts`) fails the build if that rule is broken, and the
same test rejects Windows paths, UNC shares, `/volume1/...` NAS paths and
hard-coded LAN IPs anywhere in the source.

## Storage

`lib/storage.ts` is the only module that touches the filesystem for
application data. It resolves every key against a configured root and refuses
absolute keys or traversal, so a provider or a report name can never escape
its root - which matters when the root is a network mount.

The archive root (typically the NAS) is *optional infrastructure*: every
archive call is best-effort and returns `null` when the target is unavailable.
The application never fails because a NAS is down.

## Scaling paths

| Change | How |
| --- | --- |
| More API capacity | `API_REPLICAS=n` - the API is stateless |
| More analytics capacity | `WORKER_REPLICAS=n` - BullMQ distributes jobs |
| Database on its own host | point `DATABASE_URL` elsewhere, drop the service |
| Redis on its own host | point `REDIS_URL` elsewhere, drop the service |
| Analytics off a replica | set `ANALYTICS_DATABASE_URL` |
| Object storage for archives | mount it, set `ARCHIVE_ROOT` |

None of these require a code change. They are not implemented as an MVP
feature - they are simply not blocked.

## Replaceability

| Concern | Default | Replaceable by |
| --- | --- | --- |
| Authentication | built-in scrypt + HMAC tokens | reverse-proxy auth, OIDC |
| Object storage | local/NAS filesystem | S3-compatible mount |
| Data providers | `local-file` | `http-json`, ingest service, your own |
| Email | none | any SMTP relay |
| Monitoring | `/health/*` endpoints | any uptime checker |
| Scheduling | Redis-backed repeatable jobs | host cron calling the API |

The core application runs completely self-hosted with none of the optional
pieces present.

## Request and job flow

**Import**: scheduler or API enqueues → worker picks it up → provider returns a
payload → raw payload written to `RAW_DATA_ROOT` (and best-effort archived) →
rows upserted through `ExternalRef`, so re-imports are idempotent and a
provider can be swapped without duplicating players.

**Analytics**: job per season → aggregate per player → build a comparison
population per position group → percentile-based `scoutScore` → upsert
`PlayerMetric`.

**Report**: API renders a Markdown document from pure functions → writes it to
`REPORT_ROOT` → stores only the *relative* key in the database, so moving the
report root never invalidates a row.
