# syntax=docker/dockerfile:1
#
# ScoutIQ application image (API + workers share one image; the command picks
# the role). Multi-stage so the runtime layer carries no build toolchain.
#
# The image is host-agnostic: no baked-in paths, hostnames, IPs or secrets.
# Everything comes from the environment at run time.

# ---------- base -------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# ---------- dependencies -----------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, so the client is baked into the image.
RUN npm ci --include=dev

# ---------- build ------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- production dependencies -----------------------------------------
FROM base AS proddeps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime ----------------------------------------------------------
FROM base AS runtime

# postgresql-client provides pg_dump/pg_restore/psql for the db:backup,
# db:restore and db:verify scripts, so backups never depend on tooling being
# installed on the host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY scripts ./scripts

# DATA_ROOT is a mount point, not a location: bind or volume-mount anything.
ENV DATA_ROOT=/data \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=3000
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["api"]
