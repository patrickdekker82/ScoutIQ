-- ============================================================================
-- ScoutIQ SQL objects: views (§21) and materialized views (§22)
--
-- The base tables use Prisma's camelCase column names. These views are the
-- analyst-facing surface and deliberately expose clean snake_case columns, so
-- pgAdmin/DBeaver/psql users never have to quote identifiers.
--
-- Re-apply at any time with:  npm run db:sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- vw_player_match_stats - one row per player per match, facts + metrics
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_match_stats AS
SELECT
    pm."playerId"                                   AS player_id,
    p."fullName"                                    AS player_name,
    p."positionGroup"                               AS position_group,
    pm."matchId"                                    AS match_id,
    pm."teamId"                                     AS team_id,
    t.name                                          AS team_name,
    m."kickoffAt"                                   AS kickoff_at,
    cs.id                                           AS competition_season_id,
    c.name                                          AS competition_name,
    cs."seasonName"                                 AS season_name,
    pm."minutesPlayed"                              AS minutes_played,
    pm."isStarter"                                  AS is_starter,
    pm.position                                     AS position,
    pmm.passes,
    pmm."passesCompleted"                           AS passes_completed,
    pmm."passAccuracy"                              AS pass_accuracy,
    pmm."progressivePasses"                         AS progressive_passes,
    pmm."passesFinalThird"                          AS passes_final_third,
    pmm."passesIntoBox"                             AS passes_into_box,
    pmm."keyPasses"                                 AS key_passes,
    pmm.carries,
    pmm."progressiveCarries"                        AS progressive_carries,
    pmm."progressiveActions"                        AS progressive_actions,
    pmm.touches,
    pmm."touchesFinalThird"                         AS touches_final_third,
    pmm."touchesBox"                                AS touches_box,
    pmm.shots,
    pmm."shotsOnTarget"                             AS shots_on_target,
    pmm.goals,
    pmm.xg,
    pmm.npxg,
    pmm.xa,
    pmm.assists,
    pmm.tackles,
    pmm.interceptions,
    pmm.pressures,
    pmm.recoveries,
    pmm.blocks,
    pmm.clearances,
    pmm."aerialDuels"                               AS aerial_duels,
    pmm."aerialDuelsWon"                            AS aerial_duels_won,
    pmm."analyticsVersion"                          AS analytics_version
FROM player_matches pm
JOIN players p             ON p.id = pm."playerId"
JOIN teams t               ON t.id = pm."teamId"
JOIN matches m             ON m.id = pm."matchId"
JOIN competition_seasons cs ON cs.id = m."competitionSeasonId"
JOIN competitions c        ON c.id = cs."competitionId"
LEFT JOIN player_match_metrics pmm
       ON pmm."playerId" = pm."playerId" AND pmm."matchId" = pm."matchId";

