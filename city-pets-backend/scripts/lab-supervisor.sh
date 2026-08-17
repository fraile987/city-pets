#!/usr/bin/env bash
# =========================================================
# CITY PETS — Simulador de systemd para laboratorio (Fase 10.3)
#
# Replica Restart=on-failure + RestartSec=2 de
# deploy/city-pets.service SIN privilegios de root, para probar
# la resiliencia del server en WSL/CI.
#
# Uso:
#   NODE_ENV=production PORT=3102 DATABASE_URL=file:... UPLOADS_PATH=... \
#     JWT_SECRET=... CORS_ORIGINS=... \
#     bash scripts/lab-supervisor.sh <backend-dir>
#
# Si el server muere, se relanza a los 2 s (como RestartSec=2).
# Al recibir TERM/INT mata al server y sale.
# =========================================================
set -u
BE="${1:?uso: scripts/lab-supervisor.sh <backend-dir>}"
C=""
trap '[ -n "$C" ] && kill "$C" 2>/dev/null; exit 0' TERM INT
set +e
while :; do
  ( cd "$BE" && exec node server.js ) &
  C=$!
  wait "$C"
  echo "[lab-supervisor] server terminado (exit $?); reinicio en 2 s..." >&2
  sleep 2
done
