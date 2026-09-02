# Backup and restore

## Philosophy

Maintain at least three copies at all times.

**Home environment**

1. Live database (`postgres` container)
2. Local backup (`BACKUP_ROOT`, on the server's own disk)
3. NAS backup (`ARCHIVE_ROOT`, on the Synology)

**VPS environment**

1. Live database
2. VPS backup (`BACKUP_ROOT`, on the VPS volume)
3. Off-site backup (pulled to the home NAS, or pushed to object storage)

Every copy must be **independently restorable**: a backup you have not restored
is a hypothesis, not a backup.

> A Hyper-V checkpoint or a VPS snapshot is *not* in this list. Both can capture
> PostgreSQL mid-write. They are useful for rolling back a machine, not for
> restoring a database.

## Commands

```bash
npm run db:backup                    # timestamped dump + SHA-256 in BACKUP_ROOT
npm run db:backup -- --label pre-migration
npm run db:verify                    # verify the newest backup
npm run db:verify -- --deep          # also test-restore into a scratch database
npm run db:verify -- /path/to.dump   # verify a specific file
npm run db:restore                   # restore newest backup (prompts first)
npm run db:restore -- --yes --clean  # unattended, dropping existing objects
```

Inside Docker:

```bash
docker compose run --rm api backup
docker compose run --rm api bash scripts/db-verify.sh --deep
```

All three scripts read `DATABASE_URL` and `BACKUP_ROOT` from the environment,
so they behave identically on the home server and on a VPS.

## What a backup contains

`scripts/db-backup.sh` writes a **custom-format** dump:

```
$BACKUP_ROOT/scoutiq-<database>-<UTC timestamp>[-<label>].dump
$BACKUP_ROOT/scoutiq-<database>-<UTC timestamp>[-<label>].dump.sha256
```

- `--format=custom` - compressed, selectively restorable with `pg_restore`
- `--no-owner --no-acl` - **restores under a different role on another host**,
  which is what makes the home to VPS move work
- SHA-256 written alongside, checked by `db:verify` and by `db:restore`

## What `db:verify` checks

1. The file exists and is non-empty
2. The SHA-256 still matches (catches silent corruption on a NAS or in transit)
3. `pg_restore --list` can read the archive
4. The expected ScoutIQ tables are present in the dump
5. `--deep`: a real restore into a temporary database succeeds and produces a
   sane table count

Exit code 0 means restorable. **Run `--deep` before decommissioning anything.**

## Files, not just the database

The database is only part of the state:

| What | Where | How to copy |
| --- | --- | --- |
| Raw provider payloads | `RAW_DATA_ROOT` | `rsync -a` |
| Rendered reports | `REPORT_ROOT` | `rsync -a` |
| Exports | `EXPORT_ROOT` | `rsync -a` (regenerable) |
| Configuration | `.env` | copy by hand; contains secrets |

```bash
rsync -a --delete /srv/scoutiq/data/reports/ /mnt/nas/scoutiq/reports/
rsync -a --delete /srv/scoutiq/data/raw/     /mnt/nas/scoutiq/raw/
```

`.env` is deliberately *not* in git. Keep it in a password manager or an
encrypted archive - a backup without it is not a complete recovery.

## Automating

Compose sidecar (no host cron needed, moves with the stack):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile backup up -d
```

Or a host crontab, if you prefer to see it in `crontab -l`:

```cron
30 2 * * * cd /srv/scoutiq/app && npm run db:backup >> /srv/scoutiq/data/backups/cron.log 2>&1
0  4 * * 0 cd /srv/scoutiq/app && npm run db:verify -- --deep >> /srv/scoutiq/data/backups/verify.log 2>&1
```

Retention: `BACKUP_RETENTION_DAYS` (default 14) prunes **local** dumps only.
Archived copies on the NAS are never pruned by ScoutIQ - that is deliberate.

## Restoring onto a different machine

```bash
scp scoutiq-scoutiq-20260115T023000Z.dump* vps:/srv/scoutiq/data/backups/

# on the target:
cd /srv/scoutiq/app
npm run db:verify -- /srv/scoutiq/data/backups/scoutiq-scoutiq-20260115T023000Z.dump
npm run db:restore -- --yes --clean /srv/scoutiq/data/backups/scoutiq-scoutiq-20260115T023000Z.dump
npm run db:migrate     # apply migrations newer than the dump
```

Because dumps carry no roles or ACLs, the target's database user and password
can differ from the source's. That is the whole point.

## Test your restores

A restore drill on the *other* environment, quarterly:

```bash
npm run db:verify -- --deep
```

If it has never been restored, treat it as untested.
