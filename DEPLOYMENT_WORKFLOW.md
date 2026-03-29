# Deployment Workflow — From Code Change to Production

> **Audience:** Any developer or AI agent making changes to this codebase.
> **Server:** Hetzner Cloud at `178.104.35.208` (Ubuntu + Docker)
> **Database:** PostgreSQL 16 (Docker container, internal network only)
> **CI/CD:** GitHub Actions → GHCR → SSH deploy

---

## Quick Reference (TL;DR)

```bash
# 1. Make your code changes locally
# 2. Commit and push
cd claim-analytics-platform
git add .
git commit -m "fix: describe what you changed"
git push

# 3. Monitor the pipeline (~4 min)
gh run list --limit 1          # see if triggered
gh run watch                   # live tail the run

# 4. Verify on server
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 20"
# Then visit http://178.104.35.208 in the browser
```

That's it. Every push to `main` auto-deploys.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                  Hetzner Server (178.104.35.208)              │
│                                                              │
│  ┌── Docker Compose ──────────────────────────────────────┐  │
│  │                                                        │  │
│  │  web container (Supervisord)                           │  │
│  │  ┌──────────────┐  ┌──────────────────────────────┐    │  │
│  │  │   Nginx :80  │  │  Node/Express :3001          │    │  │
│  │  │              │  │  ┌────────────────────────┐   │    │  │
│  │  │ /     → app  │  │  │ Python Engine          │   │    │  │
│  │  │ /dashboard/  │  │  │ (spawned per sim run)  │   │    │  │
│  │  │ /api/ → :3001│  │  └────────────────────────┘   │    │  │
│  │  └──────────────┘  └───────────┬──────────────────┘    │  │
│  │                                │ DATABASE_URL          │  │
│  │  db container                  │                       │  │
│  │  ┌─────────────────────────────▼──┐                    │  │
│  │  │  PostgreSQL 16 :5432 (internal)│                    │  │
│  │  │  Tables: users, claims,        │                    │  │
│  │  │  portfolios, simulation_runs,  │                    │  │
│  │  │  workspaces, refresh_tokens    │                    │  │
│  │  └────────────────────────────────┘                    │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Volumes: runs-data → /app/server/runs (simulation outputs)  │
│           pgdata    → /var/lib/postgresql/data (DB files)     │
│                                                              │
│  Networks: internal (PostgreSQL — never exposed publicly)     │
│            default  (web container — port 80 exposed)         │
└──────────────────────────────────────────────────────────────┘
```

| Layer | Tech | Files |
|-------|------|-------|
| **Frontend App** | React 18, Vite 5, Tailwind, Zustand | `app/` |
| **Dashboard** | React 18, Vite 6, Recharts, D3, Plotly | `dashboard/` |
| **API Server** | Node.js 20, Express 4, JWT auth, `pg` | `server/` |
| **Database** | PostgreSQL 16 (Alpine), auto-migrations | `server/db/` |
| **Python Engine** | Python 3.11, NumPy, SciPy | `engine/` |
| **Deploy Config** | Docker Compose, Nginx, Supervisord | `deploy/` |

---

## Prerequisites (One-Time Setup)

These are already configured for this project. Only needed if setting up from scratch.

### 1. GitHub CLI & Auth
```bash
gh auth login          # authenticate with GitHub
gh auth setup-git      # configure git credential helper
```

### 2. GitHub Secrets (Settings → Secrets → Actions)

| Secret | Value | Purpose |
|--------|-------|---------|
| `DEPLOY_HOST` | `178.104.35.208` | Hetzner server IP |
| `DEPLOY_SSH_KEY` | Ed25519 private key | SSH into server |
| `GHCR_PAT` | Classic PAT with `write:packages` | Push images to GHCR |

### 3. Docker on Server
```bash
ssh root@178.104.35.208
curl -fsSL https://get.docker.com | sh
```

### 4. Production Environment Variables

On first deploy, `deploy/deploy.sh` auto-generates `deploy/.env` from `deploy/.env.example`. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `POSTGRES_USER` | `cap_user` | PostgreSQL username |
| `POSTGRES_PASSWORD` | *(auto-generated)* | PostgreSQL password |
| `POSTGRES_DB` | `claim_analytics` | Database name |
| `DATABASE_URL` | `postgresql://cap_user:<pass>@db:5432/claim_analytics` | Full connection string used by Node server |
| `JWT_SECRET` | *(auto-generated)* | JWT signing key for auth tokens |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS |

