#!/bin/bash
# ─────────────────────────────────────────────────────────
#  Deploy Claim Analytics Platform to Hetzner server
#  Uses docker-compose with PostgreSQL + web services
#
#  Usage: ./deploy.sh <server-ip> [ssh-key-path]
#
#  Example:
#    ./deploy.sh 168.119.42.100
#    ./deploy.sh 168.119.42.100 ~/.ssh/hetzner_key
#
#  Prerequisites on server:
#    - Docker & Docker Compose installed
#    - Git installed
#    - SSH access as root
# ─────────────────────────────────────────────────────────

set -euo pipefail

SERVER="${1:?Usage: ./deploy.sh <server-ip> [ssh-key-path]}"
SSH_KEY="${2:-$HOME/.ssh/id_rsa}"
REMOTE_DIR="/opt/claim-analytics-platform"
REPO_URL="https://github.com/itsnilay87/claim-analytics-platform.git"

echo "═══════════════════════════════════════════════════"
echo "  Deploying to $SERVER"
echo "═══════════════════════════════════════════════════"

ssh -i "$SSH_KEY" "root@${SERVER}" << 'REMOTE_EOF'
  set -e

  REMOTE_DIR="/opt/claim-analytics-platform"
  REPO_URL="https://github.com/itsnilay87/claim-analytics-platform.git"

  # ── 1. Install Docker if needed ──
  if ! command -v docker &>/dev/null; then
    echo "▸ Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  fi

  # ── 2. Clone or pull repo ──
  if [ -d "$REMOTE_DIR/.git" ]; then
    echo "▸ Pulling latest code..."
    cd "$REMOTE_DIR"
    git pull origin main
  else
    echo "▸ Cloning repository..."
    git clone "$REPO_URL" "$REMOTE_DIR"
    cd "$REMOTE_DIR"
  fi

  # ── 3. Create .env if it doesn't exist ──
  if [ ! -f deploy/.env ]; then
    echo "▸ Creating deploy/.env from template..."
    cp deploy/.env.example deploy/.env
    # Generate secure random passwords
    PG_PASS=$(openssl rand -hex 16)
    JWT_SEC=$(openssl rand -hex 48)
    # Replace POSTGRES_PASSWORD first
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" deploy/.env
    # Rebuild DATABASE_URL with the same password (guarantees sync)
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://cap_user:${PG_PASS}@db:5432/claim_analytics|" deploy/.env
    # Replace JWT_SECRET
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SEC}|" deploy/.env
    echo "  ✓ .env created with generated secrets"
    echo "  ⚠ SAVE THESE — stored in deploy/.env on server"
  else
    echo "  ✓ deploy/.env already exists"
  fi

  # ── 4. Backup database before any destructive operations ──
  BACKUP_DIR="$REMOTE_DIR/backups"
  mkdir -p "$BACKUP_DIR"
  DB_CONTAINER=$(docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps -q db 2>/dev/null || true)
  if [ -n "$DB_CONTAINER" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/pg_backup_${TIMESTAMP}.sql.gz"
    echo "▸ Backing up PostgreSQL database..."
    if docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
        pg_dump -U cap_user -d claim_analytics --no-owner --clean 2>/dev/null | gzip > "$BACKUP_FILE"; then
      BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
      echo "  ✓ Backup saved: $BACKUP_FILE ($BACKUP_SIZE)"
      # Keep only the last 10 backups to save disk space
      ls -t "$BACKUP_DIR"/pg_backup_*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
    else
      echo "  ⚠ Backup failed (DB may not be running yet — first deploy?)"
      rm -f "$BACKUP_FILE"
    fi
  else
    echo "  ⚠ No existing DB container found — skipping backup (first deploy?)"
  fi

  # ── 5. Stop old single-container setup if running ──
  docker stop claim-analytics 2>/dev/null && docker rm claim-analytics 2>/dev/null && echo "  ✓ Old container stopped" || true

  # ── 6. Build and start with docker-compose ──
  # NOTE: Always force --no-cache for the web image because Docker's layer
  # cache occasionally fails to detect frontend source changes (Vite
  # bundles get reused). A clean build guarantees the latest commit is
  # actually shipped to /app/static/app inside the container.
  echo "▸ Building web image (no-cache to guarantee fresh frontend bundle)..."
  cd "$REMOTE_DIR"
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml build --no-cache web
  echo "▸ Starting services (web + PostgreSQL)..."
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d

  # ── 7. Wait for DB healthy ──
  echo "▸ Waiting for PostgreSQL to be ready..."
  for i in $(seq 1 30); do
    if docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db pg_isready -U cap_user -d claim_analytics &>/dev/null; then
      echo "  ✓ PostgreSQL ready"
      break
    fi
    sleep 2
  done

  # ── 7b. Reconcile DB role password with deploy/.env ──
  # The pgdata volume persists across deploys, so the cap_user role retains
  # whatever password was in effect when initdb first ran. If deploy/.env is
  # ever rotated (manually or by an out-of-band script) without re-initialising
  # the volume, the web service will fail to authenticate. This step is
  # idempotent: ALTER USER … WITH PASSWORD is a no-op when the password
  # already matches, and otherwise restores the invariant
  #   role(cap_user).password === POSTGRES_PASSWORD in deploy/.env
  # NEVER drop or recreate the pgdata volume here — that would destroy data.
  echo "▸ Reconciling DB role password with deploy/.env..."
  ENV_PG_PASS=$(grep -E '^POSTGRES_PASSWORD=' deploy/.env | head -n1 | cut -d= -f2-)
  if [ -z "${ENV_PG_PASS}" ]; then
    echo "  ✗ POSTGRES_PASSWORD missing from deploy/.env — aborting"
    exit 1
  fi
  # psql variable substitution (`:'var'`) only happens for input read from
  # stdin or -f, NOT for -c. Pipe SQL via stdin so :'new_pw' is properly
  # quoted by psql itself — safe against any character in the password.
  if docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
       exec -T db psql -U cap_user -d claim_analytics -X --quiet \
       --set=ON_ERROR_STOP=1 --set=new_pw="${ENV_PG_PASS}" <<'SQL' >/dev/null
ALTER USER cap_user WITH PASSWORD :'new_pw';
SQL
  then
    echo "  ✓ DB role password aligned with deploy/.env"
  else
    echo "  ✗ Failed to align DB role password — web auth may fail"
    exit 1
  fi

  # ── 7c. Verify SCRAM auth via the real network path (web → db:5432) ──
  # pg_hba.conf grants `trust` to 127.0.0.1, so a localhost psql test would
  # succeed even with a wrong password. Verifying from the web container
  # over the internal docker network forces real SCRAM-SHA-256 auth and
  # catches stale baked-in env vars in the running web container that a
  # role-password reset alone cannot fix.
  echo "▸ Verifying web → db SCRAM auth over internal network..."
  if ! docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
         exec -T web sh -c "PGPASSWORD='${ENV_PG_PASS}' psql -h db -U cap_user -d claim_analytics -tAc 'select 1' 2>&1" \
       | grep -q '^1$'; then
    echo "  ⚠ SCRAM auth failed — web container has a stale baked DATABASE_URL."
    echo "    Force-recreating web so it picks up the current deploy/.env..."
    docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
      up -d --force-recreate --no-deps web
    # give web time to come back before migrations run
    for i in $(seq 1 15); do
      if docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
           exec -T web sh -c "PGPASSWORD='${ENV_PG_PASS}' psql -h db -U cap_user -d claim_analytics -tAc 'select 1' 2>/dev/null" \
         | grep -q '^1$'; then
        echo "  ✓ web container recreated and SCRAM auth verified"
        break
      fi
      sleep 2
    done
  else
    echo "  ✓ web → db SCRAM auth verified"
  fi

  # ── 8. Run database migrations ──
  echo "▸ Running database migrations..."
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T web node server/db/migrate.js

  # ── 9. Verify ──
  echo ""
  echo "▸ Verifying health..."
  sleep 3
  HEALTH=$(curl -s http://localhost/api/health || echo '{"error":"unreachable"}')
  echo "  Health: $HEALTH"

  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  ✓ Deployment complete!"
  echo "  ✓ Access at http://$(curl -s ifconfig.me)"
  echo "  ✓ Logs: docker compose -f deploy/docker-compose.yml logs -f"
  echo "═══════════════════════════════════════════════════"
REMOTE_EOF

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Deployment finished!"
echo "═══════════════════════════════════════════════════"
