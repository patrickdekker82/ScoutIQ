# SQL access

PostgreSQL is a first-class ScoutIQ product, not an internal detail (§7). Every
number the UI shows can be reproduced with a query, and nothing is hidden behind
a proprietary structure.

## Connecting

| Client | How |
| --- | --- |
| psql | `psql "$DATABASE_URL"` |
| psql (in Docker) | `docker compose exec postgres psql -U scoutiq -d scoutiq` |
| pgAdmin | `docker compose --profile admin up -d`, then http://127.0.0.1:5050 |
| DBeaver / DataGrip | Host `127.0.0.1`, port `5432`, database `scoutiq` |
| Python | `psycopg.connect(os.environ["DATABASE_URL"])` |
| ScoutIQ UI | **Data → SQL** (SELECT-only, Analyst/Admin) |

PostgreSQL is not published to the internet. It listens on the compose network
and, in development, on `127.0.0.1`. For remote access, tunnel:

```bash
ssh -L 5432:127.0.0.1:5432 scoutiq@your-server
```

See [../deployment/remote-access.md](../deployment/remote-access.md).

## Two layers: tables and views

The base tables use Prisma's camelCase column names (`"playerId"`,
`"progressivePassesP90"`), which need double quotes in SQL.

The **views** are the analyst-facing surface and expose clean snake_case:

```sql
SELECT player_name, progressive_passes_p90 FROM vw_player_season_stats;
```

Query the views for analysis; query the tables when you need raw facts or
provenance.

## Views (§21)

| View | One row per | Use it for |
| --- | --- | --- |
| `vw_player_match_stats` | player × match | Match-by-match output |
| `vw_player_season_stats` | player × season | The main scouting table |
| `vw_player_per90` | player × season × metric | Tall form, easy to pivot |
| `vw_player_percentiles` | player × season × metric | Percentile + z-score with the population |
| `vw_team_match_stats` | team × match | Match performance |
| `vw_team_season_stats` | team × season | Season profile |
| `vw_match_summary` | match | Scoreline, xG, possession, PPDA |
| `vw_player_roles` | player × role | Role fit and its breakdown |
| `vw_player_similarity` | player pair | Similar players |
| `vw_team_style_profiles` | team × season | The 14 style dimensions unpacked |
| `vw_player_club_fit` | player × team | Fit score and its components |
| `vw_heatmap_zone_activity` | zone | Zone activity |

## Materialized views (§22)

`mv_player_season_metrics`, `mv_player_percentiles`, `mv_team_style_profiles`,
`mv_player_similarity`, `mv_heatmap_zone_stats`.

They carry the cost of percentile and similarity work so the UI does not pay it
per page load. Refresh them after an import:

```bash
npm run analytics:refresh              # recompute + refresh
npm run analytics:refresh -- --views-only
```

## Percentile populations are explicit (§26)

`vw_player_percentiles` states what a percentile was measured against:

```sql
SELECT player_name, metric_key, value, percentile, z_score,
       population_size, population_min_minutes, population_definition
FROM vw_player_percentiles
WHERE player_id = '...' AND metric_key = 'progressive_passes_p90';
```

Players below `population_min_minutes` (450) are excluded from the population,
because ranking a player on 90 minutes against one with 3000 is not a comparison.

## Example library (§24, §77)

### Top players per position

```sql
SELECT player_name, team_name, minutes, progressive_passes_p90
FROM vw_player_season_stats
WHERE position_group IN ('DF','MF')
  AND minutes >= 450
ORDER BY progressive_passes_p90 DESC
LIMIT 50;
```

### Top progressive passers, percentile form

```sql
SELECT player_name, position_group, value AS progressive_passes_p90, percentile
FROM vw_player_percentiles
WHERE metric_key = 'progressive_passes_p90'
ORDER BY percentile DESC
LIMIT 25;
```

### Best U21 players by expected goal involvement

```sql
SELECT player_name, age, team_name, minutes,
       xg_p90, xa_p90, (xg_p90 + xa_p90) AS xgi_p90
FROM vw_player_season_stats
WHERE age <= 21 AND minutes >= 450
ORDER BY xgi_p90 DESC
LIMIT 25;
```

### Highest xG forwards

```sql
SELECT player_name, team_name, shots_p90, xg_p90, xg_per_shot, goals_p90
FROM vw_player_season_stats
WHERE position_group = 'FW' AND minutes >= 600
ORDER BY xg_p90 DESC
LIMIT 25;
```

### Players fitting a custom role

Roles are rows, not code (§84), so you can query them directly:

```sql
SELECT player_name, role_name, score, confidence, sample_minutes
FROM vw_player_roles
WHERE role_key = 'ball-playing-centre-back'
  AND sample_minutes >= 900
ORDER BY score DESC
LIMIT 25;
```

Or build one inline without touching the database:

```sql
WITH weights(metric_key, weight) AS (
  VALUES ('progressive_passes_p90', 0.4),
         ('pass_accuracy',          0.3),
         ('aerial_duel_win_rate',   0.3)
)
SELECT p.player_name,
       round(sum(p.percentile * w.weight)::numeric, 1) AS custom_score
FROM vw_player_percentiles p
JOIN weights w USING (metric_key)
WHERE p.position_group = 'DF' AND p.minutes >= 900
GROUP BY p.player_name
ORDER BY custom_score DESC
LIMIT 25;
```

### Team tactical comparison

```sql
SELECT team_name, possession, build_up, directness, progression,
       high_press, counterpress, low_block, defensive_compactness
FROM vw_team_style_profiles
ORDER BY possession DESC;
```

### Player event distribution

```sql
SELECT e.type, count(*) AS events
FROM events e
WHERE e."playerId" = '...'
GROUP BY e.type
ORDER BY events DESC;
```

### Heatmap zone activity

```sql
SELECT zone_key, touches, passes, carries, shots, defensive_actions
FROM vw_heatmap_zone_activity
WHERE player_id = '...' AND zone_scheme = 'THIRDS_LANES'
ORDER BY touches DESC;
```

### Club fit for one player

```sql
SELECT team_name, fit_score, interpretation_note
FROM vw_player_club_fit
WHERE player_id = '...'
ORDER BY fit_score DESC;
```

### Where did this number come from? (§11)

```sql
SELECT e.id, e.type, e.minute, pr.key AS provider, pv.version,
       e."providerEventId", di.id AS import_id, di."startedAt", sd."storagePath"
FROM events e
JOIN providers pr        ON pr.id = e."providerId"
JOIN data_imports di     ON di.id = e."dataImportId"
JOIN provider_versions pv ON pv.id = di."providerVersionId"
LEFT JOIN source_datasets sd ON sd.id = di."sourceDatasetId"
WHERE e.id = '...';
```

## Exporting (§9, §78)

From the UI: **Data → Export**. From the command line:

```bash
npm run db:export -- --dataset players --format csv
npm run db:export -- --sql "SELECT * FROM vw_player_season_stats" --format json
```

Files land in `EXPORT_ROOT`. For a bulk dump, PostgreSQL's own COPY is fastest:

```bash
psql "$DATABASE_URL" -c "\copy (SELECT * FROM vw_player_season_stats) TO 'players.csv' CSV HEADER"
```

## Write access

The web SQL console is SELECT-only, enforced by a parser **and** by a READ ONLY
transaction. For write access use psql or another client directly - deliberately
a separate, conscious act.