---

## Local Development Setup

### PostgreSQL for Local Dev

Before running the server locally, you need a PostgreSQL instance. Automated scripts handle this:

**Windows (PowerShell):**
```powershell
.\server\db\setup-local.ps1
```

**macOS/Linux:**
```bash
./server/db/setup-local.sh
```

These scripts:
1. Start a `cap-postgres` Docker container on port 5432 (PostgreSQL 16)
2. Wait for the database to be ready
3. Run all migrations automatically
4. Print the `DATABASE_URL` env var for your shell

Default local credentials: `cap_user` / `cap_dev_pass` / `claim_analytics` database.

**If port 5432 is already occupied** (common after a previous dev session):
```powershell
# Windows — stop the existing container
docker stop cap-postgres

# Or kill whatever is using port 5432
Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# macOS/Linux — stop the existing container
docker stop cap-postgres

# Or kill whatever is using port 5432
lsof -ti:5432 | xargs kill -9
```

### Running the Development Server

After PostgreSQL is running:

```bash
cd claim-analytics-platform

# Set DATABASE_URL if not already set by setup script
# Windows PowerShell:
$env:DATABASE_URL = "postgresql://cap_user:cap_dev_pass@localhost:5432/claim_analytics"
# macOS/Linux:
export DATABASE_URL="postgresql://cap_user:cap_dev_pass@localhost:5432/claim_analytics"

# Start all three services
npm run dev
```

This starts:
- Express server on `http://localhost:3001` (connects to local PostgreSQL)
- App on `http://localhost:5180`
- Dashboard on `http://localhost:5173`

**Or start individually:**
```bash
npm run dev:server      # Express on :3001
npm run dev:app         # App on :5180
npm run dev:dashboard   # Dashboard on :5173
```

**Run Python tests:**
```bash
cd engine
python -m pytest tests/ -v
```

### Freeing Occupied Ports

If `npm run dev` fails because a port is in use:

```powershell
# Windows — kill processes on common ports
# Port 3001 (Express)
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Port 5173 (Dashboard Vite)
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Port 5180 (App Vite)
Get-NetTCPConnection -LocalPort 5180 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Kill ALL node processes (nuclear option)
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

```bash
# macOS/Linux
lsof -ti:3001 | xargs kill -9    # Express
lsof -ti:5173 | xargs kill -9    # Dashboard Vite
lsof -ti:5180 | xargs kill -9    # App Vite
killall node                      # nuclear option
```

---

## Step-by-Step: Deploying a Code Change

### Step 1 — Make Changes Locally

Edit files in VS Code. The codebase lives at:
```
claim-analytics-platform/
  app/           ← React app (Login, Claims, Portfolios, Simulation)
  dashboard/     ← React dashboard (Charts, Results Viewer)
  server/        ← Express API server + JWT auth + PostgreSQL models
  server/db/     ← Database pool, migrations, models (User, Claim, etc.)
  engine/        ← Python simulation engine
  deploy/        ← Docker Compose, Dockerfile, Nginx, Supervisor configs
```

### Step 2 — Test Locally (Optional but Recommended)

See [Local Development Setup](#local-development-setup) above.

### Step 3 — Commit and Push

```bash
cd claim-analytics-platform
git add .
git commit -m "fix: brief description of changes"
git push
```

> **Commit message conventions:**
> - `fix: ...` for bug fixes
> - `feat: ...` for new features
> - `refactor: ...` for code cleanup
> - `docs: ...` for documentation
> - `style: ...` for CSS/UI changes

### Step 4 — Pipeline Runs Automatically

The push triggers `.github/workflows/deploy.yml` which:

1. **Checks out code** from `main`
2. **Builds Docker image** (multi-stage: frontend build → production runtime)
3. **Pushes image** to `ghcr.io/itsnilay87/claim-analytics-platform:latest`
4. **SSHs into Hetzner** server
5. **Pulls the new image** and restarts the container
6. **Migrations run automatically** — the Node server runs pending migrations on boot

### Step 5 — Monitor Pipeline

```bash
# Check if pipeline triggered
gh run list --limit 3

# Watch the run in real-time
gh run watch

# Or view a specific run
gh run view <RUN_ID> --json status,conclusion,jobs
```

**Pipeline dashboard:** https://github.com/itsnilay87/claim-analytics-platform/actions

### Step 6 — Verify on Production

```bash
# Health check (should return: {"status":"ok","server":"ok","database":"ok",...})
ssh root@178.104.35.208 "curl -s http://localhost/api/health"

