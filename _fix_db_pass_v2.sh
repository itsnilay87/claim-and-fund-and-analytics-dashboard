#!/bin/bash
set -e
ENV_FILE=/opt/claim-analytics-platform/deploy/.env
PG_PASS=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
echo "Read PG_PASS length=${#PG_PASS}"

# DATABASE_URL inside web container should match
DB_URL=$(docker exec deploy-web-1 printenv DATABASE_URL)
echo "Web DATABASE_URL host segment: $(echo "$DB_URL" | sed 's|postgresql://[^:]*:||;s|@.*||' | head -c 8)..."

# Reset cap_user password to match .env (postgres superuser uses POSTGRES_PASSWORD too,
# but it ALSO drifted — so use docker exec with --env to inject the right one).
echo "Resetting cap_user password to match .env..."
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "ALTER USER cap_user WITH PASSWORD '$PG_PASS';"

echo "Restarting web container so it picks up working auth..."
docker restart deploy-web-1
sleep 4
echo "Recent web logs:"
docker logs deploy-web-1 --tail 15 2>&1 | grep -iE 'listening|error|password|database' || true
