# Deployment Workflow — From Code Change to Production

> **Audience:** Any developer or AI agent making changes to this codebase.
> **Server:** Hetzner Cloud at `178.104.35.208` (Ubuntu + Docker)
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
│  Docker Container (single)                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Supervisord (process manager)                         │  │
│  │  ┌──────────────┐  ┌──────────────────────────────┐    │  │
│  │  │   Nginx :80  │  │  Node/Express :3001          │    │  │
│  │  │              │  │  ┌────────────────────────┐   │    │  │
│  │  │ /     → app  │  │  │ Python Engine          │   │    │  │
│  │  │ /dashboard/  │  │  │ (spawned per sim run)  │   │    │  │
│  │  │ /api/ → :3001│  │  └────────────────────────┘   │    │  │
│  │  └──────────────┘  └──────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Volume: runs-data → /app/server/runs (persistent)           │
└──────────────────────────────────────────────────────────────┘
```

| Layer | Tech | Files |
|-------|------|-------|
| **Frontend App** | React 18, Vite 5, Tailwind, Zustand | `app/` |
| **Dashboard** | React 18, Vite 6, Recharts, D3, Plotly | `dashboard/` |
| **API Server** | Node.js 20, Express 4 | `server/` |
| **Python Engine** | Python 3.11, NumPy, SciPy | `engine/` |
| **Deploy Config** | Docker, Nginx, Supervisord | `deploy/` |

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

---

## Step-by-Step: Deploying a Code Change

### Step 1 — Make Changes Locally

Edit files in VS Code. The codebase lives at:
```
claim-analytics-platform/
  app/           ← React app (Login, Claims, Portfolios, Simulation)
  dashboard/     ← React dashboard (Charts, Results Viewer)
  server/        ← Express API server
  engine/        ← Python simulation engine
  deploy/        ← Docker + Nginx + Supervisor configs
```

### Step 2 — Test Locally (Optional but Recommended)

**Start all three services in dev mode:**
```bash
cd claim-analytics-platform
npm run dev
```
This starts:
- Express server on `http://localhost:3001`
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
# Health check
ssh root@178.104.35.208 "curl -s http://localhost/api/health"

# Container status
ssh root@178.104.35.208 "docker ps"

# Recent logs
ssh root@178.104.35.208 "docker logs claim-analytics-web-1 --tail 50"
```

Then open `http://178.104.35.208` in your browser (clear cache with Ctrl+Shift+R).

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
```

### Restart Without Re-deploying
```bash
ssh root@178.104.35.208 "cd /opt/claim-analytics && docker compose restart"
```

### Force Re-pull and Restart
```bash
ssh root@178.104.35.208 "cd /opt/claim-analytics && docker compose pull && docker compose up -d"
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
| Change Nginx routing | `deploy/nginx.conf` |
| Change Docker build | `deploy/Dockerfile` |
| Change CI/CD pipeline | `.github/workflows/deploy.yml` |

---

## Server Info

| Property | Value |
|----------|-------|
| **IP** | 178.104.35.208 |
| **OS** | Ubuntu |
| **Docker version** | 29.3+ |
| **Container name** | claim-analytics-web-1 |
| **Compose location** | /opt/claim-analytics/docker-compose.yml |
| **Data volume** | runs-data → /app/server/runs |
| **GitHub repo** | github.com/itsnilay87/claim-analytics-platform (private) |
| **GHCR image** | ghcr.io/itsnilay87/claim-analytics-platform |
| **SSH user** | root |
| **SSH key type** | Ed25519 |
