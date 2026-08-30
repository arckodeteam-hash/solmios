#!/bin/bash
# backup-db.sh — Backup diario de la BD PostgreSQL de producción (#292 / DEP-06).
#
# Genera un dump comprimido con pg_dump, lo guarda con fecha, y borra los que superen la retención.
# Pensado para correr desde cron como root en el server de prod.
#
# Instalación (en el server, una vez):
#   crontab -e  →  30 3 * * *  /www/wwwroot/hotel.zx89.site/solmios/backend/scripts/backup-db.sh >> /var/log/solmios-backup.log 2>&1
#
# Verifica que el dump se generó y no está vacío; si falla, sale con código != 0 (cron lo registra).

set -euo pipefail

DB_NAME="${SOLMIOS_DB:-solmios}"
BACKUP_DIR="${SOLMIOS_BACKUP_DIR:-/var/backups/solmios}"
RETENTION_DAYS="${SOLMIOS_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

# pg_dump como usuario postgres (peer auth local). gzip para que no crezca sin control.
sudo -u postgres pg_dump "$DB_NAME" | gzip > "$OUT"

# Verificación: el archivo existe y pesa algo (un dump vacío = backup inútil).
if [ ! -s "$OUT" ]; then
  echo "[$(date)] ERROR: el backup $OUT quedó vacío" >&2
  rm -f "$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[$(date)] backup OK: $OUT ($SIZE)"

# Retención: borrar dumps más viejos que RETENTION_DAYS.
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date)] retención aplicada: se conservan los últimos ${RETENTION_DAYS} días en $BACKUP_DIR"
