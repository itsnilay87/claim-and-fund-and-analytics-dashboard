#!/bin/bash
set -e
cd /opt/claim-analytics-platform

echo "Building web image from /opt repo..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build --no-cache web >/tmp/force_opt_build.log 2>&1

echo "Recreating web from freshly built image..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --no-deps --force-recreate web >/tmp/force_opt_up.log 2>&1

echo "Verify backend route in container:" 
docker exec deploy-web-1 sh -c "grep -n 'forgot-password/request-otp' /app/server/routes/auth.js || true"

echo "Verify frontend marker in bundle:"
docker exec deploy-web-1 sh -c "grep -c '/reset-password' /app/static/app/assets/index-*.js"

echo "Served bundle hash:"
curl -s http://localhost:8082/ | grep -oE 'index-[A-Za-z0-9_-]+\\.js'
