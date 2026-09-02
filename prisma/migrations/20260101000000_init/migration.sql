-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SCOUT', 'VIEWER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SCOUT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "season" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "country" TEXT NOT NULL,
    "competitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "nationality" TEXT,
    "position" TEXT NOT NULL,
    "footPref" TEXT,
    "heightCm" INTEGER,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "homeGoals" INTEGER,
    "awayGoals" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_stats" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "minutesPlayed" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "xg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passes" INTEGER NOT NULL DEFAULT 0,
    "passesCompleted" INTEGER NOT NULL DEFAULT 0,
    "progressivePasses" INTEGER NOT NULL DEFAULT 0,
    "duelsWon" INTEGER NOT NULL DEFAULT 0,
    "duelsTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_metrics" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "minutesPlayed" INTEGER NOT NULL,
    "matches" INTEGER NOT NULL,
    "goalsPer90" DOUBLE PRECISION NOT NULL,
    "assistsPer90" DOUBLE PRECISION NOT NULL,
    "xgPer90" DOUBLE PRECISION NOT NULL,
    "xaPer90" DOUBLE PRECISION NOT NULL,
    "passAccuracy" DOUBLE PRECISION NOT NULL,
    "progPassPer90" DOUBLE PRECISION NOT NULL,
    "duelWinRate" DOUBLE PRECISION NOT NULL,
    "scoutScore" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scouting_reports" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scouting_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_providers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "rawPath" TEXT,
    "error" TEXT,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_refs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_name_season_key" ON "competitions"("name", "season");

-- CreateIndex
CREATE INDEX "teams_competitionId_idx" ON "teams"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_country_key" ON "teams"("name", "country");

-- CreateIndex
CREATE INDEX "players_teamId_idx" ON "players"("teamId");

-- CreateIndex
CREATE INDEX "players_position_idx" ON "players"("position");

-- CreateIndex
CREATE INDEX "matches_competitionId_kickoffAt_idx" ON "matches"("competitionId", "kickoffAt");

-- CreateIndex
CREATE INDEX "player_match_stats_matchId_idx" ON "player_match_stats"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_stats_playerId_matchId_key" ON "player_match_stats"("playerId", "matchId");

-- CreateIndex
CREATE INDEX "player_metrics_season_idx" ON "player_metrics"("season");

-- CreateIndex
CREATE UNIQUE INDEX "player_metrics_playerId_season_key" ON "player_metrics"("playerId", "season");

-- CreateIndex
CREATE INDEX "scouting_reports_playerId_idx" ON "scouting_reports"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "data_providers_key_key" ON "data_providers"("key");

-- CreateIndex
CREATE INDEX "import_runs_providerId_startedAt_idx" ON "import_runs"("providerId", "startedAt");

-- CreateIndex
CREATE INDEX "external_refs_playerId_idx" ON "external_refs"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_providerId_externalId_key" ON "external_refs"("providerId", "externalId");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_metrics" ADD CONSTRAINT "player_metrics_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_reports" ADD CONSTRAINT "scouting_reports_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scouting_reports" ADD CONSTRAINT "scouting_reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "data_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "data_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