-- ---------------------------------------------------------------------------
-- vw_player_season_stats - season totals and rates with identity attached
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_season_stats AS
SELECT
    psm."playerId"                    AS player_id,
    p."fullName"                      AS player_name,
    p."dateOfBirth"                   AS date_of_birth,
    date_part('year', age(COALESCE(cs."endDate", now()), p."dateOfBirth"))::int AS age,
    p."preferredFoot"                 AS preferred_foot,
    p."heightCm"                      AS height_cm,
    co.name                           AS nationality,
    psm."teamId"                      AS team_id,
    t.name                            AS team_name,
    psm."competitionSeasonId"         AS competition_season_id,
    c.name                            AS competition_name,
    cs."seasonName"                   AS season_name,
    psm."positionGroup"               AS position_group,
    p."primaryPosition"               AS position,
    psm.minutes,
    psm.matches,
    psm.starts,
    psm."passesP90"                   AS passes_p90,
    psm."passAccuracy"                AS pass_accuracy,
    psm."progressivePassesP90"        AS progressive_passes_p90,
    psm."passesFinalThirdP90"         AS passes_final_third_p90,
    psm."passesIntoBoxP90"            AS passes_into_box_p90,
    psm."keyPassesP90"                AS key_passes_p90,
    psm."crossesP90"                  AS crosses_p90,
    psm."longPassesP90"               AS long_passes_p90,
    psm."progressiveCarriesP90"       AS progressive_carries_p90,
    psm."carriesFinalThirdP90"        AS carries_final_third_p90,
    psm."carriesIntoBoxP90"           AS carries_into_box_p90,
    psm."dribblesP90"                 AS dribbles_p90,
    psm."dribbleSuccessRate"          AS dribble_success_rate,
    psm."progressiveActionsP90"       AS progressive_actions_p90,
    psm."xaP90"                       AS xa_p90,
    psm."chancesCreatedP90"           AS chances_created_p90,
    psm."touchesP90"                  AS touches_p90,
    psm."touchesFinalThirdP90"        AS touches_final_third_p90,
    psm."touchesBoxP90"               AS touches_box_p90,
    psm."shotsP90"                    AS shots_p90,
    psm."shotsOnTargetP90"            AS shots_on_target_p90,
    psm."goalsP90"                    AS goals_p90,
    psm."xgP90"                       AS xg_p90,
    psm."npxgP90"                     AS npxg_p90,
    psm."xgPerShot"                   AS xg_per_shot,
    psm."assistsP90"                  AS assists_p90,
    psm."tacklesP90"                  AS tackles_p90,
    psm."tackleSuccessRate"           AS tackle_success_rate,
    psm."interceptionsP90"            AS interceptions_p90,
    psm."pressuresP90"                AS pressures_p90,
    psm."counterpressuresP90"         AS counterpressures_p90,
    psm."recoveriesP90"               AS recoveries_p90,
    psm."blocksP90"                   AS blocks_p90,
    psm."clearancesP90"               AS clearances_p90,
    psm."defensiveDuelsP90"           AS defensive_duels_p90,
    psm."defensiveDuelWinRate"        AS defensive_duel_win_rate,
    psm."aerialDuelsP90"              AS aerial_duels_p90,
    psm."aerialDuelWinRate"           AS aerial_duel_win_rate,
    psm."distanceP90"                 AS distance_p90,
    psm."highSpeedDistanceP90"        AS high_speed_distance_p90,
    psm."sprintCountP90"              AS sprint_count_p90,
    psm."maxSpeedMs"                  AS max_speed_ms,
    psm.totals,
    psm.confidence,
    psm."analyticsVersion"            AS analytics_version,
    psm."computedAt"                  AS computed_at
FROM player_season_metrics psm
JOIN players p              ON p.id = psm."playerId"
LEFT JOIN countries co      ON co.id = p."countryId"
LEFT JOIN teams t           ON t.id = psm."teamId"
JOIN competition_seasons cs ON cs.id = psm."competitionSeasonId"
JOIN competitions c         ON c.id = cs."competitionId";

-- ---------------------------------------------------------------------------
-- vw_player_per90 - tall form: one row per player/season/metric (§26)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_per90 AS
SELECT
    s.player_id,
    s.player_name,
    s.competition_season_id,
    s.season_name,
    s.competition_name,
    s.position_group,
    s.team_id,
    s.minutes,
    s.matches,
    m.metric_key,
    m.value,
    s.analytics_version