# Container status (should show both web and db containers)
ssh root@178.104.35.208 "docker ps"

# Recent logs
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 50"
```

Then open `http://178.104.35.208` in your browser (clear cache with Ctrl+Shift+R).

---

## Database Management

### Migrations

Migrations live in `server/db/migrations/` as numbered SQL files:
- `001_initial_schema.sql` — Users, claims, portfolios, workspaces, simulation_runs, refresh_tokens
- `002_add_saved_column.sql` — Saved flag + name for simulation runs

**Migrations run automatically** on server boot (in `server/server.js`). The migration runner (`server/db/migrate.js`) tracks applied migrations in a `_migrations` table and wraps each in a transaction.

**Run migrations manually** (production):
```bash
ssh root@178.104.35.208 "cd /opt/claim-analytics-platform && docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T web node server/db/migrate.js"
```

**Run migrations manually** (local dev):
```bash
cd claim-analytics-platform
node server/db/migrate.js
```

### Adding a New Migration

1. Create a new SQL file: `server/db/migrations/003_your_change.sql`
2. Write idempotent SQL (use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.)
3. Commit, push — migration runs automatically on deploy

### Connect to Production Database

PostgreSQL is on an internal Docker network and is **never exposed publicly** (no port mapping). Access it through the web container:

```bash
ssh root@178.104.35.208 "docker compose -f /opt/claim-analytics-platform/deploy/docker-compose.yml exec db psql -U cap_user -d claim_analytics"
```

### Backup & Restore

```bash
# Backup
ssh root@178.104.35.208 "docker compose -f /opt/claim-analytics-platform/deploy/docker-compose.yml exec -T db pg_dump -U cap_user claim_analytics" > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260327.sql | ssh root@178.104.35.208 "docker compose -f /opt/claim-analytics-platform/deploy/docker-compose.yml exec -T db psql -U cap_user -d claim_analytics"
```

---

## Debugging Production Issues

### View Server Logs
```bash
# All logs (Nginx + Node combined via Supervisor)
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 100"

# Follow logs live
ssh root@178.104.35.208 "docker logs -f claim-analytics-web-1"

# Only errors from the last hour
ssh root@178.104.35.208 "docker logs --since 1h claim-analytics-web-1 2>&1 | grep -i error"

# PostgreSQL logs
ssh root@178.104.35.208 "docker logs claim-analytics-platform-db-1 --tail 50"
```

### Shell Into Running Container
```bash
ssh root@178.104.35.208 "docker exec -it claim-analytics-web-1 bash"

# Inside container:
curl http://localhost:3001/api/health          # test Node server
python3 -c "import numpy; print('ok')"        # test Python deps
ls /app/static/app/                            # check app build exists
ls /app/static/dashboard/                      # check dashboard build
cat /etc/nginx/sites-available/default         # check Nginx config
node server/db/migrate.js                      # re-run migrations
```

### Restart Without Re-deploying
```bash
ssh root@178.104.35.208 "cd /opt/claim-analytics && docker compose restart"
```

### Force Re-pull and Restart
```bash
ssh root@178.104.35.208 "cd /opt/claim-analytics && docker compose pull && docker compose up -d"
```

### Port 80 Already Occupied (Common After Restart)

If Docker fails with `port is already allocated`:
```bash
ssh root@178.104.35.208 "docker stop \$(docker ps -q) 2>/dev/null; docker rm \$(docker ps -aq) 2>/dev/null; sleep 2; cd /opt/claim-analytics && docker compose up -d"
```

Or more targeted:
```bash
# Find what's using port 80
ssh root@178.104.35.208 "lsof -i :80 | head -5"

# Stop and remove the specific container
ssh root@178.104.35.208 "docker compose -f /opt/claim-analytics-platform/deploy/docker-compose.yml down && docker compose -f /opt/claim-analytics-platform/deploy/docker-compose.yml up -d"
```

