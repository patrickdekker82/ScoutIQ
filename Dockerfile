# syntax=docker/dockerfile:1
#
# ScoutIQ application image.
#
# One image, three roles: scoutiq-web, scoutiq-worker, scoutiq-scheduler (§6).
# The image carries no host paths, hostnames, IPs or secrets - everything comes
# from the environment at run time, so the same image runs on the Hyper-V VM
# and on a VPS without a rebuild.

FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# ---------- dependencies -----------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, so the client is baked in.
RUN npm ci --include=dev

# ---------- build ------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# ---------- production dependencies -----------------------------------------
FROM base AS proddeps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime ----------------------------------------------------------
FROM base AS runtime

# postgresql-client provides pg_dump/pg_restore/psql for db:backup, db:restore
# and db:verify, so backups never depend on tooling installed on the host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone output plus the pieces the worker and the scripts need.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=proddeps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY analytics ./analytics
COPY lib ./lib
COPY db ./db
COPY jobs ./jobs
COPY providers ./providers
COPY reports ./reports
COPY server ./server
COPY tsconfig.json ./

# DATA_ROOT is a mount point, not a location: bind or volume-mount anything.
ENV DATA_ROOT=/data \
    HTTP_HOST=0.0.0.0 \
    PORT=3000
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health?probe=live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["web"]
