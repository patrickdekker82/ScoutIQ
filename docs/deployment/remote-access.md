# Remote access

ScoutIQ is **LAN-only by default** and requires no internet access to run
(§65, §67). Nothing here is needed for normal use at home.

## Default: LAN only

The web container binds to `127.0.0.1:3000` inside the VM and a reverse proxy
publishes it on the LAN.

```
http://<vm-ip>          → reverse proxy → 127.0.0.1:3000
http://scoutiq.local    → same, via mDNS or a hosts entry
```

PostgreSQL, Redis and pgAdmin are never published beyond the host.

### Caddy

```caddyfile
# /etc/caddy/Caddyfile
:80 {
    reverse_proxy 127.0.0.1:3000
}
```

### nginx

```nginx
server {
    listen 80;
    server_name scoutiq.local;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### Naming the machine on your LAN (§66)

Give the VM a DHCP reservation in the router, then either:

- **mDNS** — `sudo apt install avahi-daemon`, then `http://scoutiq.local`
- **Router DNS** — add a static entry for `scoutiq.lan`
- **Hosts file** — on each client:
  - Linux/macOS: `/etc/hosts`
  - Windows: `C:\Windows\System32\drivers\etc\hosts`
  ```
  192.0.2.25   scoutiq.local
  ```

Set `PUBLIC_BASE_URL` to whatever you chose. It is only used to build links
inside reports; nothing else depends on it.

## Reaching ScoutIQ from outside the house

Port forwarding is deliberately **not** assumed and not recommended. Each option
below works without any application change (§67).

### 1. Tailscale or WireGuard (recommended)

A private network between your devices and the VM. Nothing is exposed to the
internet.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then reach ScoutIQ on its Tailscale address. No firewall rule, no certificate,
no DNS record.

### 2. SSH tunnel

Zero setup beyond SSH:

```bash
ssh -L 3000:127.0.0.1:3000 scoutiq@your-vm      # the app
ssh -L 5432:127.0.0.1:5432 scoutiq@your-vm      # psql / DBeaver
```

### 3. Cloudflare Tunnel

Publishes a hostname without opening a port:

```bash
cloudflared tunnel create scoutiq
cloudflared tunnel route dns scoutiq scoutiq.example.com
cloudflared tunnel run --url http://127.0.0.1:3000 scoutiq
```

### 4. Public reverse proxy with TLS

Only when the deployment genuinely belongs on the internet - normally a VPS
rather than the house. See [production-vps.md](production-vps.md).

## If you do expose it

- Terminate TLS in the proxy; never in the application.
- Keep PostgreSQL, Redis and pgAdmin unpublished.
- Set `CORS_ORIGINS` to the exact origin.
- Rotate `AUTH_SECRET` and use a strong admin password.
- Keep `LOGIN_RATE_LIMIT_MAX` low.
- Watch `audit_logs` for failed logins:

```sql
SELECT "createdAt", summary, ip FROM audit_logs
WHERE action = 'auth.login_failed' ORDER BY "createdAt" DESC LIMIT 50;
```

## What must never be exposed

| Service | Rule |
| --- | --- |
| PostgreSQL 5432 | Never public. Tunnel or use the compose network. |
| Redis 6379 | Never public. No authentication is configured by default. |
| pgAdmin 5050 | Localhost or VPN only. |
| The worker/scheduler | No listening ports at all. |
