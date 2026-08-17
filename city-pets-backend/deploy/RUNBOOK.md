# City Pets — Runbook de producción

Despliegue reproducible en un VPS Ubuntu 24.04 LTS (noble).

Estado: cada paso fue validado en el laboratorio local (WSL) con la suite
integral `scripts/test-integral.sh` (**G1–G20, 371 comprobaciones verdes**).
Los pasos que necesitan infraestructura pública —dominio, DNS, Let's Encrypt,
acceso externo— corresponden a la **Fase 10.4** y solo pueden verificarse con
el VPS y el dominio contratados.

Artefactos que usa este runbook (todos en el repo):

| Artefacto | Función |
|---|---|
| `scripts/setup-vps.sh` | Aprovisionamiento inicial (Fase 10.1) |
| `deploy/deploy.sh` | Instalación reproducible + migraciones + healthcheck |
| `deploy/city-pets.service` | Servicio systemd de la API |
| `deploy/city-pets-backup.service` / `.timer` | Backup diario automático |
| `deploy/nginx.conf` | Reverse proxy nginx → 127.0.0.1:3000 |
| `.nvmrc`, `package.json` (engines) | Node 24 LTS |
| `scripts/backup.sh`, `scripts/restore.sh` | Backup y restauración con rotación |
| `scripts/test-integral.sh` | Suite E2E (dev local, NO contra datos reales) |

---

## 1. Crear el VPS

- Proveedor con Ubuntu **24.04 LTS** (noble). 1 vCPU / 1 GB mínimo; 2 GB
  recomendado. Región cerca de los usuarios.
- En el asistente: añadir la **clave pública SSH** (sin contraseña de root).
- Anotar la **IP pública**.

## 2. Aprovisionamiento inicial (Fase 10.1)

```bash
ssh root@IP_PUBLICA
# copiar el script y ejecutarlo UNA sola vez, como root:
SSH_PUBKEY='ssh-ed25519 AAAA...' bash scripts/setup-vps.sh
# (o SSH_PUBKEY_FILE=/ruta/clave.pub)
```

Crea el usuario `citypets` (sudo + clave), endurece SSH (root off, solo
claves), activa UFW con solo `22/tcp` y unattended-upgrades. Verificar:

```bash
ssh citypets@IP_PUBLICA
sudo ufw status verbose    # 22/tcp permitido, resto denegado
```

## 3. Node 24 LTS + git (Fase 10.2A)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -d /usr/local/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key \
  | sudo gpg --dearmor -o /usr/local/share/keyrings/nodesource.gpg
echo "deb [signed-by=/usr/local/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x noble main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
node -v    # debe coincidir con el .nvmrc (24.18.0)
which node # debe ser /usr/bin/node (ruta que usa la unit systemd)
```

## 4. Clonar el repo (Fase 10.2B)

```bash
sudo mkdir -p /opt/city-pets && sudo chown citypets:citypets /opt/city-pets
git clone <URL-del-repo> /opt/city-pets
cd /opt/city-pets/city-pets-backend
```

Las rutas `/var/lib/city-pets/{data,uploads,backups}` las crea `deploy.sh`
con el owner correcto (paso 7); no es necesario crearlas a mano.

## 5. `.env` de producción

```bash
cp .env.example .env
```

Valores requeridos (la API **exige** `NODE_ENV=production` y `CORS_ORIGINS`
no vacío en producción; si falta, no arranca —fail-fast—):

```dotenv
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
DATABASE_URL="file:/var/lib/city-pets/data/dev.db"
UPLOADS_PATH=/var/lib/city-pets/uploads
JWT_SECRET=genera-con: openssl rand -hex 32
CORS_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

> La unit systemd carga este `.env` (`EnvironmentFile`). `deploy.sh` fija
> `chmod 600` cuando se ejecuta con root.

## 6. Instalar las unidades systemd

```bash
sudo cp deploy/city-pets.service /etc/systemd/system/
sudo cp deploy/city-pets-backup.service deploy/city-pets-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Revisar `ExecStart` (ruta de node) y `ReadWritePaths`; coinciden con los
defaults del despliegue.

## 7. Desplegar (Fase 10.3)

```bash
sudo bash deploy/deploy.sh
```

Hace: `npm ci` (postinstall → `prisma generate`), crea
`/var/lib/city-pets/{data,uploads,backups}` con owner `citypets`,
aplica `prisma migrate deploy`, reinicia el servicio y espera el healthcheck.

> El primer despliegue crea `dev.db` vacío en `/var/lib/city-pets/data`.

## 8. Activar servicios

```bash
sudo systemctl enable --now city-pets
sudo systemctl enable --now city-pets-backup.timer
systemctl status city-pets --no-pager
systemctl list-timers city-pets-backup.timer
curl -s http://127.0.0.1:3000/api/health
```

El timer ejecuta el backup diario con retención de 7 copias.

## 9. nginx (Fase 10.2D)

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/city-pets
sudo ln -s /etc/nginx/sites-available/city-pets /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1/api/health   # vía nginx -> Express
```

