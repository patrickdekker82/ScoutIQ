# NAS storage (optional)

The home environment uses a Synology DS920+. ScoutIQ treats the NAS as
**optional infrastructure**: it is a place to put copies, never a dependency.

> **Rule:** if the NAS is switched off, unplugged or replaced tomorrow, ScoutIQ
> keeps running. Only the archive copies stop being made. This is enforced by
> tests (`tests/storage.test.ts`), not just by convention.

## What the NAS is used for

| Purpose | Mechanism | Required? |
| --- | --- | --- |
| Database backup copies | `ARCHIVE_ROOT` in `scripts/db-backup.sh` | No |
| Raw dataset archives | `Storage.archive()` after each import | No |
| Exported reports | `Storage.archive()` after each render | No |

What it is **never** used for: the live database, Redis, application state, or
anything on the request path.

## Mounting inside the Debian VM

Mount on the Linux host that runs Docker - never on the Windows host passed
through to the VM. That keeps the mount reproducible on any future machine.

```bash
sudo apt install -y nfs-common          # NFS
# or
sudo apt install -y cifs-utils          # SMB/CIFS
sudo mkdir -p /mnt/nas/scoutiq
```

### NFS

Enable NFS on the Synology (Control Panel > File Services) and grant the
Debian VM access to the shared folder.

```
# /etc/fstab
nas.lan:/volume1/scoutiq  /mnt/nas/scoutiq  nfs  rw,soft,timeo=50,retrans=2,_netdev,nofail  0 0
```

### SMB/CIFS

```bash
sudo install -m 600 /dev/null /etc/scoutiq-nas.cred
printf 'username=scoutiq\npassword=...\n' | sudo tee /etc/scoutiq-nas.cred >/dev/null
```

```
# /etc/fstab
//nas.lan/scoutiq  /mnt/nas/scoutiq  cifs  credentials=/etc/scoutiq-nas.cred,uid=1001,gid=1001,soft,_netdev,nofail  0 0
```

```bash
sudo mount -a && touch /mnt/nas/scoutiq/.writetest && rm /mnt/nas/scoutiq/.writetest
```

### Mount options that matter

| Option | Why |
| --- | --- |
| `nofail` | The VM boots even when the NAS is down |
| `soft` (NFS) / `soft` (CIFS) | I/O fails instead of hanging forever |
| `_netdev` | Wait for the network before mounting |

A `hard` NFS mount can wedge a container that touches the path. Always `soft`.

## Wiring it into ScoutIQ

```env
# .env
ARCHIVE_ROOT=/mnt/nas/scoutiq
HOST_DATA_ROOT=/srv/scoutiq/data
```

and mount it into the containers that write archives:

```yaml
# docker-compose.override.yml
services:
  api:
    volumes:
      - /mnt/nas/scoutiq:/mnt/nas/scoutiq
  worker:
    volumes:
      - /mnt/nas/scoutiq:/mnt/nas/scoutiq
```

The container path is arbitrary - `ARCHIVE_ROOT` just has to match it.

Verify:

```bash
curl -s http://127.0.0.1:3000/health/ready | jq '.checks.archive'
# "ok" | "unavailable (optional)" | "not configured (optional)"
```

An unavailable archive **never** makes readiness fail.

## Behaviour when the NAS disappears

| Operation | Result |
| --- | --- |
| Import | Succeeds; raw payload stays under `RAW_DATA_ROOT`, archive skipped |
| Report render | Succeeds; report stays under `REPORT_ROOT`, archive skipped |
| `npm run db:backup` | Succeeds; logs a warning, keeps the local dump |
| `/health/ready` | Returns 200 with `archive: "unavailable (optional)"` |

## Replacing the NAS later

Because everything goes through `ARCHIVE_ROOT`, the replacement is a mount
change and a one-line `.env` edit:

| Target | Mount |
| --- | --- |
| VPS block storage | `mount /dev/sdb1 /mnt/archive` |
| S3-compatible object storage | `rclone mount` / `s3fs` to `/mnt/archive` |
| Another NAS | New NFS/CIFS entry in `/etc/fstab` |

```env
ARCHIVE_ROOT=/mnt/archive
```

**No application code changes are required.**
