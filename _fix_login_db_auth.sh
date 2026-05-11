#!/bin/bash
set -euo pipefail

cd /opt/claim-analytics-platform
PG_PASS=$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2)

# Update DB user password to match deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
  psql -U cap_user -d claim_analytics -c "ALTER USER cap_user WITH PASSWORD '${PG_PASS}';"

# Restart stack so app reconnects cleanly
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d

sleep 8

# Verify health and user presence
curl -s http://localhost:8082/api/health; echo

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
  psql -U cap_user -d claim_analytics -c "SELECT id, email, role FROM users ORDER BY created_at DESC;"
