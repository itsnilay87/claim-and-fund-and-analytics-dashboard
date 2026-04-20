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

  # ── 4. Stop old single-container setup if running ──
  docker stop claim-analytics 2>/dev/null && docker rm claim-analytics 2>/dev/null && echo "  ✓ Old container stopped" || true

  # ── 5. Build and start with docker-compose ──
  echo "▸ Building and starting services (web + PostgreSQL)..."
  cd "$REMOTE_DIR"
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

  # ── 6. Wait for DB healthy ──
  echo "▸ Waiting for PostgreSQL to be ready..."
  for i in $(seq 1 30); do
    if docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db pg_isready -U cap_user -d claim_analytics &>/dev/null; then
      echo "  ✓ PostgreSQL ready"
      break
    fi
    sleep 2
  done

  # ── 7. Run database migrations ──
  echo "▸ Running database migrations..."
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T web node server/db/migrate.js

  # ── 8. Verify ──
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
