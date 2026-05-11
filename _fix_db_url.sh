#!/bin/bash
cd /opt/claim-analytics-platform
PW=$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2)
echo "POSTGRES_PASSWORD=$PW"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://cap_user:${PW}@db:5432/claim_analytics|" deploy/.env
echo "Updated DATABASE_URL:"
grep '^DATABASE_URL=' deploy/.env
echo ""
echo "Restarting web container..."
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --force-recreate web 2>&1
sleep 5
echo ""
echo "Health check:"
curl -s http://localhost:8082/api/health
echo ""
echo ""
echo "Web logs:"
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=5 web 2>&1