FROM vw_player_season_stats s
CROSS JOIN LATERAL (
    VALUES
        ('passes_p90',                s.passes_p90),
        ('pass_accuracy',             s.pass_accuracy),
        ('progressive_passes_p90',    s.progressive_passes_p90),
        ('passes_final_third_p90',    s.passes_final_third_p90),
        ('passes_into_box_p90',       s.passes_into_box_p90),
        ('key_passes_p90',            s.key_passes_p90),
        ('crosses_p90',               s.crosses_p90),
        ('long_passes_p90',           s.long_passes_p90),
        ('progressive_carries_p90',   s.progressive_carries_p90),
        ('carries_final_third_p90',   s.carries_final_third_p90),
        ('carries_into_box_p90',      s.carries_into_box_p90),
        ('dribbles_p90',              s.dribbles_p90),
        ('dribble_success_rate',      s.dribble_success_rate),
        ('progressive_actions_p90',   s.progressive_actions_p90),
        ('xa_p90',                    s.xa_p90),
        ('chances_created_p90',       s.chances_created_p90),
        ('touches_p90',               s.touches_p90),
        ('touches_final_third_p90',   s.touches_final_third_p90),
        ('touches_box_p90',           s.touches_box_p90),
        ('shots_p90',                 s.shots_p90),
        ('shots_on_target_p90',       s.shots_on_target_p90),
        ('goals_p90',                 s.goals_p90),
        ('xg_p90',                    s.xg_p90),
        ('npxg_p90',                  s.npxg_p90),
        ('xg_per_shot',               s.xg_per_shot),
        ('assists_p90',               s.assists_p90),
        ('tackles_p90',               s.tackles_p90),
        ('tackle_success_rate',       s.tackle_success_rate),
        ('interceptions_p90',         s.interceptions_p90),
        ('pressures_p90',             s.pressures_p90),
        ('counterpressures_p90',      s.counterpressures_p90),
        ('recoveries_p90',            s.recoveries_p90),
        ('blocks_p90',                s.blocks_p90),
        ('clearances_p90',            s.clearances_p90),
        ('defensive_duels_p90',       s.defensive_duels_p90),
        ('defensive_duel_win_rate',   s.defensive_duel_win_rate),
        ('aerial_duels_p90',          s.aerial_duels_p90),
        ('aerial_duel_win_rate',      s.aerial_duel_win_rate)
) AS m(metric_key, value);

-- ---------------------------------------------------------------------------
-- vw_player_percentiles - percentile + z-score within an EXPLICIT population
-- (same season, same competition, same position group, minimum minutes) (§26)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_percentiles AS
WITH qualified AS (
    SELECT *, 450 AS population_min_minutes
    FROM vw_player_per90
    WHERE minutes >= 450
),
ranked AS (
    SELECT
        q.*,
        round((percent_rank() OVER w * 100)::numeric, 1) AS percentile,
        avg(q.value)      OVER w AS population_mean,
        stddev_pop(q.value) OVER w AS population_stddev,
        count(*)          OVER w AS population_size
    FROM qualified q
    WINDOW w AS (
        PARTITION BY q.competition_season_id, q.position_group, q.metric_key
        ORDER BY q.value
    )
)
SELECT
    player_id,
    player_name,
    competition_season_id,
    season_name,
    competition_name,
    position_group,
    team_id,
    minutes,
    matches,
    metric_key,
    value,
    percentile,
    CASE
        WHEN population_stddev IS NULL OR population_stddev = 0 THEN 0
        ELSE round(((value - population_mean) / population_stddev)::numeric, 3)
    END AS z_score,
    population_size,
    population_min_minutes,
    'competition_season+position_group' AS population_definition,
    analytics_version
FROM ranked;

-- ---------------------------------------------------------------------------
-- vw_team_match_stats
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_team_match_stats AS
SELECT
    tmm."teamId"              AS team_id,
    t.name                    AS team_name,
    tmm."matchId"             AS match_id,
    m."kickoffAt"             AS kickoff_at,
    cs.id                     AS competition_season_id,
    c.name                    AS competition_name,
    cs."seasonName"           AS season_name,
    mt."isHome"               AS is_home,
    mt.formation,
    tmm.possession,
    tmm.passes,
    tmm."passAccuracy"        AS pass_accuracy,
    tmm."progressivePasses"   AS progressive_passes,
    tmm."finalThirdEntries"   AS final_third_entries,
    tmm."boxEntries"          AS box_entries,
    tmm.shots,
    tmm."shotsOnTarget"       AS shots_on_target,
    tmm.xg,
    tmm.goals,
    tmm.pressures,
    tmm."counterpressures",
    tmm.recoveries,
    tmm.tackles,
    tmm.interceptions,
    tmm."fieldTilt"           AS field_tilt,
    tmm.ppda,
    tmm.directness,
    tmm.crosses,
    tmm."analyticsVersion"    AS analytics_version
