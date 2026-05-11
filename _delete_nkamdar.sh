#!/bin/bash
set -e

docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "DELETE FROM users WHERE email='nkamdar@5riverscap.com';"
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "SELECT email FROM users WHERE email='nkamdar@5riverscap.com';"
