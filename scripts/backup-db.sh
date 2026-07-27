#!/usr/bin/env bash
# ==============================================================================
# 6D Test & Task Management Tool - nightly Postgres backup
#
# Dumps ttmt-postgres to a compressed pg_dump custom-format file (restorable
# with `pg_restore`) and prunes anything older than RETENTION_DAYS. Runs via
# host cron (not a container) since it needs `docker exec` against the
# running Postgres container, not just its data volume.
#
# Installed automatically by deploy.ps1 (idempotent — safe to redeploy).
# To run/check manually:
#   ./scripts/backup-db.sh
#   tail -f backups/backup.log
#   crontab -l | grep backup-db
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${POSTGRES_CONTAINER:-ttmt-postgres}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/ttmt-${TIMESTAMP}.dump"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Read POSTGRES_USER/POSTGRES_DB from .env (same convention as
# gen-compose-override.sh's own .env parsing).
ENV_FILE="$ROOT_DIR/.env"
PG_USER="ttmt"
PG_DB="ttmt"
if [[ -f "$ENV_FILE" ]]; then
  _u=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  _d=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  [[ -n "$_u" ]] && PG_USER="$_u"
  [[ -n "$_d" ]] && PG_DB="$_d"
fi

log "Starting backup of \"$PG_DB\" (container: $CONTAINER)"

if ! sudo docker exec "$CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP_FILE" 2>>"$LOG_FILE"; then
  log "ERROR: pg_dump failed - see above"
  rm -f "$DUMP_FILE"
  exit 1
fi

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
log "Backup complete: $(basename "$DUMP_FILE") ($DUMP_SIZE)"

# Prune anything past the retention window.
DELETED=0
while IFS= read -r -d '' old; do
  rm -f "$old"
  DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR" -name 'ttmt-*.dump' -mtime "+${RETENTION_DAYS}" -print0)

if [[ "$DELETED" -gt 0 ]]; then
  log "Pruned $DELETED backup(s) older than $RETENTION_DAYS days"
fi

log "Backup job finished"