FROM team_match_metrics tmm
JOIN teams t                ON t.id = tmm."teamId"
JOIN matches m              ON m.id = tmm."matchId"
JOIN competition_seasons cs ON cs.id = m."competitionSeasonId"
JOIN competitions c         ON c.id = cs."competitionId"
LEFT JOIN match_teams mt    ON mt."matchId" = tmm."matchId" AND mt."teamId" = tmm."teamId";

-- ---------------------------------------------------------------------------
-- vw_team_season_stats
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_team_season_stats AS
SELECT
    tsm."teamId"                  AS team_id,
    t.name                        AS team_name,
    co.name                       AS country,
    tsm."competitionSeasonId"     AS competition_season_id,
    c.name                        AS competition_name,
    cs."seasonName"               AS season_name,
    tsm.matches,
    tsm.possession,
    tsm."passesP90"               AS passes_p90,
    tsm."passAccuracy"            AS pass_accuracy,
    tsm."progressionP90"          AS progression_p90,
    tsm."xgP90"                   AS xg_p90,
    tsm."xgAgainstP90"            AS xg_against_p90,
    tsm."shotsP90"                AS shots_p90,
    tsm."pressuresP90"            AS pressures_p90,
    tsm."recoveriesP90"           AS recoveries_p90,
    tsm."finalThirdEntriesP90"    AS final_third_entries_p90,
    tsm."boxEntriesP90"           AS box_entries_p90,
    tsm."fieldTilt"               AS field_tilt,
    tsm.ppda,
    tsm.directness,
    tsm.confidence,
    tsm."analyticsVersion"        AS analytics_version
FROM team_season_metrics tsm
JOIN teams t                ON t.id = tsm."teamId"
LEFT JOIN countries co      ON co.id = t."countryId"
JOIN competition_seasons cs ON cs.id = tsm."competitionSeasonId"
JOIN competitions c         ON c.id = cs."competitionId";

-- ---------------------------------------------------------------------------
-- vw_match_summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_match_summary AS
SELECT
    m.id                        AS match_id,
    m."kickoffAt"               AS kickoff_at,
    m.status,
    m.matchweek,
    m.stage,
    c.name                      AS competition_name,
    cs."seasonName"             AS season_name,
    cs.id                       AS competition_season_id,
    ht.id                       AS home_team_id,
    ht.name                     AS home_team,
    at.id                       AS away_team_id,
    at.name                     AS away_team,
    m."homeScore"               AS home_score,
    m."awayScore"               AS away_score,
    v.name                      AS venue,
    m.attendance,
    home.xg                     AS home_xg,
    away.xg                     AS away_xg,
    home.possession             AS home_possession,
    away.possession             AS away_possession,
    home.shots                  AS home_shots,
    away.shots                  AS away_shots,
    home.ppda                   AS home_ppda,
    away.ppda                   AS away_ppda,
    m."isDemo"                  AS is_demo,
    (SELECT count(*) FROM events e WHERE e."matchId" = m.id) AS event_count
FROM matches m
JOIN competition_seasons cs ON cs.id = m."competitionSeasonId"
JOIN competitions c         ON c.id = cs."competitionId"
JOIN teams ht               ON ht.id = m."homeTeamId"
JOIN teams at               ON at.id = m."awayTeamId"
LEFT JOIN venues v          ON v.id = m."venueId"
LEFT JOIN team_match_metrics home ON home."matchId" = m.id AND home."teamId" = m."homeTeamId"
LEFT JOIN team_match_metrics away ON away."matchId" = m.id AND away."teamId" = m."awayTeamId";

-- ---------------------------------------------------------------------------
-- vw_player_roles - role fit with its supporting breakdown (§28, §85)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_roles AS
SELECT
    prs."playerId"              AS player_id,
    p."fullName"                AS player_name,
    p."positionGroup"           AS position_group,
    pr.key                      AS role_key,
    pr.name                     AS role_name,
    pr."positionGroup"          AS role_position_group,
    prs."competitionSeasonId"   AS competition_season_id,
    cs."seasonName"             AS season_name,
    prs.score,
    prs.rank,
    prs."isPrimary"             AS is_primary,
    prs.confidence,
    prs."sampleMinutes"         AS sample_minutes,
    prs.breakdown,
    prs."analyticsVersion"      AS analytics_version
