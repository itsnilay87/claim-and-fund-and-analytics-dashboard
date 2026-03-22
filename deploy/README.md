# Claim Analytics Platform — Deployment Guide

## Architecture

Single-container deployment running three processes via supervisord:

| Process | Role | Port |
|---------|------|------|
| **Nginx** | Reverse proxy + static file server | 80 (exposed) |
| **Node/Express** | API server, spawns Python engine | 3001 (internal) |
| **Python 3.11** | Simulation engine (spawned per run) | — |

```
Browser → :80 Nginx
              ├─ /           → app SPA (static)
              ├─ /dashboard/ → dashboard SPA (static)
              └─ /api/*      → proxy → :3001 Node server
                                         └─ spawns python3 engine/run.py
```

---

## Prerequisites

- **Docker** ≥ 24.0 (local machine + Hetzner server)
- **SSH access** to Hetzner server (root or sudo user)
- ~2 GB disk space on server for the image

Install Docker on a fresh Hetzner Ubuntu server:
```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
```

---

## Local Build & Test

Build the image from the **project root** (`claim-analytics-platform/`):

```bash
cd claim-analytics-platform
docker build -t claim-analytics -f deploy/Dockerfile .
```

Run locally:

```bash
docker run -p 8080:80 --name claim-test claim-analytics
```

Open [http://localhost:8080](http://localhost:8080) — you should see the app.

Stop & remove:

```bash
docker stop claim-test && docker rm claim-test
```

---

## Deploy to Hetzner

### Option A: Using the deploy script

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh YOUR_SERVER_IP
# Or with a specific SSH key:
./deploy/deploy.sh YOUR_SERVER_IP ~/.ssh/hetzner_key
```

The script will:
1. Build the Docker image locally
2. Transfer it to the server via SCP
3. Stop any existing container
4. Start the new container with a persistent volume for simulation runs

### Option B: Manual deployment

```bash
# Build locally
docker build -t claim-analytics -f deploy/Dockerfile .

# Save and transfer
docker save claim-analytics | gzip > /tmp/claim-analytics.tar.gz
scp /tmp/claim-analytics.tar.gz root@YOUR_SERVER_IP:/tmp/

# SSH into server and start
ssh root@YOUR_SERVER_IP
docker load < /tmp/claim-analytics.tar.gz
docker run -d \
  --name claim-analytics \
  -p 80:80 \
  -v claim-analytics-runs:/app/server/runs \
  --restart unless-stopped \
  claim-analytics
```

---

## Updating After Code Changes

Re-run the same deploy command — it rebuilds and replaces the container:

```bash
./deploy/deploy.sh YOUR_SERVER_IP
```

Simulation run data persists in the `claim-analytics-runs` Docker volume.

---

## Operations

### View logs

```bash
# All logs (Nginx + Node)
ssh root@YOUR_SERVER_IP "docker logs -f claim-analytics"

# Last 100 lines
ssh root@YOUR_SERVER_IP "docker logs --tail 100 claim-analytics"
```

### Restart

```bash
ssh root@YOUR_SERVER_IP "docker restart claim-analytics"
```

### Backup simulation data

```bash
ssh root@YOUR_SERVER_IP "docker cp claim-analytics:/app/server/runs /root/backup-runs-$(date +%Y%m%d)"
```

Or pull it locally:

```bash
ssh root@YOUR_SERVER_IP "tar czf /tmp/runs-backup.tar.gz -C / \$(docker inspect claim-analytics-runs --format '{{.Mountpoint}}')"
scp root@YOUR_SERVER_IP:/tmp/runs-backup.tar.gz ./backup/
```

### Shell into the container

```bash
ssh root@YOUR_SERVER_IP "docker exec -it claim-analytics bash"
```

---

## HTTPS with Let's Encrypt (Recommended)

For production use, set up HTTPS using Caddy as a reverse proxy in front of the container:

```bash
# On the Hetzner server
apt-get install -y caddy

# Edit Caddyfile
cat > /etc/caddy/Caddyfile << 'EOF'
claims.yourcompany.com {
    reverse_proxy localhost:8080
}
EOF

# Restart — Caddy auto-provisions TLS certs
systemctl restart caddy
```

Then update the Docker run command to bind to 8080 instead of 80:

```bash
docker run -d \
  --name claim-analytics \
  -p 8080:80 \
  -v claim-analytics-runs:/app/server/runs \
  --restart unless-stopped \
  claim-analytics
```

Point your domain's DNS A record to the server IP, and Caddy handles SSL automatically.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Container won't start | `docker logs claim-analytics` — check for port conflicts |
| API returns 502 | Node server crashed — check logs, likely a Python dependency issue |
| Dashboard shows no data | Run a simulation first via the app, or check `/api/health` |
| Build fails at npm ci | Ensure `package-lock.json` exists in `app/` and `dashboard/` |
| Python engine errors | `docker exec claim-analytics python3 -c "import numpy; print('ok')"` |
