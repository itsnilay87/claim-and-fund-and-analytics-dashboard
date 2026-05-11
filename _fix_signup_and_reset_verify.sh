#!/bin/bash
set -e

echo "Deleting accidental test user nkamdar@5riverscap.com (if exists)..."
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "DELETE FROM users WHERE email='nkamdar@5riverscap.com';"

echo "Trigger forgot-password OTP for existing user imughal@5riverscap.com"
curl -s -X POST http://localhost:8080/api/auth/forgot-password/request-otp \
  -H 'Content-Type: application/json' \
  -d '{"email":"imughal@5riverscap.com"}'

echo
echo "Check reset request row exists:"
docker exec deploy-db-1 psql -U cap_user -d claim_analytics -c "SELECT email, attempts, expires_at FROM password_reset_requests WHERE email='imughal@5riverscap.com';"
