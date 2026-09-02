# Database model

ScoutIQ's schema is normalised and query-friendly (§20): foreign keys, indexes,
unique constraints, timestamps, and JSONB only where the shape is genuinely
open (provider settings, score breakdowns, frozen report snapshots).

- 73 tables, 12 views, 5 materialized views
- Reproducible on any PostgreSQL instance with `npm run db:migrate`
- Every imported row carries provenance (§11)

## Provenance and ingestion

```mermaid
erDiagram
    providers ||--o{ provider_versions : "has"
    providers ||--o{ source_datasets : "publishes"
    providers ||--o{ data_imports : "runs"
    providers ||--o{ external_entity_mappings : "maps"
    provider_versions ||--o{ data_imports : "version used"
    source_datasets ||--o{ source_records : "contains"
    data_imports ||--o{ data_import_errors : "reports"
    data_imports ||--o{ source_records : "wrote"
    data_imports ||--o{ events : "produced"

    providers {
        string id PK
        string key UK
        enum   kind
        string licenseName
        bool   commercialUseAllowed
        bool   redistributionAllowed
    }
    data_imports {
        string id PK
        enum   status
        enum   trigger
        int    recordsWritten
        string rawPath "relative to RAW_DATA_ROOT"
    }
    external_entity_mappings {
        string providerId FK
        enum   entityType
        string externalId
        string internalId
        enum   method "PROVIDER_ID | EXACT | FUZZY | MANUAL"
        float  confidence
    }
```

Every fact answers "where did this number come from?": an event points at its
provider, provider version, import and the raw payload archived on disk.

## Football core

```mermaid
erDiagram
    countries ||--o{ competitions : "hosts"
    competitions ||--o{ competition_seasons : "has"
    competition_seasons ||--o{ matches : "contains"
    competition_seasons ||--o{ team_seasons : "has"
    competition_seasons ||--o{ player_seasons : "has"

    teams ||--o{ team_aliases : "known as"
    teams ||--o{ player_team_memberships : "employs"
    teams ||--o{ matches : "plays"

    players ||--o{ player_aliases : "known as"
    players ||--o{ player_positions : "plays"
    players ||--o{ player_matches : "appears in"

    matches ||--o{ match_periods : "split into"
    matches ||--o{ match_teams : "per team"
    matches ||--o{ match_officials : "officiated by"
    matches ||--o{ lineups : "fields"
    matches ||--o{ player_matches : "appearances"
    matches ||--o{ substitutions : "substitutions"
    matches ||--o{ events : "generates"

    players {
        string id PK
        string fullName "indexed"
        date   dateOfBirth "indexed"
        string positionGroup "indexed"
        enum   preferredFoot
        bool   isDemo
    }
    matches {
        string id PK
        datetime kickoffAt "indexed"
        string homeTeamId FK "indexed"
        string awayTeamId FK "indexed"
        int    homeScore
        int    awayScore
    }
```

## Events

One base table with the columns every event shares, plus typed detail tables for
the families that carry their own attributes. Coordinates are always canonical
metres (105 × 68) after the transformation layer (§33).

```mermaid
erDiagram
    events ||--o| pass_events : "detail"
    events ||--o| shot_events : "detail"
    events ||--o| carry_events : "detail"
    events ||--o| dribble_events : "detail"
    events ||--o| duel_events : "detail"
    events ||--o| tackle_events : "detail"
    events ||--o| interception_events : "detail"
    events ||--o| pressure_events : "detail"
    events ||--o| recovery_events : "detail"
    events ||--o| clearance_events : "detail"
    events ||--o| foul_events : "detail"
    events ||--o| card_events : "detail"
    events ||--o| goal_events : "detail"
    events ||--o| set_piece_events : "detail"
    events ||--o| touch_events : "detail"

    events {
        string id PK
        string matchId FK "indexed"
        string playerId FK "indexed"
        string teamId FK "indexed"
        enum   type "indexed with matchId"
        int    timestampMs "indexed"
        float  x "canonical metres"
        float  y
        string providerEventId "unique per provider"
    }
    shot_events {
        string eventId PK
        float  xg
        float  providerXg "as supplied, kept separate"
        bool   isGoal
        float  distanceM
        float  angleDeg
    }
```

