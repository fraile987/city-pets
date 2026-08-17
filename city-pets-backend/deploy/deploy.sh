#!/usr/bin/env bash
# =========================================================
# CITY PETS — Despliegue reproducible (Fase 9.6)
#
# Prepara la instalación en el VPS: instala dependencias exactas,
# aplica migraciones, fija permisos de las rutas de datos, reinicia
# el servicio y hace el healthcheck.
#
# Uso (como root o con sudo):
#   RELEASE_TAG=v1.2.0 bash deploy/deploy.sh
#   bash deploy/deploy.sh                      # usa el checkout actual
#
# Configurable por variables de entorno (defaults que coinciden con
# deploy/city-pets.service y .env.example de producción):
#   APP_USER, APP_DIR, DATA_DIR, MEDIA_DIR, BACKUP_DIR, SERVICE, HEALTH_URL
#   DEPLOY_SYSTEMD=0  -> modo laboratorio/CI: no reinicia el servicio
#
# NOTAS:
#   - npm ci ejecuta el postinstall "prisma generate" (no se duplica aquí).
#   - El repo debe estar clonado en $APP_DIR (backend en $APP_DIR/city-pets-backend).
#   - .env de producción debe tener NODE_ENV=production y las rutas absolutas.
# =========================================================
set -euo pipefail

APP_USER="${APP_USER:-citypets}"
APP_DIR="${APP_DIR:-/opt/city-pets}"
BACKEND_DIR="$APP_DIR/city-pets-backend"
DATA_DIR="${DATA_DIR:-/var/lib/city-pets/data}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/city-pets/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/city-pets/backups}"
SERVICE="${SERVICE:-city-pets}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
RELEASE_TAG="${RELEASE_TAG:-}"

[ -f "$BACKEND_DIR/package.json" ] || { echo "[ERROR] No existe $BACKEND_DIR/package.json"; exit 1; }

# Release reproducible: checkout de un tag/commit exacto si se indica.
if [ -n "$RELEASE_TAG" ]; then
  git -C "$BACKEND_DIR" checkout --quiet "$RELEASE_TAG"
fi

cd "$BACKEND_DIR"

# Entorno de producción (EnvironmentFile del servicio systemd)
[ -f .env ] || { echo "[ERROR] Falta $BACKEND_DIR/.env (copia de .env.example)"; exit 1; }
grep -q '^NODE_ENV=production' .env || { echo "[ERROR] .env debe tener NODE_ENV=production"; exit 1; }

# Instalación reproducible (postinstall -> prisma generate)
npm ci

# Permisos de las rutas de datos (BD, medios, backups). Deben existir
# antes de las migraciones: SQLite crea dev.db en DATA_DIR (DATABASE_URL).
if [ "$(id -u)" -eq 0 ]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$MEDIA_DIR" "$BACKUP_DIR"
  chown -R "$APP_USER":"$APP_USER" .env
  chmod 600 .env
else
  # Laboratorio/CI sin root: se crean las rutas sin fijar owner.
  install -d "$DATA_DIR" "$MEDIA_DIR" "$BACKUP_DIR"
  chmod 600 .env
  echo "[AVISO] sin root: no se fija owner '$APP_USER' (en el VPS usa sudo)."
fi

# Aplicar migraciones pendientes
npx prisma migrate deploy

# Reinicio del servicio (DEPLOY_SYSTEMD=0 => laboratorio/CI, sin systemd)
if [ "${DEPLOY_SYSTEMD:-1}" = "1" ]; then
  systemctl restart "$SERVICE"
else
  echo "[AVISO] DEPLOY_SYSTEMD=0: el servicio no se reinicia (laboratorio/CI)."
fi

# Healthcheck posterior
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Despliegue OK: $HEALTH_URL responde."
    exit 0
  fi
  sleep 1
done
echo "[ERROR] Healthcheck falló tras 30 s: $HEALTH_URL"
if [ "${DEPLOY_SYSTEMD:-1}" = "1" ]; then
  systemctl status "$SERVICE" --no-pager || true
fi
exit 1