#!/bin/bash
set -euo pipefail
cd /opt/claim-analytics-platform

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T db \
  psql -U cap_user -d claim_analytics <<'SQL'
SELECT email,
       LENGTH(password_hash) AS hash_len,
       LEFT(password_hash, 4) AS hash_prefix
FROM users;
SQL
