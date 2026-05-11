#!/bin/bash
set -e

echo "Bundle files:"
docker exec deploy-web-1 sh -c 'ls -1 /app/static/app/assets/'

echo "Contains /forgot-password?"
docker exec deploy-web-1 sh -c "grep -c '/forgot-password' /app/static/app/assets/index-*.js"

echo "Contains Forgot password label?"
docker exec deploy-web-1 sh -c "grep -c 'Forgot password' /app/static/app/assets/index-*.js"
