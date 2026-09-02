# Rollback

If a VPS deployment fails, the home deployment must remain recoverable. This
document describes how to get back, and the rules that keep that possible.

## Standing rules

1. **Never destroy the old environment during a migration.** Not the VM, not
   the volumes, not the backups.
2. **Keep the old environment startable**, not just archived - stopped
   containers with their volumes intact.
3. **Keep the scheduler disabled** in the standby environment
   (`SCHEDULER_ENABLED=false`) so it cannot import, write to providers, or
   diverge from production.
4. **Never point both environments at the same provider credentials while both
   run**, or you will get duplicate imports.
5. **Decommission only after the checklist** at the end of
   [migrate-home-to-vps.md](migrate-home-to-vps.md) is complete.

## Decision: roll back or fix forward?

| Situation | Action |
| --- | --- |
| DNS/TLS problem | Fix forward - no data at risk |
| Provider blocks the VPS IP | Fix forward (allow-list) or roll back if it will take days |
| Slow but correct | Fix forward - resize the VPS |
| Data missing or wrong | **Roll back** |
| Cannot restore the database | **Roll back** |
| Migrations failed halfway | **Roll back**, investigate offline |

The deciding question: *is the VPS accumulating data that the home environment
does not have?* If yes, rolling back costs data - go to "Rollback after the VPS
has been live" below.

---

## Rollback within the migration window

The window is between step 5 (home stopped) and step 16 (verified) of the
runbook. The VPS has no new data yet, so this is a clean reversal.

### 1. Stop the VPS stack

```bash
# [VPS]
cd /srv/scoutiq/app
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

Do **not** remove volumes - keep them for diagnosis (`down -v` deletes data).

### 2. Revert DNS

```
scoutiq.example.com.  300  IN  A  <home-ip>
```

With a 300s TTL, propagation is a few minutes. Verify:

```bash
dig +short scoutiq.example.com
```

### 3. Restart the home stack

```bash
# [HOME]
cd /srv/scoutiq/app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
curl -s http://127.0.0.1:3000/api/health | jq
```

Nothing was restored, moved or rebuilt: the database, volumes and data tree are
exactly as they were when you stopped it.

### 4. Re-enable scheduled imports

```bash
# [HOME]
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=true/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker
docker compose logs --tail=20 worker    # expect "schedules registered"
```

### 5. Confirm

- [ ] `/api/health` returns 200
- [ ] Login works
- [ ] Player counts match what they were before the migration
- [ ] The scheduler logged its registration

Total time: minutes, dominated by DNS.

---

## Rollback after the VPS has been live

Once the VPS has served real traffic, rolling back means moving data *back*.
It is the same runbook with the roles swapped.

```bash
# [VPS] stop scheduled work, then back up
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=false/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker
docker compose stop worker api
npm run db:backup -- --label vps-rollback
npm run db:verify -- --deep

# copy back
rsync -avz /srv/scoutiq/data/ scoutiq@home.lan:/srv/scoutiq/data/

# [HOME] restore over the stale home database
npm run db:verify -- /srv/scoutiq/data/backups/scoutiq-scoutiq-<ts>-vps-rollback.dump
npm run db:restore -- --yes --clean /srv/scoutiq/data/backups/scoutiq-scoutiq-<ts>-vps-rollback.dump
npm run db:migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Then revert DNS and re-enable the scheduler as above.

> The home database is **overwritten** here. Take a backup of it first
> (`npm run db:backup -- --label home-prerollback`) so the pre-migration state
> stays recoverable too.

---

## Rollback of a bad release (either environment)

Not every rollback is about migrating.

```bash
cd /srv/scoutiq/app
npm run db:backup -- --label pre-rollback      # always
git checkout <previous-tag>
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

If the bad release included a **destructive** migration (dropped column, dropped
table), the code rollback is not enough - restore the pre-upgrade dump:

```bash
npm run db:restore -- --yes --clean /data/backups/scoutiq-...-pre-upgrade.dump
```

This is why `npm run db:backup` before every upgrade is not optional.

## What must never happen during a migration

- `docker compose down -v` on the source environment (deletes volumes)
- Deleting the Hyper-V VM or its VHDX
- Wiping the NAS archive
- Reformatting the home data disk
- Rotating `AUTH_SECRET` "while you are at it" (invalidates every session and
  makes a comparison between environments harder)

Automated destruction of the old environment is not part of any procedure in
this repository. Decommissioning is a separate, deliberate, manual decision.
