-- Recurring synchronisation with external provider APIs (§88 phase 8).
-- Schedules live in the database so they survive a container rebuild and
-- travel with a migration to another machine. No secret is stored here.

-- CreateTable
CREATE TABLE "provider_sync_schedules" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "competitionExternalId" TEXT,
    "seasonExternalId" TEXT,
    "includeEvents" BOOLEAN NOT NULL DEFAULT true,
    "includeTracking" BOOLEAN NOT NULL DEFAULT false,
    "matchLimit" INTEGER,
    "overlapHours" INTEGER NOT NULL DEFAULT 24,
    "watermark" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "ImportStatus",
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_sync_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_sync_schedules_enabled_idx" ON "provider_sync_schedules"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "provider_sync_schedules_providerId_name_key" ON "provider_sync_schedules"("providerId", "name");

-- AddForeignKey
ALTER TABLE "provider_sync_schedules" ADD CONSTRAINT "provider_sync_schedules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sync_schedules" ADD CONSTRAINT "provider_sync_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

