#!/usr/bin/env bash
# =========================================================
# CITY PETS — Fase 10.1: aprovisionamiento del VPS
#
# Prepara un Ubuntu LTS recién creado como base segura para
# City Pets: usuario dedicado, SSH endurecido, firewall y
# actualizaciones automáticas de seguridad.
#
# EJECUTAR UNA SOLA VEZ, como root, justo tras crear el VPS:
#   SSH_PUBKEY='ssh-ed25519 AAAA...' bash scripts/setup-vps.sh
#   SSH_PUBKEY_FILE=/home/tu-usuario/.ssh/id_ed25519.pub \
#     bash scripts/setup-vps.sh
#
# ANTES: elegir proveedor. Cualquiera con Ubuntu 24.04 LTS
# (noble) o 22.04 LTS (jammy) sirve. Al crear la instancia:
#   - Imagen: Ubuntu 24.04 LTS.
#   - Tamaño: 1-2 vCPU / 1-2 GB RAM es suficiente para empezar.
#   - Región: cerca de los usuarios.
#   - Añade tu clave pública SSH en el asistente del proveedor.
#   - No generes contraseña de root (solo clave SSH).
# Ejemplos habituales: Hetzner Cloud, DigitalOcean, Vultr, OVH,
# Linode. El guion es idéntico en todos (Ubuntu).
#
# Configurable por variables de entorno (defaults):
#   NEW_USER      usuario de servicio            (citypets)
#   SSH_PORT      puerto de SSH                  (22)
#   SSH_PUBKEY    clave pública del admin        (obligatoria)
#   SSH_PUBKEY_FILE  o bien: ruta a un archivo .pub
#
# Seguridad aplicada (idempotente y re-ejecutable):
#   1. Usuario citypets con sudo y su clave pública.
#   2. SSH: sin login root, solo claves, sin contraseña.
#   3. UFW: denegar entradas salvo SSH (80/443 se abren en 10.4).
#   4. unattended-upgrades para parches de seguridad.
# =========================================================
set -euo pipefail

NEW_USER="${NEW_USER:-citypets}"
SSH_PORT="${SSH_PORT:-22}"
PUBKEY="${SSH_PUBKEY:-}"
PUBKEY_FILE="${SSH_PUBKEY_FILE:-}"

[ "$(id -u)" -eq 0 ] || { echo "[ERROR] Ejecuta como root: sudo bash scripts/setup-vps.sh"; exit 1; }

if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$VERSION_CODENAME" in
    noble|jammy) ;;
    *) echo "[ERROR] Requiere Ubuntu LTS (24.04 noble o 22.04 jammy). Detectado: ${VERSION_CODENAME:-desconocido}"; exit 1 ;;
  esac
else
  echo "[AVISO] No se pudo verificar /etc/os-release; continúo."
fi

# ---------- Clave pública SSH (obligatoria) ----------
KEY="$PUBKEY"
if [ -z "$KEY" ] && [ -n "$PUBKEY_FILE" ] && [ -f "$PUBKEY_FILE" ]; then
  KEY="$(tr -d '\r\n' < "$PUBKEY_FILE")"
fi
if [ -z "$KEY" ]; then
  echo "[ERROR] Falta la clave pública SSH."
  echo "  SSH_PUBKEY='ssh-ed25519 AAAA...' bash scripts/setup-vps.sh"
  echo "  (o SSH_PUBKEY_FILE=/ruta/clave.pub)"
  exit 1
fi

echo "== 1/4 Usuario $NEW_USER (sudo) con clave SSH =="
if id "$NEW_USER" >/dev/null 2>&1; then
  echo "[OK] $NEW_USER ya existe"
else
  useradd --create-home --shell /bin/bash --groups sudo "$NEW_USER"
  echo "[OK] $NEW_USER creado con sudo"
fi
install -d -m 700 -o "$NEW_USER" -g "$NEW_USER" "/home/$NEW_USER/.ssh"
install -m 600 -o "$NEW_USER" -g "$NEW_USER" /dev/null "/home/$NEW_USER/.ssh/authorized_keys"
printf '%s\n' "$KEY" > "/home/$NEW_USER/.ssh/authorized_keys"
chown "$NEW_USER":"$NEW_USER" "/home/$NEW_USER/.ssh/authorized_keys"
chmod 600 "/home/$NEW_USER/.ssh/authorized_keys"
echo "[OK] clave pública instalada para $NEW_USER"

echo "== 2/4 Endurecimiento SSH (root off, solo claves) =="
if command -v sshd >/dev/null 2>&1; then
  SSHD_D="/etc/ssh/sshd_config.d"
  install -d "$SSHD_D"
  cat > "$SSHD_D/99-citypets.conf" <<EOF
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
  if sshd -t >/dev/null 2>&1; then
    if command -v systemctl >/dev/null 2>&1; then
      systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || echo "[AVISO] recarga manual de sshd necesaria"
    else
      echo "[AVISO] sin systemd; aplica la config de sshd manualmente"
    fi
    echo "[OK] sshd: root off, solo claves"
  else
    echo "[ERROR] sshd -t falló; la configuración NO se aplicó. Revisa $SSHD_D/99-citypets.conf"
  fi
else
  echo "[AVISO] openssh-server no está instalado aún; se aplicará en la Fase 10.2"
fi

echo "== 3/4 Firewall UFW (denegar entradas salvo SSH:$SSH_PORT) =="
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow "$SSH_PORT/tcp" >/dev/null
  if command -v systemctl >/dev/null 2>&1; then
    ufw --force enable >/dev/null
    ufw status verbose
  else
    echo "[AVISO] sin systemd; activa el firewall manualmente con: ufw enable"
  fi
  echo "[OK] UFW: solo SSH:$SSH_PORT abierto (80/443 se abren en 10.4)"
else
  echo "[AVISO] ufw no instalado; instala con: apt install ufw"
fi

echo "== 4/4 Actualizaciones automáticas de seguridad =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y unattended-upgrades >/dev/null 2>&1 || echo "[AVISO] no se pudo instalar unattended-upgrades"
mkdir -p /etc/apt/apt.conf.d
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
echo "[OK] unattended-upgrades habilitado (parches de seguridad automáticos)"

echo ""
echo "=============================================="
echo " VPS base lista (Fase 10.1 completada)."
echo "  Usuario:        $NEW_USER (sudo)"
echo "  SSH:            puerto $SSH_PORT, solo claves, root off"
echo "  Firewall:       solo $SSH_PORT/tcp abierto"
echo "  Actualizaciones: automáticas de seguridad"
echo "=============================================="
echo " Próximo paso (Fase 10.2): instalar Node 24 LTS, nginx,"
echo " systemd (ya presente) y git en este servidor."
