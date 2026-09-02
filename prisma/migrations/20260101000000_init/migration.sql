-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ANALYST', 'SCOUT', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('OPEN_DATA', 'COMMERCIAL_API', 'FILE_IMPORT', 'DEMO');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('COMPETITION', 'COMPETITION_SEASON', 'TEAM', 'PLAYER', 'MATCH', 'EVENT', 'VENUE', 'TRACKING_SESSION');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'API', 'SEED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "MappingMethod" AS ENUM ('EXACT', 'FUZZY', 'MANUAL', 'PROVIDER_ID');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT');

-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('LEAGUE', 'CUP', 'INTERNATIONAL', 'FRIENDLY');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'MIXED');

-- CreateEnum
CREATE TYPE "PreferredFoot" AS ENUM ('LEFT', 'RIGHT', 'BOTH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('PERMANENT', 'LOAN', 'YOUTH', 'TRIAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PASS', 'SHOT', 'CARRY', 'DRIBBLE', 'DUEL', 'TACKLE', 'INTERCEPTION', 'PRESSURE', 'RECOVERY', 'CLEARANCE', 'BLOCK', 'FOUL', 'CARD', 'GOAL', 'SET_PIECE', 'TOUCH', 'SUBSTITUTION', 'OFFSIDE', 'GOALKEEPER', 'MISCONTROL', 'DISPOSSESSED', 'HALF_START', 'HALF_END', 'OTHER');

-- CreateEnum
CREATE TYPE "PassHeight" AS ENUM ('GROUND', 'LOW', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BodyPart" AS ENUM ('RIGHT_FOOT', 'LEFT_FOOT', 'HEAD', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DuelType" AS ENUM ('AERIAL', 'GROUND', 'LOOSE_BALL', 'FIFTY_FIFTY', 'TACKLE');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('YELLOW', 'SECOND_YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "SetPieceType" AS ENUM ('CORNER', 'FREE_KICK', 'THROW_IN', 'PENALTY', 'KICK_OFF', 'GOAL_KICK');

-- CreateEnum
CREATE TYPE "CoordinateSystem" AS ENUM ('CANONICAL_105_68', 'NORMALIZED_0_1', 'RANGE_0_100', 'STATSBOMB_120_80', 'OPTA_100_100', 'METRICA_0_1', 'PROVIDER_SPECIFIC');

-- CreateEnum
CREATE TYPE "HeatmapSubject" AS ENUM ('PLAYER', 'TEAM');

-- CreateEnum
CREATE TYPE "HeatmapType" AS ENUM ('TOUCH', 'PASS_ORIGIN', 'PASS_DESTINATION', 'CARRY', 'SHOT', 'DEFENSIVE_ACTION', 'PRESSURE', 'COMBINED_ACTIVITY');

-- CreateEnum
CREATE TYPE "HeatmapAlgorithm" AS ENUM ('GRID_DENSITY', 'HEXBIN', 'GAUSSIAN_KDE');

-- CreateEnum
CREATE TYPE "ShortlistStatus" AS ENUM ('NEW', 'WATCHING', 'SCOUTED', 'INTERESTED', 'PRIORITY', 'REJECTED', 'SIGNED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('PLAYER', 'CLUB', 'MATCH', 'PLAYER_COMPARISON', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportBlockType" AS ENUM ('TITLE', 'EXECUTIVE_SUMMARY', 'IDENTITY', 'KEY_METRICS', 'PERCENTILES', 'RADAR', 'HEATMAP', 'SHOT_MAP', 'PASSING_NETWORK', 'TACTICAL_PROFILE', 'STRENGTHS', 'RISKS', 'SCOUT_NOTES', 'CLUB_FIT', 'COMPARABLE_PLAYERS', 'RECOMMENDATION', 'DATA_SOURCES', 'DATA_QUALITY');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER');

-- CreateEnum
CREATE TYPE "QualitySubject" AS ENUM ('PLAYER_SEASON', 'PLAYER_MATCH', 'TEAM_SEASON', 'TEAM_MATCH', 'MATCH', 'IMPORT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "website" TEXT,
    "licenseName" TEXT,
    "licenseUrl" TEXT,
    "licenseNotes" TEXT,
    "commercialUseAllowed" BOOLEAN NOT NULL DEFAULT false,
    "redistributionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_versions" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "notes" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_datasets" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerVersionId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "licenseName" TEXT,
    "storagePath" TEXT,
    "checksum" TEXT,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" TEXT NOT NULL,
    "sourceDatasetId" TEXT NOT NULL,
    "dataImportId" TEXT,
    "entityType" "EntityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawPath" TEXT,
    "payload" JSONB,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerVersionId" TEXT,
    "sourceDatasetId" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "ImportTrigger" NOT NULL DEFAULT 'MANUAL',
    "jobId" TEXT,
    "requestedById" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "rawPath" TEXT,
    "analyticsVersion" TEXT,
    "error" TEXT,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_import_errors" (
    "id" TEXT NOT NULL,
    "dataImportId" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'ERROR',
    "stage" TEXT NOT NULL,
    "entityType" "EntityType",
    "externalId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_records" (
    "id" TEXT NOT NULL,
    "subjectType" "QualitySubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "metricKey" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "analyticsVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_entity_mappings" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "method" "MappingMethod" NOT NULL DEFAULT 'PROVIDER_ID',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "confederation" TEXT,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryId" TEXT,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "type" "CompetitionType" NOT NULL DEFAULT 'LEAGUE',
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_seasons" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "seasonName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "countryId" TEXT,
    "capacity" INTEGER,
    "pitchLengthM" DOUBLE PRECISION,
    "pitchWidthM" DOUBLE PRECISION,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "countryId" TEXT,
    "founded" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_aliases" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "team_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_seasons" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "finalPosition" INTEGER,
    "points" INTEGER,

    CONSTRAINT "team_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "knownAs" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "countryId" TEXT,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "preferredFoot" "PreferredFoot" NOT NULL DEFAULT 'UNKNOWN',
    "primaryPosition" TEXT NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_aliases" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "player_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_seasons" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "teamId" TEXT,
    "shirtNumber" INTEGER,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_team_memberships" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "MembershipType" NOT NULL DEFAULT 'PERMANENT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "shirtNumber" INTEGER,

    CONSTRAINT "player_team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_positions" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT,
    "position" TEXT NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "venueId" TEXT,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'COMPLETED',
    "matchweek" INTEGER,
    "stage" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "attendance" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_periods" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL DEFAULT 0,
    "endMs" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_teams" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "formation" TEXT,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "ownGoals" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "match_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_officials" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'REFEREE',

    CONSTRAINT "match_officials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineups" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "formation" TEXT,

    CONSTRAINT "lineups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_matches" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "position" TEXT,
    "positionGroup" TEXT,
    "shirtNumber" INTEGER,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "minutesPlayed" INTEGER NOT NULL DEFAULT 0,
    "minuteOn" INTEGER,
    "minuteOff" INTEGER,
    "captain" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "player_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitutions" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerOutId" TEXT NOT NULL,
    "playerInId" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "second" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,

    CONSTRAINT "substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "matchPeriodId" TEXT,
    "teamId" TEXT,
    "playerId" TEXT,
    "possessionTeamId" TEXT,
    "type" "EventType" NOT NULL,
    "subType" TEXT,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "second" INTEGER NOT NULL DEFAULT 0,
    "timestampMs" INTEGER NOT NULL DEFAULT 0,
    "sequenceIndex" INTEGER NOT NULL DEFAULT 0,
    "possessionId" INTEGER,
    "playPattern" TEXT,
    "underPressure" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT,
    "durationSec" DOUBLE PRECISION,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "endX" DOUBLE PRECISION,
    "endY" DOUBLE PRECISION,
    "providerId" TEXT,
    "dataImportId" TEXT,
    "providerEventId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pass_events" (
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT,
    "lengthM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "angleRad" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "height" "PassHeight" NOT NULL DEFAULT 'UNKNOWN',
    "bodyPart" "BodyPart" NOT NULL DEFAULT 'UNKNOWN',
    "technique" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "isCross" BOOLEAN NOT NULL DEFAULT false,
    "isSwitch" BOOLEAN NOT NULL DEFAULT false,
    "isThroughBall" BOOLEAN NOT NULL DEFAULT false,
    "isCutback" BOOLEAN NOT NULL DEFAULT false,
    "isProgressive" BOOLEAN NOT NULL DEFAULT false,
    "intoFinalThird" BOOLEAN NOT NULL DEFAULT false,
    "intoBox" BOOLEAN NOT NULL DEFAULT false,
    "isKeyPass" BOOLEAN NOT NULL DEFAULT false,
    "isAssist" BOOLEAN NOT NULL DEFAULT false,
    "xa" DOUBLE PRECISION,

    CONSTRAINT "pass_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "shot_events" (
    "eventId" TEXT NOT NULL,
    "xg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "providerXg" DOUBLE PRECISION,
    "bodyPart" "BodyPart" NOT NULL DEFAULT 'UNKNOWN',
    "technique" TEXT,
    "firstTime" BOOLEAN NOT NULL DEFAULT false,
    "isPenalty" BOOLEAN NOT NULL DEFAULT false,
    "isOwnGoal" BOOLEAN NOT NULL DEFAULT false,
    "isSetPiece" BOOLEAN NOT NULL DEFAULT false,
    "onTarget" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "isGoal" BOOLEAN NOT NULL DEFAULT false,
    "endX" DOUBLE PRECISION,
    "endY" DOUBLE PRECISION,
    "endZ" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "angleDeg" DOUBLE PRECISION,

    CONSTRAINT "shot_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "carry_events" (
    "eventId" TEXT NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressiveDistanceM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isProgressive" BOOLEAN NOT NULL DEFAULT false,
    "intoFinalThird" BOOLEAN NOT NULL DEFAULT false,
    "intoBox" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "carry_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "dribble_events" (
    "eventId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "nutmeg" BOOLEAN NOT NULL DEFAULT false,
    "overrun" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dribble_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "duel_events" (
    "eventId" TEXT NOT NULL,
    "duelType" "DuelType" NOT NULL DEFAULT 'GROUND',
    "won" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "duel_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "tackle_events" (
    "eventId" TEXT NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "dispossessed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tackle_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "interception_events" (
    "eventId" TEXT NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "interception_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "pressure_events" (
    "eventId" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counterpress" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pressure_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "recovery_events" (
    "eventId" TEXT NOT NULL,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "offensive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recovery_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "clearance_events" (
    "eventId" TEXT NOT NULL,
    "bodyPart" "BodyPart" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "clearance_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "foul_events" (
    "eventId" TEXT NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT true,
    "advantage" BOOLEAN NOT NULL DEFAULT false,
    "penalty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "foul_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "card_events" (
    "eventId" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL DEFAULT 'YELLOW',
    "reason" TEXT,

    CONSTRAINT "card_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "goal_events" (
    "eventId" TEXT NOT NULL,
    "shotEventId" TEXT,
    "assistPlayerId" TEXT,
    "ownGoal" BOOLEAN NOT NULL DEFAULT false,
    "penalty" BOOLEAN NOT NULL DEFAULT false,
    "bodyPart" "BodyPart" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "goal_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "set_piece_events" (
    "eventId" TEXT NOT NULL,
    "setPieceType" "SetPieceType" NOT NULL,
    "deliveryZone" TEXT,

    CONSTRAINT "set_piece_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "touch_events" (
    "eventId" TEXT NOT NULL,
    "successful" BOOLEAN NOT NULL DEFAULT true,
    "inBox" BOOLEAN NOT NULL DEFAULT false,
    "finalThird" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "touch_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "tracking_sessions" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "providerId" TEXT,
    "frameRateHz" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "startMs" INTEGER NOT NULL DEFAULT 0,
    "endMs" INTEGER NOT NULL DEFAULT 0,
    "coordinateSystem" "CoordinateSystem" NOT NULL DEFAULT 'CANONICAL_105_68',
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_frames" (
    "id" TEXT NOT NULL,
    "trackingSessionId" TEXT NOT NULL,
    "frameIndex" INTEGER NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "period" INTEGER NOT NULL DEFAULT 1,
    "ballInPlay" BOOLEAN NOT NULL DEFAULT true,
    "possessionTeamId" TEXT,

    CONSTRAINT "tracking_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_player_positions" (
    "id" TEXT NOT NULL,
    "trackingFrameId" TEXT NOT NULL,
    "playerId" TEXT,
    "teamId" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "speedMs" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,

    CONSTRAINT "tracking_player_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_ball_positions" (
    "id" TEXT NOT NULL,
    "trackingFrameId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION,
    "speedMs" DOUBLE PRECISION,

    CONSTRAINT "tracking_ball_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_aggregates" (
    "id" TEXT NOT NULL,
    "trackingSessionId" TEXT NOT NULL,
    "teamId" TEXT,
    "playerId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'ALL',
    "avgX" DOUBLE PRECISION,
    "avgY" DOUBLE PRECISION,
    "centroidX" DOUBLE PRECISION,
    "centroidY" DOUBLE PRECISION,
    "teamWidthM" DOUBLE PRECISION,
    "teamDepthM" DOUBLE PRECISION,
    "compactness" DOUBLE PRECISION,
    "convexHullAreaM2" DOUBLE PRECISION,
    "defensiveLineM" DOUBLE PRECISION,
    "attackingLineM" DOUBLE PRECISION,
    "lineDistanceM" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "highSpeedDistanceM" DOUBLE PRECISION,
    "sprintCount" INTEGER,
    "maxSpeedMs" DOUBLE PRECISION,
    "analyticsVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_metrics" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "passes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesCompleted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressivePasses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesFinalThird" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesIntoBox" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keyPasses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "throughBalls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "switches" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crosses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longPasses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressiveCarries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriesFinalThird" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriesIntoBox" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dribbles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dribblesCompleted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressiveActions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chancesCreated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touches" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touchesFinalThird" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touchesBox" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shots" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shotsOnTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "npxg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgPerShot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assists" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tackles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tacklesWon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interceptions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pressures" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counterpressures" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clearances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defensiveDuels" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defensiveDuelsWon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aerialDuels" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aerialDuelsWon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foulsCommitted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distanceM" DOUBLE PRECISION,
    "highSpeedDistanceM" DOUBLE PRECISION,
    "sprintCount" DOUBLE PRECISION,
    "maxSpeedMs" DOUBLE PRECISION,
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_match_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_season_metrics" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "teamId" TEXT,
    "positionGroup" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "passesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressivePassesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesFinalThirdP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesIntoBoxP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keyPassesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crossesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longPassesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressiveCarriesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriesFinalThirdP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriesIntoBoxP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dribblesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dribbleSuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressiveActionsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xaP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chancesCreatedP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touchesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touchesFinalThirdP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "touchesBoxP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shotsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shotsOnTargetP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "npxgP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgPerShot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tacklesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tackleSuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interceptionsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pressuresP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counterpressuresP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveriesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocksP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clearancesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defensiveDuelsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defensiveDuelWinRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aerialDuelsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aerialDuelWinRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distanceP90" DOUBLE PRECISION,
    "highSpeedDistanceP90" DOUBLE PRECISION,
    "sprintCountP90" DOUBLE PRECISION,
    "maxSpeedMs" DOUBLE PRECISION,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_season_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_match_metrics" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "possession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressivePasses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalThirdEntries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "boxEntries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shots" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shotsOnTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pressures" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counterpressures" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tackles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interceptions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fieldTilt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ppda" DOUBLE PRECISION,
    "directness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crosses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_match_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_season_metrics" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "possession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressionP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgAgainstP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shotsP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pressuresP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveriesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalThirdEntriesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "boxEntriesP90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fieldTilt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ppda" DOUBLE PRECISION,
    "directness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_season_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "description" TEXT,
    "minMinutes" INTEGER NOT NULL DEFAULT 450,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_role_requirements" (
    "id" TEXT NOT NULL,
    "playerRoleId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "direction" "MetricDirection" NOT NULL DEFAULT 'HIGHER_BETTER',
    "minPercentile" DOUBLE PRECISION,
    "description" TEXT,

    CONSTRAINT "player_role_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_role_scores" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerRoleId" TEXT NOT NULL,
    "competitionSeasonId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "sampleMinutes" INTEGER NOT NULL DEFAULT 0,
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_role_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_style_profiles" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "dna" JSONB NOT NULL DEFAULT '{}',
    "styleVector" JSONB NOT NULL DEFAULT '{}',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "referencePopulation" TEXT,
    "sampleMinutes" INTEGER NOT NULL DEFAULT 0,
    "sampleMatches" INTEGER NOT NULL DEFAULT 0,
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_style_profiles" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "competitionSeasonId" TEXT NOT NULL,
    "style" JSONB NOT NULL DEFAULT '{}',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "sampleMatches" INTEGER NOT NULL DEFAULT 0,
    "confidence" "Confidence" NOT NULL DEFAULT 'INSUFFICIENT',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_similarity" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "comparisonPlayerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT,
    "positionGroup" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_similarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_fit_scores" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "competitionSeasonId" TEXT,
    "fitScore" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_fit_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmaps" (
    "id" TEXT NOT NULL,
    "subjectType" "HeatmapSubject" NOT NULL,
    "playerId" TEXT,
    "teamId" TEXT,
    "matchId" TEXT,
    "competitionSeasonId" TEXT,
    "type" "HeatmapType" NOT NULL,
    "algorithm" "HeatmapAlgorithm" NOT NULL DEFAULT 'GRID_DENSITY',
    "gridCols" INTEGER NOT NULL DEFAULT 24,
    "gridRows" INTEGER NOT NULL DEFAULT 16,
    "bandwidth" DOUBLE PRECISION,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heatmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmap_points" (
    "id" TEXT NOT NULL,
    "heatmapId" TEXT NOT NULL,
    "col" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "heatmap_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmap_zone_statistics" (
    "id" TEXT NOT NULL,
    "heatmapId" TEXT,
    "playerId" TEXT,
    "teamId" TEXT,
    "matchId" TEXT,
    "zoneScheme" TEXT NOT NULL DEFAULT 'THIRDS_LANES',
    "zoneKey" TEXT NOT NULL,
    "zoneRow" INTEGER NOT NULL,
    "zoneCol" INTEGER NOT NULL,
    "touches" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carries" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shots" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defensiveActions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pressures" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "possessionTimeSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analyticsVersion" TEXT NOT NULL DEFAULT 'scoutiq-analytics-v1.0',

    CONSTRAINT "heatmap_zone_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "competitionSeasonId" TEXT,
    "positionGroup" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlist_players" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" "ShortlistStatus" NOT NULL DEFAULT 'NEW',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "scoutRating" INTEGER,
    "notes" TEXT,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shortlist_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scouting_notes" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "playerId" TEXT,
    "teamId" TEXT,
    "matchId" TEXT,
    "eventId" TEXT,
    "shortlistId" TEXT,
    "minute" INTEGER,
    "second" INTEGER,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scouting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scout_ratings" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "matchId" TEXT,
    "technical" INTEGER NOT NULL,
    "tactical" INTEGER NOT NULL,
    "physical" INTEGER NOT NULL,
    "mental" INTEGER NOT NULL,
    "potential" INTEGER NOT NULL,
    "overall" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scout_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT,
    "subjectPlayerId" TEXT,
    "subjectTeamId" TEXT,
    "subjectMatchId" TEXT,
    "subjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_versions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSnapshotId" TEXT NOT NULL,
    "analyticsVersion" TEXT NOT NULL,
    "reportVersion" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "providerVersions" JSONB NOT NULL DEFAULT '{}',
    "htmlPath" TEXT,
    "pdfPath" TEXT,
    "createdById" TEXT,

    CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_blocks" (
    "id" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "ReportBlockType" NOT NULL,
    "title" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "report_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_queries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sql" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_history" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "providers_key_key" ON "providers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "provider_versions_providerId_version_key" ON "provider_versions"("providerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "source_datasets_providerId_key_key" ON "source_datasets"("providerId", "key");

-- CreateIndex
CREATE INDEX "source_records_dataImportId_idx" ON "source_records"("dataImportId");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_sourceDatasetId_entityType_externalId_key" ON "source_records"("sourceDatasetId", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "data_imports_providerId_startedAt_idx" ON "data_imports"("providerId", "startedAt");

-- CreateIndex
CREATE INDEX "data_imports_status_idx" ON "data_imports"("status");

-- CreateIndex
CREATE INDEX "data_import_errors_dataImportId_severity_idx" ON "data_import_errors"("dataImportId", "severity");

-- CreateIndex
CREATE INDEX "data_quality_records_subjectType_subjectId_idx" ON "data_quality_records"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_records_subjectType_subjectId_metricKey_analyt_key" ON "data_quality_records"("subjectType", "subjectId", "metricKey", "analyticsVersion");

-- CreateIndex
CREATE INDEX "external_entity_mappings_entityType_internalId_idx" ON "external_entity_mappings"("entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "external_entity_mappings_providerId_entityType_externalId_key" ON "external_entity_mappings"("providerId", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE INDEX "competitions_countryId_idx" ON "competitions"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_name_countryId_gender_key" ON "competitions"("name", "countryId", "gender");

-- CreateIndex
CREATE UNIQUE INDEX "competition_seasons_competitionId_seasonName_key" ON "competition_seasons"("competitionId", "seasonName");

-- CreateIndex
CREATE UNIQUE INDEX "venues_name_city_key" ON "venues"("name", "city");

-- CreateIndex
CREATE INDEX "teams_name_idx" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_countryId_key" ON "teams"("name", "countryId");

-- CreateIndex
CREATE INDEX "team_aliases_alias_idx" ON "team_aliases"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "team_aliases_teamId_alias_key" ON "team_aliases"("teamId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "team_seasons_teamId_competitionSeasonId_key" ON "team_seasons"("teamId", "competitionSeasonId");

-- CreateIndex
CREATE INDEX "players_fullName_idx" ON "players"("fullName");

-- CreateIndex
CREATE INDEX "players_lastName_idx" ON "players"("lastName");

-- CreateIndex
CREATE INDEX "players_dateOfBirth_idx" ON "players"("dateOfBirth");

-- CreateIndex
CREATE INDEX "players_positionGroup_idx" ON "players"("positionGroup");

-- CreateIndex
CREATE INDEX "players_countryId_idx" ON "players"("countryId");

-- CreateIndex
CREATE INDEX "player_aliases_alias_idx" ON "player_aliases"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "player_aliases_playerId_alias_key" ON "player_aliases"("playerId", "alias");

-- CreateIndex
CREATE INDEX "player_seasons_competitionSeasonId_idx" ON "player_seasons"("competitionSeasonId");

-- CreateIndex
CREATE UNIQUE INDEX "player_seasons_playerId_competitionSeasonId_teamId_key" ON "player_seasons"("playerId", "competitionSeasonId", "teamId");

-- CreateIndex
CREATE INDEX "player_team_memberships_playerId_idx" ON "player_team_memberships"("playerId");

-- CreateIndex
CREATE INDEX "player_team_memberships_teamId_idx" ON "player_team_memberships"("teamId");

-- CreateIndex
CREATE INDEX "player_positions_positionGroup_idx" ON "player_positions"("positionGroup");

-- CreateIndex
CREATE UNIQUE INDEX "player_positions_playerId_competitionSeasonId_position_key" ON "player_positions"("playerId", "competitionSeasonId", "position");

-- CreateIndex
CREATE INDEX "matches_kickoffAt_idx" ON "matches"("kickoffAt");

-- CreateIndex
CREATE INDEX "matches_homeTeamId_idx" ON "matches"("homeTeamId");

-- CreateIndex
CREATE INDEX "matches_awayTeamId_idx" ON "matches"("awayTeamId");

-- CreateIndex
CREATE INDEX "matches_competitionSeasonId_kickoffAt_idx" ON "matches"("competitionSeasonId", "kickoffAt");

-- CreateIndex
CREATE UNIQUE INDEX "matches_competitionSeasonId_homeTeamId_awayTeamId_kickoffAt_key" ON "matches"("competitionSeasonId", "homeTeamId", "awayTeamId", "kickoffAt");

-- CreateIndex
CREATE UNIQUE INDEX "match_periods_matchId_period_key" ON "match_periods"("matchId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "match_teams_matchId_teamId_key" ON "match_teams"("matchId", "teamId");

-- CreateIndex
CREATE INDEX "match_officials_matchId_idx" ON "match_officials"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "lineups_matchId_teamId_key" ON "lineups"("matchId", "teamId");

-- CreateIndex
CREATE INDEX "player_matches_playerId_idx" ON "player_matches"("playerId");

-- CreateIndex
CREATE INDEX "player_matches_teamId_idx" ON "player_matches"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "player_matches_matchId_playerId_key" ON "player_matches"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "substitutions_matchId_idx" ON "substitutions"("matchId");

-- CreateIndex
CREATE INDEX "events_matchId_idx" ON "events"("matchId");

-- CreateIndex
CREATE INDEX "events_playerId_idx" ON "events"("playerId");

-- CreateIndex
CREATE INDEX "events_teamId_idx" ON "events"("teamId");

-- CreateIndex
CREATE INDEX "events_timestampMs_idx" ON "events"("timestampMs");

-- CreateIndex
CREATE INDEX "events_matchId_timestampMs_idx" ON "events"("matchId", "timestampMs");

-- CreateIndex
CREATE INDEX "events_matchId_type_idx" ON "events"("matchId", "type");

-- CreateIndex
CREATE INDEX "events_playerId_type_idx" ON "events"("playerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "events_providerId_providerEventId_key" ON "events"("providerId", "providerEventId");

-- CreateIndex
CREATE INDEX "pass_events_recipientId_idx" ON "pass_events"("recipientId");

-- CreateIndex
CREATE INDEX "tracking_sessions_matchId_idx" ON "tracking_sessions"("matchId");

-- CreateIndex
CREATE INDEX "tracking_frames_trackingSessionId_timestampMs_idx" ON "tracking_frames"("trackingSessionId", "timestampMs");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_frames_trackingSessionId_frameIndex_key" ON "tracking_frames"("trackingSessionId", "frameIndex");

-- CreateIndex
CREATE INDEX "tracking_player_positions_trackingFrameId_idx" ON "tracking_player_positions"("trackingFrameId");

-- CreateIndex
CREATE INDEX "tracking_player_positions_playerId_idx" ON "tracking_player_positions"("playerId");

-- CreateIndex
CREATE INDEX "tracking_ball_positions_trackingFrameId_idx" ON "tracking_ball_positions"("trackingFrameId");

-- CreateIndex
CREATE INDEX "tracking_aggregates_playerId_idx" ON "tracking_aggregates"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_aggregates_trackingSessionId_teamId_playerId_phase_key" ON "tracking_aggregates"("trackingSessionId", "teamId", "playerId", "phase", "analyticsVersion");

-- CreateIndex
CREATE INDEX "player_match_metrics_playerId_idx" ON "player_match_metrics"("playerId");

-- CreateIndex
CREATE INDEX "player_match_metrics_matchId_idx" ON "player_match_metrics"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_metrics_playerId_matchId_analyticsVersion_key" ON "player_match_metrics"("playerId", "matchId", "analyticsVersion");

-- CreateIndex
CREATE INDEX "player_season_metrics_competitionSeasonId_positionGroup_idx" ON "player_season_metrics"("competitionSeasonId", "positionGroup");

-- CreateIndex
CREATE INDEX "player_season_metrics_playerId_idx" ON "player_season_metrics"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "player_season_metrics_playerId_competitionSeasonId_analytic_key" ON "player_season_metrics"("playerId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE INDEX "team_match_metrics_matchId_idx" ON "team_match_metrics"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "team_match_metrics_teamId_matchId_analyticsVersion_key" ON "team_match_metrics"("teamId", "matchId", "analyticsVersion");

-- CreateIndex
CREATE UNIQUE INDEX "team_season_metrics_teamId_competitionSeasonId_analyticsVer_key" ON "team_season_metrics"("teamId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE UNIQUE INDEX "player_roles_key_key" ON "player_roles"("key");

-- CreateIndex
CREATE INDEX "player_roles_positionGroup_idx" ON "player_roles"("positionGroup");

-- CreateIndex
CREATE UNIQUE INDEX "player_role_requirements_playerRoleId_metricKey_key" ON "player_role_requirements"("playerRoleId", "metricKey");

-- CreateIndex
CREATE INDEX "player_role_scores_playerRoleId_score_idx" ON "player_role_scores"("playerRoleId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "player_role_scores_playerId_playerRoleId_competitionSeasonI_key" ON "player_role_scores"("playerId", "playerRoleId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE UNIQUE INDEX "player_style_profiles_playerId_competitionSeasonId_analytic_key" ON "player_style_profiles"("playerId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE UNIQUE INDEX "team_style_profiles_teamId_competitionSeasonId_analyticsVer_key" ON "team_style_profiles"("teamId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE INDEX "player_similarity_playerId_similarity_idx" ON "player_similarity"("playerId", "similarity");

-- CreateIndex
CREATE UNIQUE INDEX "player_similarity_playerId_comparisonPlayerId_competitionSe_key" ON "player_similarity"("playerId", "comparisonPlayerId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE INDEX "player_fit_scores_teamId_fitScore_idx" ON "player_fit_scores"("teamId", "fitScore");

-- CreateIndex
CREATE UNIQUE INDEX "player_fit_scores_playerId_teamId_competitionSeasonId_analy_key" ON "player_fit_scores"("playerId", "teamId", "competitionSeasonId", "analyticsVersion");

-- CreateIndex
CREATE INDEX "heatmaps_playerId_type_idx" ON "heatmaps"("playerId", "type");

-- CreateIndex
CREATE INDEX "heatmaps_teamId_type_idx" ON "heatmaps"("teamId", "type");

-- CreateIndex
CREATE INDEX "heatmaps_matchId_idx" ON "heatmaps"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "heatmap_points_heatmapId_col_row_key" ON "heatmap_points"("heatmapId", "col", "row");

-- CreateIndex
CREATE INDEX "heatmap_zone_statistics_heatmapId_idx" ON "heatmap_zone_statistics"("heatmapId");

-- CreateIndex
CREATE INDEX "heatmap_zone_statistics_playerId_zoneScheme_idx" ON "heatmap_zone_statistics"("playerId", "zoneScheme");

-- CreateIndex
CREATE INDEX "heatmap_zone_statistics_teamId_zoneScheme_idx" ON "heatmap_zone_statistics"("teamId", "zoneScheme");

-- CreateIndex
CREATE INDEX "shortlists_ownerId_idx" ON "shortlists"("ownerId");

-- CreateIndex
CREATE INDEX "shortlist_players_playerId_idx" ON "shortlist_players"("playerId");

-- CreateIndex
CREATE INDEX "shortlist_players_status_idx" ON "shortlist_players"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shortlist_players_shortlistId_playerId_key" ON "shortlist_players"("shortlistId", "playerId");

-- CreateIndex
CREATE INDEX "scouting_notes_playerId_idx" ON "scouting_notes"("playerId");

-- CreateIndex
CREATE INDEX "scouting_notes_matchId_idx" ON "scouting_notes"("matchId");

-- CreateIndex
CREATE INDEX "scouting_notes_authorId_idx" ON "scouting_notes"("authorId");

-- CreateIndex
CREATE INDEX "scout_ratings_playerId_idx" ON "scout_ratings"("playerId");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "reports"("type");

-- CreateIndex
CREATE INDEX "reports_subjectPlayerId_idx" ON "reports"("subjectPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "report_versions_reportId_version_key" ON "report_versions"("reportId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "report_blocks_reportVersionId_order_key" ON "report_blocks"("reportVersionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "saved_queries_ownerId_name_key" ON "saved_queries"("ownerId", "name");

-- CreateIndex
CREATE INDEX "query_history_ownerId_createdAt_idx" ON "query_history"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "provider_versions" ADD CONSTRAINT "provider_versions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_datasets" ADD CONSTRAINT "source_datasets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_datasets" ADD CONSTRAINT "source_datasets_providerVersionId_fkey" FOREIGN KEY ("providerVersionId") REFERENCES "provider_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_sourceDatasetId_fkey" FOREIGN KEY ("sourceDatasetId") REFERENCES "source_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "data_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_providerVersionId_fkey" FOREIGN KEY ("providerVersionId") REFERENCES "provider_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_sourceDatasetId_fkey" FOREIGN KEY ("sourceDatasetId") REFERENCES "source_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_import_errors" ADD CONSTRAINT "data_import_errors_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entity_mappings" ADD CONSTRAINT "external_entity_mappings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_seasons" ADD CONSTRAINT "competition_seasons_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_seasons" ADD CONSTRAINT "player_seasons_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_seasons" ADD CONSTRAINT "player_seasons_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_seasons" ADD CONSTRAINT "player_seasons_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_team_memberships" ADD CONSTRAINT "player_team_memberships_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_team_memberships" ADD CONSTRAINT "player_team_memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_positions" ADD CONSTRAINT "player_positions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_positions" ADD CONSTRAINT "player_positions_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_periods" ADD CONSTRAINT "match_periods_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_teams" ADD CONSTRAINT "match_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_matches" ADD CONSTRAINT "player_matches_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_matches" ADD CONSTRAINT "player_matches_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_matches" ADD CONSTRAINT "player_matches_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_playerOutId_fkey" FOREIGN KEY ("playerOutId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_playerInId_fkey" FOREIGN KEY ("playerInId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_matchPeriodId_fkey" FOREIGN KEY ("matchPeriodId") REFERENCES "match_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_possessionTeamId_fkey" FOREIGN KEY ("possessionTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "data_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pass_events" ADD CONSTRAINT "pass_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pass_events" ADD CONSTRAINT "pass_events_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carry_events" ADD CONSTRAINT "carry_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dribble_events" ADD CONSTRAINT "dribble_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_events" ADD CONSTRAINT "duel_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tackle_events" ADD CONSTRAINT "tackle_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interception_events" ADD CONSTRAINT "interception_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_events" ADD CONSTRAINT "pressure_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_events" ADD CONSTRAINT "recovery_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_events" ADD CONSTRAINT "clearance_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foul_events" ADD CONSTRAINT "foul_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_piece_events" ADD CONSTRAINT "set_piece_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touch_events" ADD CONSTRAINT "touch_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_frames" ADD CONSTRAINT "tracking_frames_trackingSessionId_fkey" FOREIGN KEY ("trackingSessionId") REFERENCES "tracking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_player_positions" ADD CONSTRAINT "tracking_player_positions_trackingFrameId_fkey" FOREIGN KEY ("trackingFrameId") REFERENCES "tracking_frames"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_player_positions" ADD CONSTRAINT "tracking_player_positions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_ball_positions" ADD CONSTRAINT "tracking_ball_positions_trackingFrameId_fkey" FOREIGN KEY ("trackingFrameId") REFERENCES "tracking_frames"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_aggregates" ADD CONSTRAINT "tracking_aggregates_trackingSessionId_fkey" FOREIGN KEY ("trackingSessionId") REFERENCES "tracking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_metrics" ADD CONSTRAINT "player_match_metrics_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_metrics" ADD CONSTRAINT "player_match_metrics_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_metrics" ADD CONSTRAINT "player_match_metrics_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_metrics" ADD CONSTRAINT "player_season_metrics_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_metrics" ADD CONSTRAINT "player_season_metrics_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_metrics" ADD CONSTRAINT "player_season_metrics_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_match_metrics" ADD CONSTRAINT "team_match_metrics_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_match_metrics" ADD CONSTRAINT "team_match_metrics_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_season_metrics" ADD CONSTRAINT "team_season_metrics_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_season_metrics" ADD CONSTRAINT "team_season_metrics_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_role_requirements" ADD CONSTRAINT "player_role_requirements_playerRoleId_fkey" FOREIGN KEY ("playerRoleId") REFERENCES "player_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_role_scores" ADD CONSTRAINT "player_role_scores_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_role_scores" ADD CONSTRAINT "player_role_scores_playerRoleId_fkey" FOREIGN KEY ("playerRoleId") REFERENCES "player_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_style_profiles" ADD CONSTRAINT "player_style_profiles_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_style_profiles" ADD CONSTRAINT "player_style_profiles_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_style_profiles" ADD CONSTRAINT "team_style_profiles_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_style_profiles" ADD CONSTRAINT "team_style_profiles_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_similarity" ADD CONSTRAINT "player_similarity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_similarity" ADD CONSTRAINT "player_similarity_comparisonPlayerId_fkey" FOREIGN KEY ("comparisonPlayerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_similarity" ADD CONSTRAINT "player_similarity_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_fit_scores" ADD CONSTRAINT "player_fit_scores_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_fit_scores" ADD CONSTRAINT "player_fit_scores_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_fit_scores" ADD CONSTRAINT "player_fit_scores_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmaps" ADD CONSTRAINT "heatmaps_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmaps" ADD CONSTRAINT "heatmaps_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmaps" ADD CONSTRAINT "heatmaps_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmaps" ADD CONSTRAINT "heatmaps_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmap_points" ADD CONSTRAINT "heatmap_points_heatmapId_fkey" FOREIGN KEY ("heatmapId") REFERENCES "heatmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmap_zone_statistics" ADD CONSTRAINT "heatmap_zone_statistics_heatmapId_fkey" FOREIGN KEY ("heatmapId") REFERENCES "heatmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_competitionSeasonId_fkey" FOREIGN KEY ("competitionSeasonId") REFERENCES "competition_seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_players" ADD CONSTRAINT "shortlist_players_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_players" ADD CONSTRAINT "shortlist_players_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_players" ADD CONSTRAINT "shortlist_players_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_notes" ADD CONSTRAINT "scouting_notes_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "shortlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_ratings" ADD CONSTRAINT "scout_ratings_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_ratings" ADD CONSTRAINT "scout_ratings_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scout_ratings" ADD CONSTRAINT "scout_ratings_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_subjectPlayerId_fkey" FOREIGN KEY ("subjectPlayerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_subjectTeamId_fkey" FOREIGN KEY ("subjectTeamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_subjectMatchId_fkey" FOREIGN KEY ("subjectMatchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_blocks" ADD CONSTRAINT "report_blocks_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "report_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_queries" ADD CONSTRAINT "saved_queries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_history" ADD CONSTRAINT "query_history_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