FROM player_role_scores prs
JOIN players p               ON p.id = prs."playerId"
JOIN player_roles pr         ON pr.id = prs."playerRoleId"
LEFT JOIN competition_seasons cs ON cs.id = prs."competitionSeasonId";

-- ---------------------------------------------------------------------------
-- vw_player_similarity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_similarity AS
SELECT
    ps."playerId"               AS player_id,
    p1."fullName"               AS player_name,
    ps."comparisonPlayerId"     AS comparison_player_id,
    p2."fullName"               AS comparison_player_name,
    p2."positionGroup"          AS comparison_position_group,
    t2.name                     AS comparison_team,
    ps."competitionSeasonId"    AS competition_season_id,
    ps."positionGroup"          AS position_group,
    round(ps.similarity::numeric, 4) AS similarity,
    ps.breakdown,
    ps."analyticsVersion"       AS analytics_version
FROM player_similarity ps
JOIN players p1 ON p1.id = ps."playerId"
JOIN players p2 ON p2.id = ps."comparisonPlayerId"
LEFT JOIN player_seasons psn ON psn."playerId" = p2.id AND psn."competitionSeasonId" = ps."competitionSeasonId"
LEFT JOIN teams t2 ON t2.id = psn."teamId";

-- ---------------------------------------------------------------------------
-- vw_team_style_profiles - the 14 style dimensions unpacked from JSONB (§31)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_team_style_profiles AS
SELECT
    tsp."teamId"                             AS team_id,
    t.name                                   AS team_name,
    tsp."competitionSeasonId"                AS competition_season_id,
    cs."seasonName"                          AS season_name,
    c.name                                   AS competition_name,
    (tsp.style ->> 'possession')::float      AS possession,
    (tsp.style ->> 'buildUp')::float         AS build_up,
    (tsp.style ->> 'directness')::float      AS directness,
    (tsp.style ->> 'progression')::float     AS progression,
    (tsp.style ->> 'width')::float           AS width,
    (tsp.style ->> 'centralAttack')::float   AS central_attack,
    (tsp.style ->> 'crossing')::float        AS crossing,
    (tsp.style ->> 'chanceCreation')::float  AS chance_creation,
    (tsp.style ->> 'highPress')::float       AS high_press,
    (tsp.style ->> 'counterpress')::float    AS counterpress,
    (tsp.style ->> 'lowBlock')::float        AS low_block,
    (tsp.style ->> 'transition')::float      AS transition,
    (tsp.style ->> 'defensiveAggression')::float  AS defensive_aggression,
    (tsp.style ->> 'defensiveCompactness')::float AS defensive_compactness,
    tsp."sampleMatches"                      AS sample_matches,
    tsp.confidence,
    tsp."analyticsVersion"                   AS analytics_version
FROM team_style_profiles tsp
JOIN teams t                ON t.id = tsp."teamId"
JOIN competition_seasons cs ON cs.id = tsp."competitionSeasonId"
JOIN competitions c         ON c.id = cs."competitionId";

-- ---------------------------------------------------------------------------
-- vw_player_club_fit (§32)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_player_club_fit AS
SELECT
    pfs."playerId"           AS player_id,
    p."fullName"             AS player_name,
    p."positionGroup"        AS position_group,
    pfs."teamId"             AS team_id,
    t.name                   AS team_name,
    pfs."competitionSeasonId" AS competition_season_id,
    cs."seasonName"          AS season_name,
    round(pfs."fitScore"::numeric, 1) AS fit_score,
    pfs.breakdown,
    pfs."analyticsVersion"   AS analytics_version,
    'Analytical model output - not objective truth' AS interpretation_note