Editar `server_name` con el dominio real (placeholder `citypets.local`).

## 10. DNS (Fase 10.4)

Registro **A**: `tudominio.com` y `www.tudominio.com` → IP del VPS.
Verificar propagación:

```bash
dig +short tudominio.com
```

## 11. HTTPS + Let's Encrypt (Fase 10.4)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
sudo nginx -t && sudo systemctl reload nginx
```

Certbot habilita el `listen 443 ssl`, los certificados y la redirección
HTTP → HTTPS en el server block.

## 12. CORS_ORIGINS con el dominio real

Confirmar que `.env` usa los dominios reales (paso 5) y reiniciar:

```bash
sudo systemctl restart city-pets
```

## 13. Comprobaciones de seguridad (runtime)

```bash
# HSTS (lo envía la API)
curl -sI https://tudominio.com/api/health | grep -i strict-transport-security
#   -> max-age=15552000; includeSubDomains

# Redirección HTTP -> HTTPS
curl -sI http://tudominio.com/api/health | head -1   # 301/308

# trust proxy: la API ve la IP pública del cliente
curl -s https://tudominio.com/api/health | grep -o '"ip":"[^"]*"'

# Archivos sensibles fuera de alcance (404)
curl -s -o /dev/null -w '%{http_code}\n' https://tudominio.com/city-pets-backend/.env
curl -s -o /dev/null -w '%{http_code}\n' https://tudominio.com/.git/HEAD
curl -s -o /dev/null -w '%{http_code}\n' https://tudominio.com/dev.db

# CORS con el origen real
curl -s -H 'Origin: https://tudominio.com' -D - -o /dev/null \
  https://tudominio.com/api/health | grep -i access-control-allow-origin
```

## 14. E2E contra producción (G20-equivalente)

> **ADVERTENCIA:** no ejecutar `scripts/test-integral.sh --reset` contra la
> BD de producción: `--reset` borra y vuelve a sembrar la base de datos.
> El flujo E2E se valida con las peticiones siguientes (o la suite completa
> ANTES de abrir el servicio al público):

```bash
A=https://tudominio.com/api
# 1. registro comprador + login
curl -s -X POST $A/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"QA","phone":"3000000000","email":"qa@test.co","password":"clave123"}'
curl -s -X POST $A/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"qa@test.co","password":"clave123"}'
# 2. admin + promote
curl -s -X POST $A/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"QA Admin","phone":"3000000001","email":"qaadmin@test.co","password":"clave123"}'
cd /opt/city-pets/city-pets-backend && sudo npm run promote -- qaadmin@test.co
# 3. producto con stock + imagen + video (con el token de admin)
curl -s -X POST $A/products -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d '{"name":"QA Prod","species":"Perros","price":12000,"stock":50}'
curl -s -X POST $A/upload/image -H "Authorization: Bearer $TA" -F 'file=@imagen.png'
curl -s -X POST $A/upload/video -H "Authorization: Bearer $TA" -F 'file=@video.mp4'
# 4. checkout con el token de comprador y verificación del pedido
curl -s -X POST $A/orders -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"<PID>","qty":2}],"address":"Carrera 7 # 1-2","payment":{"method":"digital"}}'
curl -s $A/orders -H "Authorization: Bearer $TB"
# 5. admin marca entregado
curl -s -X PATCH $A/admin/orders/<OID>/status -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d '{"status":"entregado"}'
```

## 15. Backup y restore

```bash
# el timer diario ya crea backups; verificar
systemctl list-timers city-pets-backup.timer
ls -l /var/lib/city-pets/backups/

# manual (mismas rutas que el timer; el servicio usa estos defaults)
sudo -u citypets env DB_PATH=/var/lib/city-pets/data/dev.db \
  UPLOADS_DIR=/var/lib/city-pets/uploads \
  BACKUP_DIR=/var/lib/city-pets/backups \
  bash /opt/city-pets/city-pets-backend/scripts/backup.sh

# prueba de restauración (detener el servicio primero)
sudo systemctl stop city-pets
sudo bash /opt/city-pets/city-pets-backend/scripts/restore.sh \
  /var/lib/city-pets/backups/citypets-XXXX.tar.gz --force
sudo systemctl start city-pets
```

## 16. Firewall final (solo 22/80/443)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status verbose
```

## 17. Cierre / estado final

1. Working tree limpio: `git status --short`.
2. Suite integral en el laboratorio (última evidencia antes de abrir):
   `bash scripts/test-integral.sh --reset` → **371 PASS / 0 FAIL**.
3. Etiquetar la publicación:

   ```bash
   git tag -a v1.0.0 -m "City Pets: publicacion"
   git push origin v1.0.0
   ```

> Pendiente real (Fase 10.4): dominio, DNS, Let's Encrypt y acceso externo
> dependen de contratar el VPS. Todo lo demás está validado en laboratorio.