## Tracking

```mermaid
erDiagram
    matches ||--o{ tracking_sessions : "has"
    tracking_sessions ||--o{ tracking_frames : "contains"
    tracking_sessions ||--o{ tracking_aggregates : "summarised as"
    tracking_frames ||--o{ tracking_player_positions : "positions"
    tracking_frames ||--o{ tracking_ball_positions : "ball"

    tracking_aggregates {
        string id PK
        string phase "ALL | IN_POSSESSION | OUT_OF_POSSESSION"
        float  teamWidthM
        float  teamDepthM
        float  compactness
        float  lineDistanceM
        float  highSpeedDistanceM
    }
```

Frames are stored so tracking is queryable in SQL, but the browser only ever
receives `tracking_aggregates` (§37, §59, §92).

## Derived analytics

```mermaid
erDiagram
    players ||--o{ player_match_metrics : "per match"
    players ||--o{ player_season_metrics : "per season"
    players ||--o{ player_style_profiles : "DNA"
    players ||--o{ player_role_scores : "role fit"
    players ||--o{ player_similarity : "similar to"
    players ||--o{ player_fit_scores : "club fit"
    teams ||--o{ team_match_metrics : "per match"
    teams ||--o{ team_season_metrics : "per season"
    teams ||--o{ team_style_profiles : "style"
    player_roles ||--o{ player_role_requirements : "weighted by"
    player_roles ||--o{ player_role_scores : "scored as"

    player_season_metrics {
        string id PK
        int    minutes
        float  progressivePassesP90
        float  xgP90
        json   totals "raw counts alongside rates"
        enum   confidence
        string analyticsVersion "§53"
    }
    player_role_scores {
        float  score
        bool   isPrimary
        json   breakdown "metric, percentile, weight, contribution"
        string analyticsVersion
    }
```

Every derived row records the `analyticsVersion` that produced it, so formulas
can evolve without invalidating historical output (§53), and every score stores
the breakdown that explains it (§85).

## Scouting, reports and audit

```mermaid
erDiagram
    users ||--o{ shortlists : "owns"
    users ||--o{ scouting_notes : "writes"
    users ||--o{ scout_ratings : "rates"
    users ||--o{ reports : "authors"
    users ||--o{ saved_queries : "saves"
    users ||--o{ audit_logs : "acts"
    shortlists ||--o{ shortlist_players : "contains"
    players ||--o{ shortlist_players : "listed on"
    reports ||--o{ report_versions : "versioned as"
    report_versions ||--o{ report_blocks : "composed of"

    report_versions {
        string id PK
        string dataSnapshotId "content hash"
        string analyticsVersion
        json   snapshot "frozen payload"
        string pdfPath "relative to REPORT_ROOT"
    }
    scout_ratings {
        int technical
        int tactical
        int physical
        int mental
        int potential
        int overall
    }
```

Human scout ratings live in their own table and never enter the automated
analytics without an explicit configuration (§49).

## Indexes (§60)

Beyond every primary and foreign key:

| Table | Index |
| --- | --- |
| `players` | `fullName`, `lastName`, `dateOfBirth`, `positionGroup`, `countryId` |
| `teams` | `name` |
| `matches` | `kickoffAt`, `homeTeamId`, `awayTeamId`, `(competitionSeasonId, kickoffAt)` |
| `events` | `matchId`, `playerId`, `teamId`, `timestampMs`, `(matchId, timestampMs)`, `(matchId, type)`, `(playerId, type)`, unique `(providerId, providerEventId)` |
| `player_match_metrics` | `playerId`, `matchId` |
| `player_season_metrics` | `(competitionSeasonId, positionGroup)`, `playerId` |
| `tracking_player_positions` | `trackingFrameId`, `playerId` |
| `external_entity_mappings` | unique `(providerId, entityType, externalId)`, `(entityType, internalId)` |
| `audit_logs` | `createdAt`, `actorId`, `(entityType, entityId)` |

## Regenerating this document

The schema is the source of truth:

```bash
npx prisma studio                 # browse it
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```
