# Production VPS deployment

A production ScoutIQ installation on any VPS or cloud VPS. Nothing here is
specific to a provider: the requirements are a Linux VM, a block device and a
DNS record.

For moving an *existing* installation, follow
[migrate-home-to-vps.md](migrate-home-to-vps.md) instead.

## Sizing

| Profile | vCPU | RAM | Disk | Suitable for |
| --- | --- | --- | --- | --- |
| Minimum | 2 | 4 GB | 60 GB | Single user, one competition |
| Recommended | 4 | 8 GB | 100 GB | Several competitions, multiple seasons |
| Comfortable | 8 | 16 GB | 250 GB | Heavy analytics, many scouts |

Analytics recomputation is the CPU-hungry part; it runs in `worker`, so add
worker replicas rather than a bigger API.

## 1. Server preparation

Follow [debian-vm.md](debian-vm.md) sections 1-4 (base packages, service user,
Docker, storage layout). It is provider-agnostic.

Then harden SSH:

```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'          /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

Unattended security updates:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## 2. Block storage

Put application data on a volume you can detach, snapshot and grow
independently of the OS disk.

```bash
sudo mkfs.ext4 -L scoutiq-data /dev/sdb
sudo mkdir -p /srv/scoutiq/data
echo 'LABEL=scoutiq-data /srv/scoutiq/data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo chown -R scoutiq:scoutiq /srv/scoutiq/data
```

Mount by `LABEL` or `UUID`, never by `/dev/sdb` - device names are not stable
across reboots or provider maintenance.

Then simply:

```env
HOST_DATA_ROOT=/srv/scoutiq/data
```

The application is unaware that anything changed.

## 3. Deploy

```bash
sudo -iu scoutiq
git clone https://github.com/patrickdekker82/ScoutIQ.git /srv/scoutiq/app
cd /srv/scoutiq/app
cp .env.example .env
```

Production `.env` essentials:

```env
NODE_ENV=production
LOG_LEVEL=info

AUTH_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
DATABASE_URL=postgresql://scoutiq:<same password>@postgres:5432/scoutiq?schema=public

PUBLIC_BASE_URL=https://scoutiq.example.com
CORS_ORIGINS=https://scoutiq.example.com
HTTP_PUBLISH=127.0.0.1:3000

HOST_DATA_ROOT=/srv/scoutiq/data
BACKUP_RETENTION_DAYS=14

API_REPLICAS=1
WORKER_REPLICAS=2
```

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com \
  -e SEED_ADMIN_PASSWORD='<strong password>' \
  api seed
```

## 4. Reverse proxy and TLS

TLS terminates in the proxy, never in the application - that keeps certificates
and domains out of the image.

**Caddy** (automatic certificates):

```caddyfile
# /etc/caddy/Caddyfile
scoutiq.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**nginx** equivalent, with certbot:

```nginx
server {
    listen 443 ssl http2;
    server_name scoutiq.example.com;

    ssl_certificate     /etc/letsencrypt/live/scoutiq.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/scoutiq.example.com/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

The API sets `trustProxy`, so it reads the forwarded headers from whichever
proxy you choose.

## 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

PostgreSQL, Redis and port 3000 are never exposed publicly. For maintenance:

```bash
ssh -L 5432:127.0.0.1:5432 scoutiq@vps    # then psql against localhost
```

## 6. Backups

Set up backups on day one ([backups.md](backups.md)):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup up -d
npm run db:backup -- --label initial
npm run db:verify -- --deep
```

Off-site copy - pull from home so the VPS holds no credentials for your NAS:

```cron
# on the home server
0 5 * * * rsync -az --delete vps:/srv/scoutiq/data/backups/ /mnt/nas/scoutiq/vps-backups/
```

Provider snapshots are a useful extra, **not** a substitute: they can capture
PostgreSQL mid-write.

## 7. Monitoring

`/api/health?probe=live` and `/api/health` are enough for any uptime checker; neither
requires authentication and neither leaks data.

```bash
watch -n 30 'curl -s https://scoutiq.example.com/api/health | jq .status'
```

Logs go to stdout in JSON and are picked up by the Docker json-file driver
(rotated at 10 MB x 5 in the prod file). Ship them anywhere - or nowhere; a
self-hosted install is not required to send anything outward.

## 8. Updating

```bash
cd /srv/scoutiq/app
npm run db:backup -- --label pre-upgrade
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f migrate api
```

Rolling back a bad release: [rollback.md](rollback.md).

## 9. Scaling later

The architecture allows separation without a rewrite:

```bash
WORKER_REPLICAS=4 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d worker
```

To move a component to its own machine, drop the local service and repoint the
URL - `DATABASE_URL`, `ANALYTICS_DATABASE_URL`, `REDIS_URL`. Workers coordinate
only through Redis and talk to PostgreSQL only through `DATABASE_URL`, so
nothing in the application assumes co-location. See
[../architecture.md](../architecture.md).
