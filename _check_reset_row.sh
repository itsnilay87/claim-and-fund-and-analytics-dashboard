#!/bin/bash
set -e

docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "SELECT email, attempts, expires_at FROM password_reset_requests WHERE email='imughal@5riverscap.com';"
