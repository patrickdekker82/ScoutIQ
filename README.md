# ScoutIQ

A self-hosted football scouting and analytics platform. It combines open
datasets and commercial APIs into one canonical PostgreSQL database, then turns
that into player scouting, player DNA, role fits, similarity, club fit,
heatmaps, shot maps, tactical profiles and professional PDF reports.

Two principles shape everything:

1. **The database is the product.** PostgreSQL is not hidden behind an opaque
   structure. You can query, export, back up and restore it with any standard
   client, and ScoutIQ's own UI uses the same views you do.
2. **Nothing is a black box.** Every score records the metrics, weights, sample
   size, reference population and analytics version that produced it, and every
   imported row records which provider, version and import it came from.

It runs entirely inside a Debian VM under Hyper-V on existing home hardware,
and moves to a VPS later without an application change.

---

## Contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Installation](#installation)
- [Database access](#database-access)
- [Importing data](#importing-data)
- [Analytics](#analytics)
- [Heatmaps and visualisations](#heatmaps-and-visualisations)
- [Reports and PDF generation](#reports-and-pdf-generation)
- [Exports](#exports)
- [Backups, NAS and restore](#backups-nas-and-restore)
- [Providers and licensing](#providers-and-licensing)
- [Extending ScoutIQ](#extending-scoutiq)
- [Commands](#commands)
- [Documentation](#documentation)

---

## Architecture

```
FIREBAT A6 · Ryzen 7 7735HS · 16 GB · Windows 11 Pro
│
└── Hyper-V
    ├── Debian VM ── Minecraft server            (existing, untouched)
    │
    └── Debian VM ── ScoutIQ
        │
        └── Docker Compose
            ├── scoutiq-web        Next.js UI + REST API
            ├── scoutiq-worker     imports, analytics, exports, PDF
            ├── scoutiq-scheduler  repeatable jobs
            ├── postgres           canonical database
            ├── redis              queues + cache
            └── pgadmin            optional, --profile admin
                    │
                    ▼
                 DS920+   backups · raw datasets · reports · exports
```

Data flows one way:

```
provider → raw archive → normalised → canonical tables → derived analytics → UI / PDF / SQL
           (RAW_DATA_ROOT)            (provenance kept)   (analytics version stamped)
```

The web process never does heavy work: imports, analytics, exports and PDF
rendering all run in the worker. Nothing assumes the services share a machine,
so PostgreSQL, Redis or the workers can move to their own host by changing a
URL.

More detail: [docs/architecture.md](docs/architecture.md).

---

> **New to this?** [docs/INSTALLATIE.md](docs/INSTALLATIE.md) walks through
> installation and everyday use step by step, in Dutch, assuming no prior
> knowledge. The quick start below assumes you are comfortable with Docker.

## Quick start

Only Docker is required on the host - no Node.js, Python, PostgreSQL or
Playwright installation.

```bash
git clone https://github.com/patrickdekker82/ScoutIQ.git
cd ScoutIQ
cp .env.example .env

# Real secrets, never the placeholders
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Create the first account - ScoutIQ ships **no** default password:

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='a-strong-password' \
  web seed
```

Load the demo league so there is something to look at (§73 - no API keys, no
internet needed; everything it creates is labelled **DEMO DATA**):

```bash
docker compose run --rm web demo
docker compose run --rm web analytics
```

Open http://127.0.0.1:3000 and sign in.

```bash
curl -s http://127.0.0.1:3000/api/health | jq
```

---

## Installation

| Environment | Guide |
| --- | --- |
| Step by step, no prior knowledge (Dutch) | [docs/INSTALLATIE.md](docs/INSTALLATIE.md) |
| Windows 11 + Hyper-V host | [docs/deployment/windows11-hyperv.md](docs/deployment/windows11-hyperv.md) |
| Recommended VM settings | [docs/deployment/hyperv.md](docs/deployment/hyperv.md) |
| Debian/Ubuntu VM or server | [docs/deployment/debian-vm.md](docs/deployment/debian-vm.md) |
| Docker stack in detail | [docs/deployment/docker.md](docs/deployment/docker.md) |
| Production VPS | [docs/deployment/production-vps.md](docs/deployment/production-vps.md) |
| LAN and remote access | [docs/deployment/remote-access.md](docs/deployment/remote-access.md) |

The existing Minecraft VM is never modified: ScoutIQ runs in its own VM and the
two workloads stay isolated.

### Local development without Docker

Requires Node.js 22+ and a reachable PostgreSQL and Redis.

```bash
npm install
cp .env.example .env          # point DATABASE_URL / REDIS_URL at your instances
npm run db:migrate            # schema + views + materialized views
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='strong-password' npm run db:seed
npm run ingest:demo
npm run analytics:refresh

npm run dev                   # web
npm run worker                # workers, second terminal
npm run scheduler             # scheduled jobs, third terminal
```

### Database setup

`npm run db:migrate` applies two migrations: the schema (73 tables, 111
indexes) and the SQL objects (12 views, 5 materialized views). A fresh
PostgreSQL instance becomes a complete ScoutIQ database with no manual SQL.

```bash
npm run db:migrate       # apply migrations
npm run db:sql           # re-apply just the views (development)
npm run db:studio        # browse the data
```

---

## Database access

PostgreSQL is reachable with any standard client (§7, §8).

```bash
# psql, inside the stack
docker compose exec postgres psql -U scoutiq -d scoutiq

# psql, from the VM
psql "$DATABASE_URL"

# pgAdmin (§75)
docker compose --profile admin up -d      # http://127.0.0.1:5050

# DBeaver / DataGrip: host 127.0.0.1, port 5432, database scoutiq
# From another machine, tunnel rather than exposing the port:
ssh -L 5432:127.0.0.1:5432 scoutiq@your-vm
```

The **views** are the analyst-facing surface, with clean snake_case columns:

```sql
SELECT player_name, team_name, minutes, progressive_passes_p90
FROM vw_player_season_stats
WHERE position_group IN ('DM','CM','MF') AND minutes >= 450
ORDER BY progressive_passes_p90 DESC
LIMIT 50;
```

```sql
SELECT * FROM vw_player_club_fit ORDER BY fit_score DESC LIMIT 20;
```

The built-in **SQL console** (Data → SQL, Analyst/Admin) is SELECT-only,
enforced by a parser *and* a READ ONLY transaction, with CSV/JSON export,
timing, row counts, saved queries and history.

A full example library is in [docs/sql/README.md](docs/sql/README.md); the model
itself is documented in [docs/database/erd.md](docs/database/erd.md).

---

## Importing data

```bash
npm run ingest:demo                                          # synthetic league
npm run ingest:statsbomb -- --competition 11 --season 90      # StatsBomb open data
npm run ingest:skillcorner -- --matches 2                     # SkillCorner tracking
npm run ingest:metrica                                        # Metrica sample data
npm run ingest:csv                                            # files in RAW_DATA_ROOT/inbox
```

or from **Data → Run an import** in the UI, which queues the same job.

Every import:

1. archives the raw payload under `RAW_DATA_ROOT` (and, when configured, on the
   NAS) *before* parsing it, so any import can be replayed later;
2. converts provider coordinates to canonical metres (105 × 68);
3. resolves provider ids to ScoutIQ entities, recording the method and
   confidence used;
4. stamps every row with provider, provider version and import id.

Heavy imports run asynchronously and report progress under **Data → Jobs**.

---

## Analytics

```bash
npm run analytics:refresh                    # every season with data
npm run analytics:refresh -- --season <id>
npm run analytics:refresh -- --views-only
```

This computes, in order: player match metrics → season metrics → Player DNA →
role scores → similarity → team style → club fit, then refreshes the
materialized views.

- **Metrics** — passing, progression, creation, shooting, defending, duels and
  (where tracking exists) physical output, always per 90 alongside raw totals.
- **Normalisation** — raw, per 90, per possession, percentile and z-score, each
  against an explicit population: same season, same competition, same position
  group, minimum 450 minutes.
- **Player DNA** — 11 categories, 0-100, each a weighted average of percentiles,
  with every input metric and weight stored and shown on hover.
- **Roles** — 19 system roles held as database rows, not code. A new scouting
  model is an INSERT, not a redeploy.
- **Similarity** — weighted cosine over percentile vectors within a position
  group, returning where two players agree and where they differ most.
- **Team style** — 14 dimensions from possession to defensive compactness.
- **Club fit** — how much of what a team's style demands a player supplies.
  Presented everywhere as an analytical model, never as objective truth.
- **Data quality** — every metric carries minutes, matches, coverage and a
  confidence band. A metric whose source data is absent stays absent rather than
  silently becoming zero.

Every derived row stores its `analyticsVersion`, so formulas can change without
invalidating historical reports.

---

## Heatmaps and visualisations

ScoutIQ builds its own visualisations from canonical coordinates - never an
embedded provider image.

- **Heatmaps** — grid density, hexbin and Gaussian KDE, filtered by half,
  minute range, possession phase, event type, team or player, at adjustable
  resolution. Only the resulting grid crosses the wire, never the events.
- **Shot maps** — position, xG-scaled markers, outcome, body part.
- **Passing networks** — nodes sized by involvement, edges by pass volume.
- **Zones** — 3 thirds × 5 lanes, and a 5 × 4 tactical grid.
- **Tracking** — average positions, team width, depth, compactness, convex
  hull, line height and distance between lines, aggregated server-side.

---

## Reports and PDF generation

Generate from a player page, or:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/reports \
  -H 'content-type: application/json' \
  -d '{"playerId":"...","includePdf":true}'
```

Reports are rendered with Playwright from HTML/CSS - vector text, selectable
and searchable, with page numbers, methodology, data sources, data quality and
the analytics version. Not screenshots.

Blocks include: title, executive summary, identity, key metrics, percentiles,
DNA radar, heatmap, shot map, role profile, strengths, risks, club fit,
comparable players, scout notes and ratings, recommendation.

**Reproducibility.** Generating a report freezes the data it used into the
version row with a content-addressed snapshot id. Re-rendering that version
later produces a byte-identical document even after the analytics have been
recomputed with new formulas.

If Playwright has no browser available the HTML is still stored and the failure
is reported - a report is never lost to a missing browser. Point
`PDF_BROWSER_EXECUTABLE` at a system Chromium to avoid downloading one.

---

## Exports

CSV, JSON and SQL, from **Data → Export** or the command line:

```bash
npm run db:export -- --dataset players --format csv
npm run db:export -- --dataset events --format json
npm run db:export -- --sql "SELECT * FROM vw_player_season_stats" --format sql
```

Files are written to `EXPORT_ROOT` and archived to the NAS when configured.
Large exports can be queued as background jobs.

---

## Backups, NAS and restore

Three copies at all times: the live database, a local backup, and a NAS copy.

```bash
npm run db:backup                     # pg_dump + SHA-256 into BACKUP_ROOT
npm run db:backup -- --label weekly
npm run db:verify                     # checksum, table of contents, expected tables
npm run db:verify -- --deep           # plus a real restore into a scratch database
npm run db:restore                    # pg_restore (verifies first, prompts)
npm run db:restore -- --yes --clean
```

Dumps use `--no-owner --no-acl`, so a backup taken at home restores under a
different role on a VPS. That is what makes the migration work.

### NAS

The DS920+ is **optional infrastructure**. Mount it inside the Debian VM and
point the paths at it:

```env
NAS_BACKUP_PATH=/mnt/nas/scoutiq/backups
NAS_DATASET_PATH=/mnt/nas/scoutiq/datasets
NAS_REPORT_PATH=/mnt/nas/scoutiq/reports
```

If the NAS is switched off, unmounted or replaced, ScoutIQ keeps working and
only the archive copies are skipped - including `/api/health`, which reports the
archive state without failing. The live database is never placed on a network
share.

Setup: [docs/deployment/nas.md](docs/deployment/nas.md).
Restore procedure and philosophy: [docs/deployment/backups.md](docs/deployment/backups.md).

---

## Providers and licensing

| Provider | Kind | Needs a key | Capabilities |
| --- | --- | --- | --- |
| `scoutiq-demo` | Demo | No | Everything, fabricated and labelled DEMO DATA |
| `statsbomb-open` | Open data | No | Competitions, matches, lineups, events |
| `skillcorner-open` | Open data | No | Matches, players, 10 FPS tracking |
| `metrica-sample` | Open data | No | Matches, events, synchronised tracking |
| `csv-json` | File import | No | Teams, players, matches, events from `RAW_DATA_ROOT/inbox` |
| `sportmonks` | Commercial | `SPORTMONKS_API_KEY` | Competitions, teams, players, fixtures |
| `api-football` | Commercial | `API_FOOTBALL_KEY` | Competitions, teams, players, fixtures |

**Licensing is part of the registry.** Open availability is never assumed to
mean a right to redistribute or to use commercially: each provider declares its
licence, and Data → Providers shows it next to the import button. Check the
terms before exporting or sharing provider data.

API keys are read server-side only and never reach the browser.

To import without internet access, point a provider at a local or NAS copy:

```env
STATSBOMB_LOCAL_PATH=/mnt/nas/scoutiq/datasets/statsbomb-open-data/data
```

---

## Extending ScoutIQ

### Adding a provider

Implement the `FootballDataProvider` interface in `providers/`, declare your
capabilities, licence and coordinate system, and register it in
`providers/index.ts`. Methods you cannot serve throw `NotSupportedError` and the
pipeline records a warning rather than failing. Nothing else in the application
learns your provider's name.

### Adding a metric

1. Add the column to `PlayerSeasonMetric` in `prisma/schema.prisma`.
2. Derive it in `analytics/metrics.ts`.
3. Expose it in `vw_player_season_stats` and `vw_player_per90`.
4. Add it to `SEARCHABLE_METRICS` so search and filters can use it.
5. Bump `ANALYTICS_VERSION` if an existing formula changed.

### Adding a role

Roles are data. Insert a row and its requirements - no deploy:

```sql
INSERT INTO player_roles (id, key, name, "positionGroup", description, "minMinutes", "isSystem", "updatedAt")
VALUES (gen_random_uuid(), 'wide-target', 'Wide Target', 'FW', 'Holds the ball wide', 450, false, now());

INSERT INTO player_role_requirements (id, "playerRoleId", "metricKey", weight, direction)
SELECT gen_random_uuid(), id, 'aerialDuelWinRate', 0.5, 'HIGHER_BETTER' FROM player_roles WHERE key = 'wide-target'
UNION ALL
SELECT gen_random_uuid(), id, 'touchesFinalThirdP90', 0.5, 'HIGHER_BETTER' FROM player_roles WHERE key = 'wide-target';
```

Then `npm run analytics:refresh`.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `worker` / `scheduler` | Run the three roles locally |
| `npm run build` / `start` | Production build and server |
| `npm run typecheck` / `test` | TypeScript and the test suite |
| `npm run db:migrate` | Apply migrations, views and materialized views |
| `npm run db:seed` | Admin account and the 19 system roles |
| `npm run db:sql` | Re-apply the SQL views |
| `npm run db:backup` / `db:verify` / `db:restore` | Backup lifecycle |
| `npm run db:export` | CSV / JSON / SQL exports |
| `npm run ingest:demo` / `statsbomb` / `skillcorner` / `metrica` / `csv` | Imports |
| `npm run analytics:refresh` | Recompute analytics, refresh matviews |
| `npm run storage:init` | Create the storage tree, report mount status |

## API

Everything under `/api/v1` requires authentication; `/api/health` does not.

```
POST /api/v1/auth/login          GET  /api/v1/players          GET  /api/v1/players/:id
GET  /api/v1/players/:id/matches GET  /api/v1/players/:id/heatmap
GET  /api/v1/teams               GET  /api/v1/teams/:id
GET  /api/v1/matches             GET  /api/v1/matches/:id      GET  /api/v1/matches/:id/events
GET  /api/v1/metrics             GET  /api/v1/roles            GET  /api/v1/similarity
GET  /api/v1/club-fit            GET  /api/v1/search           GET  /api/v1/providers
GET  /api/v1/imports  POST       GET  /api/v1/jobs             POST /api/v1/sql
GET  /api/v1/exports  POST       GET  /api/v1/shortlists PUT   POST /api/v1/notes
GET  /api/v1/reports  POST       GET  /api/v1/reports/:id/document?format=pdf
POST /api/v1/analytics/recompute
```

---

## Documentation

| Document | |
| --- | --- |
| [docs/INSTALLATIE.md](docs/INSTALLATIE.md) | Step-by-step installation and use, in Dutch |
| [docs/architecture.md](docs/architecture.md) | Components, layers, scaling paths |
| [docs/database/erd.md](docs/database/erd.md) | Schema, relations, indexes, views |
| [docs/sql/README.md](docs/sql/README.md) | SQL access and an example library |
| [docs/deployment/windows11-hyperv.md](docs/deployment/windows11-hyperv.md) | Hyper-V host, alongside the Minecraft VM |
| [docs/deployment/hyperv.md](docs/deployment/hyperv.md) | Recommended VM settings |
| [docs/deployment/debian-vm.md](docs/deployment/debian-vm.md) | Debian/Ubuntu setup |
| [docs/deployment/docker.md](docs/deployment/docker.md) | Images, services, profiles |
| [docs/deployment/nas.md](docs/deployment/nas.md) | Optional DS920+ storage |
| [docs/deployment/backups.md](docs/deployment/backups.md) | Backup philosophy and restores |
| [docs/deployment/remote-access.md](docs/deployment/remote-access.md) | LAN, VPN, tunnels |
| [docs/deployment/migrate-home-to-vps.md](docs/deployment/migrate-home-to-vps.md) | 17-step migration runbook |
| [docs/deployment/production-vps.md](docs/deployment/production-vps.md) | Production VPS |
| [docs/deployment/rollback.md](docs/deployment/rollback.md) | Rollback procedures |
| [docs/PORTABILITY_AND_FUTURE_VPS_MIGRATION.md](docs/PORTABILITY_AND_FUTURE_VPS_MIGRATION.md) | The portability requirement |

## Tech stack

Node.js 22 · TypeScript · Next.js 16 · React 19 · Tailwind CSS 4 · Prisma ·
PostgreSQL 17 · Redis 7 · BullMQ · Playwright · Vitest · Docker.

## Licence

Private. Data imported from third-party providers remains subject to that
provider's licence - see Data → Providers in the application.
