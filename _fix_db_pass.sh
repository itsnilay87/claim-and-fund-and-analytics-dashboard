#!/bin/bash
cd /opt/claim-analytics-platform
PG_PASS=$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2)
echo "Setting cap_user password to: ${PG_PASS}"
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
  psql -U cap_user -d claim_analytics -c "ALTER USER cap_user WITH PASSWORD '${PG_PASS}';"
echo "Restarting web container..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml restart web
sleep 5
echo "=== HEALTH ==="
curl -s http://localhost:8082/api/health
echo
echo "=== USER CHECK ==="
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
  psql -U cap_user -d claim_analytics -c "SELECT id, email, role FROM users;"
