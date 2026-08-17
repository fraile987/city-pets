#!/usr/bin/env bash
# =========================================================
# CITY PETS — Restauración desde un backup (Fase 9.5C)
#
# Restaura prisma/dev.db y uploads/ desde backups/citypets-*.tar.gz.
# Antes de sobrescribir hace un snapshot de seguridad del estado actual.
#
# Uso:
#   bash scripts/restore.sh                          # último backup
#   bash scripts/restore.sh backups/citypets-XXXX.tar.gz
#   bash scripts/restore.sh <backup> --force         # sin confirmación
#   bash scripts/restore.sh <backup> --no-safety     # sin snapshot previo
#
# NOTA: detén el server antes de restaurar; los pools de conexión de
# Prisma guardan el archivo antiguo en memoria.
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="backups"
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
  read -r -p "¿Restaurar? Sobrescribe dev.db y uploads/ [s/N] " resp
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
rm -f prisma/dev.db prisma/dev.db-journal prisma/dev.db-wal prisma/dev.db-shm
cp "$TMP/dev.db" prisma/dev.db
[ -f "$TMP/dev.db-journal" ] && cp "$TMP/dev.db-journal" prisma/
[ -f "$TMP/dev.db-wal" ] && cp "$TMP/dev.db-wal" prisma/
[ -f "$TMP/dev.db-shm" ] && cp "$TMP/dev.db-shm" prisma/

# Restaurar los medios
if [ -d "$TMP/uploads" ]; then
  mkdir -p uploads
  cp -r "$TMP"/uploads/. uploads/
fi
rm -rf "$TMP"

echo "Restauración completada."
echo "NOTA: reinicia el server si estaba corriendo (los pools guardan el archivo antiguo)."