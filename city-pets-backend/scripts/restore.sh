#!/usr/bin/env bash
# =========================================================
# CITY PETS — Restauración desde un backup (Fase 9.5C)
#
# Restaura la BD SQLite y los medios desde backups/citypets-*.tar.gz.
# Antes de sobrescribir hace un snapshot de seguridad del estado actual.
#
# Uso:
#   bash scripts/restore.sh                          # último backup
#   bash scripts/restore.sh backups/citypets-XXXX.tar.gz
#   bash scripts/restore.sh <backup> --force         # sin confirmación
#   bash scripts/restore.sh <backup> --no-safety     # sin snapshot previo
#   DB_PATH=/var/lib/city-pets/data/dev.db UPLOADS_DIR=/var/lib/city-pets/uploads \
#     BACKUP_DIR=/var/lib/city-pets/backups bash scripts/restore.sh ...  # producción (Fase 9.6)
#
# NOTA: detén el server antes de restaurar; los pools de conexión de
# Prisma guardan el archivo antiguo en memoria.
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-backups}"
DB="${DB_PATH:-prisma/dev.db}"
UPLOADS_DIR="${UPLOADS_DIR:-uploads}"
FORCE="0"
SAFETY="1"
SRC=""
for a in "$@"; do
  case "$a" in
    --force) FORCE="1" ;;
    --no-safety) SAFETY="0" ;;
    *) SRC="$a" ;;
  esac
done

if [ -z "$SRC" ]; then
  mapfile -t backups < <(ls -1t "$BACKUP_DIR"/citypets-*.tar.gz 2>/dev/null)
  SRC="${backups[0]:-}"
fi
[ -n "$SRC" ] || { echo "[ERROR] No hay backups en $BACKUP_DIR"; exit 1; }
[ -f "$SRC" ] || { echo "[ERROR] No existe: $SRC"; exit 1; }

echo "Backup a restaurar: $SRC"
echo "  contenido:"
tar -tzf "$SRC"

if [ "$FORCE" != "1" ]; then
  read -r -p "¿Restaurar? Sobrescribe la BD y los medios [s/N] " resp
  case "$resp" in s|S|si|SI|y|Y) ;; *) echo "Cancelado."; exit 0 ;; esac
fi

# Snapshot de seguridad del estado actual (reutiliza backup.sh)
if [ "$SAFETY" = "1" ]; then
  echo "-- snapshot de seguridad del estado actual --"
  bash scripts/backup.sh >/dev/null
fi

TMP="$(mktemp -d)"
tar -xzf "$SRC" -C "$TMP"

# Restaurar la BD (limpiando sidecars previos para evitar mezclas)
rm -f "$DB" "$DB-journal" "$DB-wal" "$DB-shm"
cp "$TMP/dev.db" "$DB"
[ -f "$TMP/dev.db-journal" ] && cp "$TMP/dev.db-journal" "$(dirname "$DB")/"
[ -f "$TMP/dev.db-wal" ] && cp "$TMP/dev.db-wal" "$(dirname "$DB")/"
[ -f "$TMP/dev.db-shm" ] && cp "$TMP/dev.db-shm" "$(dirname "$DB")/"

# Restaurar los medios
if [ -d "$TMP/uploads" ]; then
  mkdir -p "$UPLOADS_DIR"
  cp -r "$TMP"/uploads/. "$UPLOADS_DIR/"
fi
rm -rf "$TMP"

echo "Restauración completada."
echo "NOTA: reinicia el server si estaba corriendo (los pools guardan el archivo antiguo)."