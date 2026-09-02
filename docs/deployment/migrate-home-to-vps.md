# Migrating ScoutIQ from home to a VPS

This runbook moves a running ScoutIQ installation from the home environment
(Debian VM under Hyper-V, Synology NAS) to a VPS.

**The migration does not require rebuilding the application.** The same image,
the same `docker-compose.yml`, a different `.env`.

**The old environment is not destroyed.** It stays intact and startable until
you explicitly decide otherwise - see [rollback.md](rollback.md).

## Before you start

| | |
| --- | --- |
| Expected downtime | 30-60 minutes |
| Prerequisites | VPS provisioned, SSH access, DNS control, a verified backup |
| Rollback point | The home stack, stopped but untouched |

Notation: `[HOME]` runs on the current server, `[VPS]` on the new one.

---

## 1. Stop scheduled imports

Scheduled work must not start midway through the copy.

```bash
# [HOME]
cd /srv/scoutiq/app
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=false/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker
```

Wait for in-flight jobs to drain, then stop the workers:

```bash
docker compose logs --tail=50 worker
docker compose stop worker
```

The API may keep serving while you copy - the database only stops changing once
you stop it in step 5.

## 2. Create a PostgreSQL backup

```bash
# [HOME]
npm run db:backup -- --label pre-vps-migration
```

Note the printed path, e.g.
`/srv/scoutiq/data/backups/scoutiq-scoutiq-20260115T090000Z-pre-vps-migration.dump`.

## 3. Verify backup integrity

Never migrate on an unverified backup.

```bash
# [HOME]
npm run db:verify -- --deep
```

This checksums the dump, reads its table of contents, confirms the ScoutIQ
tables are present, and test-restores it into a scratch database. **Do not
continue unless this exits 0.**

## 4. Copy application configuration

```bash
# [HOME]
scp .env scoutiq@vps.example.com:/srv/scoutiq/app/.env.home
```

`.env` contains secrets: copy it over SSH, never through a shared folder or a
chat message. On the VPS you will adapt it in step 8 - hostnames and paths
change, `AUTH_SECRET` does **not** (rotating it invalidates every session).

## 5. Copy report and data files

Stop the API so nothing writes while you copy:

```bash
# [HOME]
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api
```

Take a final incremental backup now that writes have stopped:

```bash
npm run db:backup -- --label final
npm run db:verify -- --deep
```

Copy the data tree (reports, raw payloads, backups):

```bash
# [HOME]
rsync -avz --progress /srv/scoutiq/data/ scoutiq@vps.example.com:/srv/scoutiq/data/
```

`EXPORT_ROOT` contents are regenerable; skip them with
`--exclude 'exports/'` if the transfer is large.

## 6. Provision the VPS

Minimum for the full stack: 2 vCPU, 4 GB RAM, 60 GB disk. Recommended:
4 vCPU, 8 GB RAM, 100 GB+.

```bash
# [VPS]
sudo adduser --disabled-password --gecos "" scoutiq
sudo mkdir -p /srv/scoutiq/{app,data}
sudo chown -R scoutiq:scoutiq /srv/scoutiq
```

Attach and mount block storage now if the data is going on a separate volume;
see [production-vps.md](production-vps.md).

## 7. Install Docker

Follow [debian-vm.md](debian-vm.md) sections 1-4. Nothing in it is specific to
Hyper-V or to a VPS - it is the same procedure.

```bash
# [VPS]
docker compose version   # must succeed before continuing
```

## 8. Deploy ScoutIQ containers

```bash
# [VPS]
sudo -iu scoutiq
git clone https://github.com/patrickdekker82/ScoutIQ.git /srv/scoutiq/app
cd /srv/scoutiq/app
mv .env.home .env
```

Adjust only what is environment-specific:

```env
PUBLIC_BASE_URL=https://scoutiq.example.com
HOST_DATA_ROOT=/srv/scoutiq/data
CORS_ORIGINS=https://scoutiq.example.com
SCHEDULER_ENABLED=false          # stays off until step 16
ARCHIVE_ROOT=                    # the home NAS is not reachable from here
```

Keep `AUTH_SECRET` and `POSTGRES_PASSWORD` as they were unless you are
deliberately rotating them.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build postgres redis
docker compose ps      # wait until postgres is healthy
```

> If you exported the image instead of building on the VPS:
> `gunzip -c scoutiq-0.1.0.tar.gz | docker load` and set `SCOUTIQ_IMAGE`.

## 9. Restore PostgreSQL

```bash
# [VPS]
npm run db:verify -- /srv/scoutiq/data/backups/scoutiq-scoutiq-<timestamp>-final.dump
docker compose run --rm api bash scripts/db-restore.sh --yes --clean \
  /data/backups/scoutiq-scoutiq-<timestamp>-final.dump