### Rollback to Previous Image
```bash
# Every push tags the image with the git SHA
ssh root@178.104.35.208 "docker pull ghcr.io/itsnilay87/claim-analytics-platform:<GIT_SHA>"
ssh root@178.104.35.208 "cd /opt/claim-analytics && sed -i 's/:latest/:GIT_SHA/' docker-compose.yml && docker compose up -d"
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pipeline fails at "Build Docker image" | Frontend build error (lint/type) | Check `gh run view <ID> --log` for the exact error, fix locally |
| Pipeline fails at "Deploy to production" | SSH key issue or server down | Verify `ssh root@178.104.35.208` works manually |
| Site loads but shows blank page | JS build error, check browser console | Hard refresh (Ctrl+Shift+R), check `docker logs` |
| API returns 502 | Node server crashed inside container | `docker logs claim-analytics-web-1` — fix the crash and push |
| `crypto.randomUUID` error | Plain HTTP + browser security | Already fixed with `utils/uuid.js` fallback |
| Simulation hangs/fails | Python engine error | Check logs for Python traceback, fix in `engine/` |
| Dashboard shows no data | No simulation run yet, or API path wrong | Run a simulation first, verify `/api/health` returns OK |
| `git push` rejected | Auth expired | `gh auth login` then `gh auth setup-git` |
| GHCR push fails | PAT expired | Create new classic PAT at github.com → Settings → Tokens |
| Health returns `"database":"degraded"` | PostgreSQL not running or connection refused | Check DB container: `docker ps`, restart: `docker compose restart db` |
| `ECONNREFUSED 5432` in local dev | Local PostgreSQL not running | Run `.\server\db\setup-local.ps1` or `docker start cap-postgres` |
| Port 80 already allocated on deploy | Stale container holding the port | Stop all containers: `docker stop $(docker ps -q)`, then re-deploy |
| Port 3001/5173/5180 busy locally | Leftover node processes | `Get-Process -Name node \| Stop-Process -Force` (Windows) |
| Login/register fails with 500 | Missing `JWT_SECRET` env var | Ensure `deploy/.env` has `JWT_SECRET` set |
| `relation "users" does not exist` | Migrations not run | Run `node server/db/migrate.js` or restart web container |

---

## File Map — What to Edit for Common Tasks

| Task | Files to Edit |
|------|---------------|
| Fix a UI bug in the app | `app/src/pages/`, `app/src/components/` |
| Fix a dashboard chart | `dashboard/src/components/` |
| Fix an API endpoint | `server/routes/`, `server/services/` |
| Fix simulation logic | `engine/v2_core/v2_*.py` |
| Fix jurisdiction defaults | `engine/jurisdictions/*.json`, `server/config/defaults.json` |
| Add a new API route | `server/routes/` → register in `server/server.js` |
| Add a new page | `app/src/pages/` → add route in `app/src/App.jsx` |
| Add a new store | `app/src/store/` → import in consuming components |
| Add a DB migration | `server/db/migrations/NNN_description.sql` |
| Add a new DB model | `server/db/models/` → export in `server/db/models/index.js` |
| Change DB connection config | `server/db/pool.js`, `deploy/.env.example` |
| Change Nginx routing | `deploy/nginx.conf` |
| Change Docker build | `deploy/Dockerfile` |
| Change Docker Compose | `deploy/docker-compose.yml` |
| Change CI/CD pipeline | `.github/workflows/deploy.yml` |

---

## Server Info

| Property | Value |
|----------|-------|
| **IP** | 178.104.35.208 |
| **OS** | Ubuntu |
| **Docker version** | 29.3+ |
| **Web container** | claim-analytics-web-1 |
| **DB container** | claim-analytics-platform-db-1 |
| **PostgreSQL version** | 16 (Alpine) |
| **DB name** | claim_analytics |
| **DB user** | cap_user |
| **DB port** | 5432 (internal only — not exposed to host) |
| **Compose file** | /opt/claim-analytics-platform/deploy/docker-compose.yml |
| **Env file** | /opt/claim-analytics-platform/deploy/.env |
| **Data volumes** | runs-data → /app/server/runs, pgdata → PostgreSQL data |
| **GitHub repo** | github.com/itsnilay87/claim-analytics-platform (private) |
| **GHCR image** | ghcr.io/itsnilay87/claim-analytics-platform |
| **SSH user** | root |
| **SSH key type** | Ed25519 |

---

## Port Reference

| Port | Service | Scope | Notes |
|------|---------|-------|-------|
| **80** | Nginx (public) | External | App, dashboard, API proxy |
| **3001** | Node/Express | Internal (container) | API server, proxied by Nginx |
| **5432** | PostgreSQL | Internal (Docker network) | **Never** exposed to host or internet |
| **5173** | Vite (dashboard dev) | Local dev only | `npm run dev:dashboard` |
| **5180** | Vite (app dev) | Local dev only | `npm run dev:app` |
