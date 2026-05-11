#!/bin/bash
set -e

docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "SELECT email, created_at FROM users WHERE email IN ('nkamdar@5riverscap.com','imughal@5riverscap.com') ORDER BY email;"
