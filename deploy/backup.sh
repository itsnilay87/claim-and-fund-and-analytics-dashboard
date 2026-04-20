#!/bin/bash
# ─────────────────────────────────────────────────────────
#  Automated backup for Claim Analytics Platform
#
#  Backs up:
#    1. PostgreSQL database (pg_dump, gzip compressed)
#    2. Simulation run outputs (tar.gz of /app/server/runs)
#
#  Usage:
#    ./backup.sh                    # Run manually
#    crontab -e                     # Add scheduled entry:
#    0 2 * * * /opt/claim-analytics-platform/deploy/backup.sh >> /var/log/cap-backup.log 2>&1
#
#  Retention: 30 daily backups (configurable below)
# ─────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ──
APP_DIR="/opt/claim-analytics-platform"
BACKUP_DIR="${APP_DIR}/backups"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "${BACKUP_DIR}/db" "${BACKUP_DIR}/runs"

echo "═══════════════════════════════════════"
echo "  Backup started: $(date)"
echo "═══════════════════════════════════════"

# ── 1. Database backup ──
DB_BACKUP="${BACKUP_DIR}/db/pg_${TIMESTAMP}.sql.gz"
echo "▸ Backing up PostgreSQL..."

if docker compose --env-file "${APP_DIR}/deploy/.env" \
     -f "${APP_DIR}/deploy/docker-compose.yml" \
     exec -T db pg_dump -U cap_user -d claim_analytics \
       --no-owner --clean --if-exists 2>/dev/null \
     | gzip > "${DB_BACKUP}"; then
  DB_SIZE=$(du -h "${DB_BACKUP}" | cut -f1)
  echo "  ✓ DB backup: ${DB_BACKUP} (${DB_SIZE})"
else
  echo "  ✗ DB backup FAILED"
  rm -f "${DB_BACKUP}"
fi

# ── 2. Simulation runs backup (incremental via rsync to local dir, then tar) ──
RUNS_BACKUP="${BACKUP_DIR}/runs/runs_${TIMESTAMP}.tar.gz"
RUNS_STAGING="${BACKUP_DIR}/runs/_staging"
echo "▸ Backing up simulation run outputs..."

# Copy files from Docker volume to staging area
mkdir -p "${RUNS_STAGING}"
CONTAINER_ID=$(docker compose --env-file "${APP_DIR}/deploy/.env" \
  -f "${APP_DIR}/deploy/docker-compose.yml" ps -q web 2>/dev/null || true)

if [ -n "${CONTAINER_ID}" ]; then
  docker cp "${CONTAINER_ID}:/app/server/runs/." "${RUNS_STAGING}/" 2>/dev/null || true
  if [ "$(find "${RUNS_STAGING}" -type f 2>/dev/null | head -1)" ]; then
    tar -czf "${RUNS_BACKUP}" -C "${RUNS_STAGING}" . 2>/dev/null
    RUNS_SIZE=$(du -h "${RUNS_BACKUP}" | cut -f1)
    echo "  ✓ Runs backup: ${RUNS_BACKUP} (${RUNS_SIZE})"
  else
    echo "  ⚠ No run files found — skipping"
    rm -f "${RUNS_BACKUP}"
  fi
  rm -rf "${RUNS_STAGING}"
else
  echo "  ⚠ Web container not running — skipping runs backup"
fi

# ── 3. Prune old backups ──
echo "▸ Pruning backups older than ${RETENTION_DAYS} days..."
DB_PRUNED=$(find "${BACKUP_DIR}/db" -name "pg_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
RUNS_PRUNED=$(find "${BACKUP_DIR}/runs" -name "runs_*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "  Pruned: ${DB_PRUNED} DB + ${RUNS_PRUNED} run backups"

# ── 4. Summary ──
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
DB_COUNT=$(find "${BACKUP_DIR}/db" -name "pg_*.sql.gz" 2>/dev/null | wc -l)
RUNS_COUNT=$(find "${BACKUP_DIR}/runs" -name "runs_*.tar.gz" 2>/dev/null | wc -l)

echo ""
echo "═══════════════════════════════════════"
echo "  Backup complete: $(date)"
echo "  Total: ${DB_COUNT} DB + ${RUNS_COUNT} run backups (${TOTAL_SIZE})"
echo "═══════════════════════════════════════"
