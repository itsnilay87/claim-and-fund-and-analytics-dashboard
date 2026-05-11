#!/bin/bash
set -e

DB_PASS="550902a992463513451ede9d37d860fc"

echo "Syncing DB password to match web container..."
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "ALTER USER cap_user WITH PASSWORD '${DB_PASS}';"

echo "Creating user imughal@5riverscap.com..."
docker exec -w /app/server deploy-web-1 node _create_user.js

echo "Done."

echo "Creating user..."
docker exec -w /app/server deploy-web-1 node _create_user.js

echo "Done."