FROM player_fit_scores pfs
JOIN players p ON p.id = pfs."playerId"
JOIN teams t   ON t.id = pfs."teamId"
LEFT JOIN competition_seasons cs ON cs.id = pfs."competitionSeasonId";

-- ---------------------------------------------------------------------------
-- vw_heatmap_zone_activity (§36)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_heatmap_zone_activity AS
SELECT
    hzs.id                    AS zone_statistic_id,
    hzs."playerId"            AS player_id,
    p."fullName"              AS player_name,
    hzs."teamId"              AS team_id,
    t.name                    AS team_name,
    hzs."matchId"             AS match_id,
    hzs."zoneScheme"          AS zone_scheme,
    hzs."zoneKey"             AS zone_key,
    hzs."zoneRow"             AS zone_row,
    hzs."zoneCol"             AS zone_col,
    hzs.touches,
    hzs.passes,
    hzs.carries,
    hzs.shots,
    hzs."defensiveActions"    AS defensive_actions,
    hzs.pressures,
    hzs."possessionTimeSec"   AS possession_time_sec,
    hzs."analyticsVersion"    AS analytics_version
FROM heatmap_zone_statistics hzs
LEFT JOIN players p ON p.id = hzs."playerId"
LEFT JOIN teams t   ON t.id = hzs."teamId";

-- ============================================================================
-- Materialized views (§22)
--
-- Refresh with:  npm run analytics:refresh
-- These carry the cost of percentile and similarity work so the UI does not
-- pay it on every page load (§59).
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_heatmap_zone_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_player_similarity CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_team_style_profiles CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_player_percentiles CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_player_season_metrics CASCADE;

CREATE MATERIALIZED VIEW mv_player_season_metrics AS
SELECT * FROM vw_player_season_stats;

CREATE UNIQUE INDEX mv_player_season_metrics_pk
    ON mv_player_season_metrics (player_id, competition_season_id, analytics_version);
CREATE INDEX mv_player_season_metrics_pos
    ON mv_player_season_metrics (competition_season_id, position_group);
CREATE INDEX mv_player_season_metrics_name
    ON mv_player_season_metrics (player_name);

CREATE MATERIALIZED VIEW mv_player_percentiles AS
SELECT * FROM vw_player_percentiles;

CREATE UNIQUE INDEX mv_player_percentiles_pk
    ON mv_player_percentiles (player_id, competition_season_id, metric_key, analytics_version);
CREATE INDEX mv_player_percentiles_lookup
    ON mv_player_percentiles (competition_season_id, position_group, metric_key, percentile DESC);

CREATE MATERIALIZED VIEW mv_team_style_profiles AS
SELECT * FROM vw_team_style_profiles;

CREATE UNIQUE INDEX mv_team_style_profiles_pk
    ON mv_team_style_profiles (team_id, competition_season_id, analytics_version);

CREATE MATERIALIZED VIEW mv_player_similarity AS
SELECT * FROM vw_player_similarity;

CREATE INDEX mv_player_similarity_lookup
    ON mv_player_similarity (player_id, similarity DESC);
CREATE UNIQUE INDEX mv_player_similarity_pk
    ON mv_player_similarity (player_id, comparison_player_id, competition_season_id, analytics_version);

CREATE MATERIALIZED VIEW mv_heatmap_zone_stats AS
SELECT
    player_id,
    team_id,
    zone_scheme,
    zone_key,
    zone_row,
    zone_col,
    analytics_version,
    count(DISTINCT match_id)  AS matches,
    sum(touches)              AS touches,
    sum(passes)               AS passes,
    sum(carries)              AS carries,
    sum(shots)                AS shots,
    sum(defensive_actions)    AS defensive_actions,
    sum(pressures)            AS pressures,
    sum(possession_time_sec)  AS possession_time_sec
FROM vw_heatmap_zone_activity
GROUP BY player_id, team_id, zone_scheme, zone_key, zone_row, zone_col, analytics_version;

CREATE UNIQUE INDEX mv_heatmap_zone_stats_pk
    ON mv_heatmap_zone_stats (player_id, team_id, zone_scheme, zone_key, analytics_version);
