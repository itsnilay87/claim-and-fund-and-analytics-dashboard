#!/bin/bash
set -euo pipefail
SRC="/root/claim-analytics-platform/deploy/.env"
DST="/opt/claim-analytics-platform/deploy/.env"

if [ ! -f "$SRC" ]; then
  echo "Missing source env: $SRC" >&2
  exit 1
fi
if [ ! -f "$DST" ]; then
  echo "Missing destination env: $DST" >&2
  exit 1
fi

for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM; do
  v=$(grep -E "^${k}=" "$SRC" | head -1 | cut -d= -f2- || true)
  if [ -z "$v" ]; then
    echo "Missing $k in source env" >&2
    exit 1
  fi
  if grep -qE "^${k}=" "$DST"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$DST"
  else
    echo "${k}=${v}" >> "$DST"
  fi
done

if grep -q '^SKIP_EMAIL_VERIFICATION=' "$DST"; then
  sed -i 's/^SKIP_EMAIL_VERIFICATION=.*/SKIP_EMAIL_VERIFICATION=false/' "$DST"
else
  echo 'SKIP_EMAIL_VERIFICATION=false' >> "$DST"
fi

echo "Applied SMTP config to $DST"
for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_FROM SKIP_EMAIL_VERIFICATION; do
  grep -E "^${k}=" "$DST"
done

echo "Restarting web..."
cd /opt/claim-analytics-platform
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d web
sleep 4

echo "Recent email logs:"
docker logs deploy-web-1 --tail 30 2>&1 | grep -iE 'EMAIL|SMTP|Send failed|otp' || true
