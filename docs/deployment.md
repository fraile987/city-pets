# Guía de despliegue de City Pets

Guía **genérica** para desplegar City Pets en un servidor Linux estándar con
Node.js. No asume un proveedor cloud concreto. El proyecto está pensado para
correr detrás de un proxy reverso (por ejemplo, nginx) que exponga HTTP/HTTPS;
el backend escucha en `127.0.0.1` en producción.

---

## 1. Preparación del entorno

- **Node.js 24 LTS** (ver `.nvmrc`; `engines` exige `>=24 <25`). Verifica:

  ```bash
  node -v   # debe ser 24.x
  npm -v
  ```

- Crea un usuario de sistema dedicado (sin privilegios) para ejecutar la app.
- Prevé directorios persistentes fuera del código:

  ```
  /var/lib/city-pets/data      # base de datos SQLite
  /var/lib/city-pets/uploads   # medios subidos
  /var/lib/city-pets/backups   # copias de seguridad
  ```

---

## 2. Variables de entorno

Copia la plantilla y rellena los valores:

```bash
cp city-pets-backend/.env.example city-pets-backend/.env
chmod 600 city-pets-backend/.env
```

| Variable | Producción (ejemplo) |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `HOST` | `127.0.0.1` (el arranque aborta si intentas `0.0.0.0` en producción) |
| `DATABASE_URL` | `file:/var/lib/city-pets/data/dev.db` (ruta absoluta) |
| `UPLOADS_PATH` | `/var/lib/city-pets/uploads` |
| `JWT_SECRET` | Genera uno: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGINS` | Lista exacta, p. ej. `https://citypets.com,https://www.citypets.com` |

> El arranque es **fail-fast**: `NODE_ENV` inválido, `JWT_SECRET` débil, `CORS_ORIGINS`
> vacío o con `*`, o `HOST` en `0.0.0.0` en producción → el proceso aborta.

---

## 3. Instalación de dependencias

```bash
cd city-pets-backend
npm ci            # instalación reproducible a partir del lockfile
```

`npm ci` ejecuta `postinstall` → `prisma generate` (regenera el cliente Prisma).

---

## 4. Aplicar migraciones y verificar Prisma

```bash
cd city-pets-backend
npx prisma migrate deploy   # aplica migraciones pendientes (no destructivo)
npx prisma migrate status   # debe indicar que el schema está al día
```

- **Nunca** uses `prisma migrate reset`, `prisma db push --force-reset` ni
  `npm run seed` sobre una base de producción.
- `npm run seed` **solo para desarrollo**.

---

## 5. Arranque en producción

```bash
cd city-pets-backend
NODE_ENV=production npm start
```

En producción el servidor escucha en `127.0.0.1:3000`. Un proxy reverso (nginx)
debe exponer el tráfico. Ejemplos de referencia (no obligatorios) se incluyen en
`city-pets-backend/deploy/` (`nginx.conf`, `city-pets.service`, `deploy.sh`).

---

## 6. Healthcheck

```bash
curl -f http://127.0.0.1:3000/api/health
```

- `200 {"status":"ok","db":"ok",...}` → correcto.
- `503 {"status":"degraded","db":"error",...}` → la BD no responde (el proceso
  sigue vivo). Configura tu healthcheck/orquestador para reiniciar en ese caso.

---

## 7. Shutdown limpio

El servidor maneja `SIGTERM` y `SIGINT`: cierra conexiones HTTP, desconecta
Prisma y sale con código 0 (con force-exit a los 10 s). En `systemd`, asegúrate
de que `Restart=on-failure` y envía `SIGTERM` al detener el servicio.

---

## 8. Recomendaciones de backup

- Backup diario de **BD + uploads**. El proyecto incluye scripts de referencia:

  ```bash
  cd city-pets-backend
  DB_PATH=/var/lib/city-pets/data/dev.db \
  UPLOADS_DIR=/var/lib/city-pets/uploads \
  BACKUP_DIR=/var/lib/city-pets/backups \
  BACKUP_KEEP=7 bash scripts/backup.sh

  # Restauración (bajo tu responsabilidad)
  bash scripts/restore.sh /var/lib/city-pets/backups/citypets-<timestamp>.tar.gz
  ```

- Prueba restauraciones periódicamente y guarda los backups fuera del servidor.

---

## 9. Recomendaciones de seguridad

- Protege `.env` (`chmod 600`, `chown` al usuario de la app). Nunca lo subas a Git.
- Expón solo `80/443`; el backend permanece en loopback.
- `CORS_ORIGINS` debe ser una lista exacta de dominios (sin `*`).
- Mantén `JWT_SECRET` largo y único.
- Limita el tamaño de subida en el proxy para alinear con los límites de la API
  (imágenes ≤ 5 MB, videos ≤ 25 MB, importación Excel ≤ 5 MB).
- Aplica actualizaciones de seguridad a Node y dependencias con control.

---

## 10. Qué NO debe subirse a Git

- Cualquier `*.db`, `*.db-journal`, `*.sqlite` y respaldos (`*.db.*` o
  `dev.db.before-restore`).
- `.env` / `.env.local` (solo `.env.example`).
- `node_modules/`.
- `uploads/` y `backups/` (medios y copias locales).
- Logs, `coverage/`, archivos temporales.

El repositorio ya incluye estas reglas en `.gitignore`.

---

## 11. Checklist previo al despliegue

1. [ ] Node 24 LTS instalado y verificado (`node -v`).
2. [ ] `.env` creado desde `.env.example` con secretos reales y permisos `600`.
3. [ ] `npm ci` completado y `prisma generate` ejecutado.
4. [ ] `npx prisma migrate deploy` aplicado; `migrate status` al día.
5. [ ] Directorios `/var/lib/city-pets/{data,uploads,backups}` creados y
      escribibles por el usuario de la app.
6. [ ] `NODE_ENV=production` y el arranque no aborta (sin errores de config).
7. [ ] `/api/health` responde `200` a través del proxy.
8. [ ] `CORS_ORIGINS` incluye el(los) dominio(s) real(es).
9. [ ] `og:*` de `index.html` apuntan al dominio real (aún placeholder en el repo).
10. [ ] Backup inicial creado y probada su restauración.
11. [ ] Proxy/configuración del servicio reinician automáticamente ante fallos
       (`Restart=on-failure`) y envían `SIGTERM` al detener.
12. [ ] Sin ejecutar `seed` ni `reset` sobre la BD de producción.

---

## Limitaciones de producción

- **SQLite** es de un solo escritor: apto para volúmenes bajos/medios. Para alta
  concurrencia se requiere otro motor (con su correspondiente migración).
- El recaudo usa la hora local del servidor: fija `TZ` según la zona del negocio.
- No hay pasarela de pagos en línea: los pagos se registran contra entrega.