# Debian / Ubuntu server setup

Applies unchanged to a Debian VM under Hyper-V, a physical Debian/Ubuntu
server, a VPS or a cloud VPS. Only Docker is installed - Node.js, Python,
PostgreSQL and Playwright stay inside containers.

Tested on Debian 12/13 and Ubuntu 22.04/24.04.

## 1. Base system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
sudo timedatectl set-timezone Europe/Amsterdam
```

## 2. Service user

Run the stack as an unprivileged user, not root:

```bash
sudo adduser --disabled-password --gecos "" scoutiq
sudo usermod -aG sudo scoutiq
```

## 3. Docker Engine

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker scoutiq
```

> On Ubuntu replace `linux/debian` with `linux/ubuntu` in both lines.

Log out and back in, then verify:

```bash
docker run --rm hello-world
docker compose version
```

## 4. Storage layout

Pick any location; the application only ever sees `/data` inside the container.

```bash
sudo mkdir -p /srv/scoutiq/data/{raw,exports,reports,backups}
sudo chown -R scoutiq:scoutiq /srv/scoutiq
```

If the data lives on a separate disk or volume, mount it at `/srv/scoutiq/data`
and add it to `/etc/fstab`. Nothing else changes.

## 5. Deploy ScoutIQ

```bash
sudo -iu scoutiq
git clone https://github.com/patrickdekker82/ScoutIQ.git /srv/scoutiq/app
cd /srv/scoutiq/app

cp .env.example .env
printf 'AUTH_SECRET=%s\n'       "$(openssl rand -hex 32)" >> .env
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> .env
printf 'HOST_DATA_ROOT=%s\n'    "/srv/scoutiq/data"       >> .env

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 3000 stays closed: the API binds to `127.0.0.1` and is reached through the
reverse proxy.

## 7. Start on boot

Compose restart policies (`restart: unless-stopped`) handle reboots once Docker
is enabled:

```bash
sudo systemctl enable docker
```

For a stack that must come up in a defined order after boot, add a unit:

```ini
# /etc/systemd/system/scoutiq.service
[Unit]
Description=ScoutIQ
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=scoutiq
WorkingDirectory=/srv/scoutiq/app
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml down

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now scoutiq
```

## 8. Verify

```bash
curl -s http://127.0.0.1:3000/health/ready | jq
docker compose ps
```

## 9. Updating

```bash
cd /srv/scoutiq/app
npm run db:backup                # always back up before an update
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies any new migrations before the API starts.
