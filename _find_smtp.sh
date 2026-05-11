#!/bin/bash
set -e
for f in \
  /opt/claim-analytics-platform/deploy/.env \
  /root/claim-analytics-platform/deploy/.env \
  /opt/claim-analytics/.env \
  /opt/claim-analytics-platform/.env
do
  if [ -f "$f" ]; then
    echo "FILE=$f"
    grep '^SMTP_' "$f" || true
    echo "---"
  fi
done

# Broader scan for backups
find /opt /root -type f \( -name '*.env*' -o -name '*.bak' -o -name '*backup*' \) 2>/dev/null | while read -r p; do
  if grep -q '^SMTP_HOST=\|^SMTP_USER=\|^SMTP_PASS=' "$p" 2>/dev/null; then
    echo "HIT=$p"
    grep '^SMTP_' "$p" || true
    echo "---"
  fi
done
