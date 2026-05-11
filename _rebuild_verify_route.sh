#!/bin/bash
set -e
cd /opt/claim-analytics-platform

echo "Building web image no-cache..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build --no-cache web >/tmp/build_now.log 2>&1

echo "Route in image:"
docker run --rm --entrypoint sh deploy-web:latest -c "grep -n 'forgot-password/request-otp' /app/server/routes/auth.js || true"

echo "Recreating web service (no deps)..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --no-deps --force-recreate web >/tmp/up_now.log 2>&1

echo "Route in running container:"
docker exec deploy-web-1 sh -c "grep -n 'forgot-password/request-otp' /app/server/routes/auth.js || true"
