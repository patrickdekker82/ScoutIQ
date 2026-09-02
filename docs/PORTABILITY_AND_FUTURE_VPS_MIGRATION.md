# PORTABILITY AND FUTURE VPS MIGRATION

ScoutIQ MUST be fully portable between self-hosted environments.

The application must NOT depend on:

- Windows-specific paths
- Hyper-V-specific functionality
- a fixed IP address
- a specific NAS
- a specific server hostname
- local filesystem assumptions
- a specific cloud provider
- a specific Linux distribution

The exact same Docker images and Docker Compose architecture should be usable in:

1. Local Debian VM under Hyper-V
2. Ubuntu/Debian physical server
3. VPS
4. Cloud VPS
5. Future multi-server deployment

All environment-specific configuration must be supplied using environment variables or mounted configuration files.

Examples:

```env
DATABASE_URL=
REDIS_URL=
DATA_ROOT=/data
REPORT_ROOT=/data/reports
BACKUP_ROOT=/data/backups
```

The application must not contain hard-coded host paths.

---

# DATABASE PORTABILITY

PostgreSQL must be portable using:

```bash
pg_dump
pg_restore
```

The project must provide:

```bash
npm run db:backup
npm run db:restore
npm run db:verify
```

Backups must be restorable on another PostgreSQL instance.

Database schema must be reproducible through Prisma migrations.

A fresh PostgreSQL instance must be able to recreate the complete ScoutIQ schema using migrations.

---

# CONTAINER PORTABILITY

The application must be fully containerized.

Provide:

```text
Dockerfile
docker-compose.yml
docker-compose.dev.yml
docker-compose.prod.yml
```

Do not require manual installation of:

- Node.js
- Python
- PostgreSQL
- Redis
- Playwright dependencies

outside the Docker environment for production.

---

# CONFIGURATION PORTABILITY

All secrets and environment-specific settings must be stored outside source code.

Provide:

```text
.env.example
```

Never commit:

```text
.env
API keys
database passwords
authentication secrets
private certificates
```

---

# FILE STORAGE PORTABILITY

Separate application data from source code.

Use configurable paths:

```env
DATA_ROOT=/data
RAW_DATA_ROOT=/data/raw
EXPORT_ROOT=/data/exports
REPORT_ROOT=/data/reports
BACKUP_ROOT=/data/backups
```

The application must work whether these paths are:

- local SSD
- mounted disk
- NAS mount
- attached storage
- VPS block storage
- object-storage mounted filesystem

Do not hard-code Synology-specific paths.

---

# NAS TO VPS MIGRATION

The user's current home environment uses a Synology DS920+.

The application should treat the NAS as optional infrastructure.

The application itself must continue to function when NAS storage is unavailable.

The NAS is primarily for:

- backups
- raw dataset archives
- exported reports

A future VPS deployment may replace NAS storage with:

- VPS block storage
- S3-compatible object storage
- another storage provider

No application code changes should be required.

---

# VPS MIGRATION RUNBOOK

Create:

```text
/docs/deployment/migrate-home-to-vps.md
```

The document must describe:

1. Stop scheduled imports.
2. Create PostgreSQL backup.
3. Verify backup integrity.
4. Copy application configuration.
5. Copy report/data files.
6. Provision VPS.
7. Install Docker.
8. Deploy ScoutIQ containers.
9. Restore PostgreSQL.
10. Run database migrations.
11. Verify analytics.
12. Verify reports.
13. Verify user accounts.
14. Verify provider connections.
15. Switch DNS/reverse proxy.
16. Verify application.
17. Keep old home installation available as rollback until migration is confirmed.

The migration must not require rebuilding the application.

---

# ROLLBACK

Document a rollback process.

If the VPS deployment fails, the local home deployment must remain recoverable.

Do not automatically destroy the old environment during migration.

---

# FUTURE HORIZONTAL SCALING

Do not assume all services must remain on one machine forever.

The architecture should allow future separation of:

```text
Web/API
PostgreSQL
Redis
Analytics workers
Background jobs
Object storage
```

For example:

```text
             Load Balancer
                   │
          ┌────────┴────────┐
          │                 │
      ScoutIQ Web       ScoutIQ Web
          │                 │
          └────────┬────────┘
                   │
                Redis
                   │
          ┌────────┴────────┐
          │                 │
    Analytics Worker   Analytics Worker
                   │
              PostgreSQL
```

This does not need to be implemented in the MVP.

The codebase must simply avoid architectural decisions that would make future separation impossible.

---

# NO CLOUD LOCK-IN

Do not use proprietary cloud services as mandatory infrastructure.

External providers such as:

- authentication
- object storage
- email
- monitoring

must be replaceable where practical.

The core application must continue to run completely self-hosted.

---

# BACKUP PHILOSOPHY

Maintain at least:

1. Live database
2. Local database backup
3. NAS/database backup

For future VPS deployment, maintain:

1. Live database
2. VPS backup
3. Off-site backup

Backups must be independently restorable.

---

# INFRASTRUCTURE DOCUMENTATION

Create:

```text
/docs/deployment/
    windows11-hyperv.md
    debian-vm.md
    docker.md
    nas.md
    backup.md
    migrate-home-to-vps.md
    production-vps.md
    rollback.md
```

The application developer should never need to rewrite application code when moving ScoutIQ from the home Hyper-V environment to a VPS.