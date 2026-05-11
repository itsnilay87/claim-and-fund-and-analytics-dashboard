#!/bin/bash
set -e

echo "Container route check:"
docker exec deploy-web-1 sh -c "grep -n 'forgot-password' /app/server/routes/auth.js || true"

echo "Route present bool:"
docker exec deploy-web-1 node -e "const fs=require('fs');const t=fs.readFileSync('/app/server/routes/auth.js','utf8');console.log(t.includes('/forgot-password/request-otp'))"

echo "API health endpoint status:"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/health || true
