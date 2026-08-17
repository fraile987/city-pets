#!/usr/bin/env bash
# =========================================================
# CITY PETS — Backup local con rotación (Fase 9.5C)
#
# Empaqueta la base de datos SQLite (prisma/dev.db) y los medios
# subidos (uploads/) en backups/citypets-<fecha>.tar.gz.
# Conserva las últimas $BACKUP_KEEP copias (por defecto 7).
#
# Uso:
#   bash scripts/backup.sh
#   BACKUP_KEEP=3 bash scripts/backup.sh   # retención distinta
#
# Nota producción: para un snapshot 100% consistente de SQLite usa el
# CLI (sqlite3 dev.db ".backup ...") si está disponible; aquí se copia
# el archivo, válido mientras no haya una transacción en curso.
# =========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="backups"
KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
OUT="$BACKUP_DIR/citypets-$STAMP.tar.gz"
DB="prisma/dev.db"

[ -f "$DB" ] || { echo "[ERROR] No existe $DB"; exit 1; }
mkdir -p "$BACKUP_DIR"

# Transacción activa (journal presente) => la copia simple no es fiable.
if [ -f "$DB-journal" ]; then
  echo "[AVISO] Hay una transacción en curso; el snapshot podría ser inconsistente."
fi

TMP="$(mktemp -d)"
cp "$DB" "$TMP/dev.db"
# sidecars del journal (WAL), si existen
[ -f "$DB-journal" ] && cp "$DB-journal" "$TMP/dev.db-journal"
[ -f "$DB-wal" ] && cp "$DB-wal" "$TMP/dev.db-wal"
[ -f "$DB-shm" ] && cp "$DB-shm" "$TMP/dev.db-shm"
[ -d uploads ] && cp -r uploads "$TMP/uploads"

tar -czf "$OUT" -C "$TMP" .
rm -rf "$TMP"

# Rotación: conservar las $KEEP más recientes (orden por mtime de creación)
mapfile -t files < <(ls -1t "$BACKUP_DIR"/citypets-*.tar.gz 2>/dev/null)
for f in "${files[@]:$KEEP}"; do rm -f "$f"; done

echo "Backup creado: $OUT"
echo "  tamaño: $(du -h "$OUT" | cut -f1)"
echo "  retención: $KEEP copia(s), total actual: $(ls -1 "$BACKUP_DIR"/citypets-*.tar.gz 2>/dev/null | wc -l)"