```

The dump was taken with `--no-owner --no-acl`, so it restores cleanly even
though the VPS database role differs from the home one.

## 10. Run database migrations

The dump carries the schema as it was; apply anything newer:

```bash
# [VPS]
docker compose -f docker-compose.yml -f docker-compose.prod.yml up migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker
```

## 11. Verify analytics

```bash
# [VPS]
curl -s http://127.0.0.1:3000/health/ready | jq
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .token)

curl -s -H "authorization: Bearer $TOKEN" \
  'http://127.0.0.1:3000/api/v1/players?take=5' | jq '.total, .items[0].metrics'
```

Compare the player count and a couple of `scoutScore` values against the home
environment. They must match: the analytics are deterministic given the same
data. Force a recompute if you want an end-to-end check:

```bash
curl -s -X POST -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3000/api/v1/analytics/recompute
```

## 12. Verify reports

```bash
# [VPS]
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/reports | jq 'length'
REPORT=$(curl -s -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/v1/reports | jq -r '.[0].id')
curl -s -H "authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/api/v1/reports/$REPORT/document" | head -20
```

The document is read from `REPORT_ROOT`. Getting it back proves both the
database rows and the copied files arrived. Report paths are stored relative,
so a different mount point on the VPS is fine.

## 13. Verify user accounts

```bash
# [VPS]
docker compose exec postgres psql -U scoutiq -d scoutiq \
  -c 'SELECT email, role, active FROM users ORDER BY email;'
```

Log in with a real account through the API (step 11 already did). If you kept
`AUTH_SECRET`, existing sessions and tokens still work.

## 14. Verify provider connections

```bash
# [VPS]
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/providers | jq
```

Every enabled provider must report `configured: true`. Then run one import
manually, while the scheduler is still off:

```bash
curl -s -X POST -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:3000/api/v1/imports
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/imports | jq '.[0]'
```

Watch for outbound firewall rules and provider IP allow-lists: the VPS has a
different public IP than your home connection. This is the single most common
migration surprise.

## 15. Switch DNS / reverse proxy

Lower the TTL **before** the migration day (300s) so this step is fast.

```bash
# [VPS] - install and configure the reverse proxy first
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then repoint the record:

```
scoutiq.example.com.  300  IN  A  <vps-ip>
```

Confirm the certificate and the route:

```bash
dig +short scoutiq.example.com
curl -sI https://scoutiq.example.com/health/live
```

## 16. Verify the application

Full pass against the public URL:

```bash
curl -s https://scoutiq.example.com/health/ready | jq
```

- [ ] Login works
- [ ] Player list and detail pages return data
- [ ] A report renders and downloads
- [ ] A manual import succeeds
- [ ] Analytics recompute succeeds
- [ ] `/health/ready` returns 200 with database, redis and storage `ok`

Only now re-enable scheduled work:

```bash
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=true/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker
docker compose logs --tail=20 worker   # expect "schedules registered"
```

Configure backups on the new environment ([backup.md](backup.md)) - a VPS
without a verified backup is a single point of failure:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup up -d
npm run db:backup -- --label first-vps-backup
npm run db:verify -- --deep
```

## 17. Keep the home installation as rollback

**Do not delete or reinstall the home environment yet.**

```bash
# [HOME] - stopped, but intact and startable
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Keep it for at least **two weeks** of normal use on the VPS, including at least
one successful scheduled import and one verified VPS backup. Leave
`SCHEDULER_ENABLED=false` at home so it can never write to providers or diverge.

Rollback procedure: [rollback.md](rollback.md).

Decommission only when all of the following hold:

- [ ] Two weeks of stable VPS operation
- [ ] Scheduled imports have run successfully on the VPS
- [ ] VPS backups run automatically and `db:verify --deep` passes
- [ ] An off-site copy of the VPS backups exists
- [ ] The final home backup is archived somewhere outside the home server

---

## Rollback triggers

Go back if any of these appear and cannot be fixed quickly:

- Data loss or a row-count mismatch you cannot explain
- Providers unreachable from the VPS (IP allow-listing)
- Sustained performance far below the home environment
- Reports or analytics that do not match the source

The home environment is still there. Use it.
