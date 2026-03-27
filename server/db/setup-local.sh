#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  Local dev setup — PostgreSQL via Docker + run migrations
# ─────────────────────────────────────────────────────────
set -e

CONTAINER_NAME="cap-postgres"
PG_USER="cap_user"
PG_PASS="cap_dev_pass"
PG_DB="claim_analytics"
PG_PORT=5432

echo "=== Claim Analytics — Local DB Setup ==="

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[✓] PostgreSQL container '${CONTAINER_NAME}' is already running."
  else
    echo "[→] Starting existing container '${CONTAINER_NAME}'..."
    docker start "$CONTAINER_NAME"
  fi
else
  echo "[→] Creating PostgreSQL container '${CONTAINER_NAME}'..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PG_PORT}:5432" \
    -e "POSTGRES_USER=${PG_USER}" \
    -e "POSTGRES_PASSWORD=${PG_PASS}" \
    -e "POSTGRES_DB=${PG_DB}" \
    postgres:16-alpine
fi

# Wait for PostgreSQL to be ready
echo "[→] Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" > /dev/null 2>&1; then
    echo "[✓] PostgreSQL is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[✗] PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 1
done

# Run migrations
echo "[→] Running migrations..."
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}"
node "$(dirname "$0")/migrate.js"

echo ""
echo "=== Done! ==="
echo "DATABASE_URL=${DATABASE_URL}"
echo "You can now run: npm run dev  (from server/)"
