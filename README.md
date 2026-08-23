# City Pets 🐾

Tienda de mascotas con entrega a domicilio (Medellín, Colombia). Incluye un
storefront para clientes y un panel de administración completo para gestión de
inventario, pedidos, recaudo y cierres de caja.

> **Demo de referencia.** Este proyecto está pensado como una plataforma demo
> con datos de ejemplo. No hay una pasarela de pagos en línea: los pagos se
> gestionan contra entrega (efectivo o digital) y se registran en el panel.

---

## Funcionalidades principales

### Storefront (cliente)
- Catálogo de productos con stock, precio por kg y estado (agotado / stock bajo).
- Productos destacados por especie y banner de domicilio dinámico.
- Carrito persistente en `localStorage`, checkout con dirección, franja de entrega
  y método de pago (efectivo o digital).
- Domicilio configurable: costo normal y "gratis desde" un monto.
- Registro/login, perfil, registro de mascotas e historial de pedidos con estados.

### Panel de administración (`/admin.html`)
- Gestión de catálogo (crear/editar/eliminar, importación Excel masiva).
- Control de inventario: `featured`, `minStock` y **alertas de inventario**.
- Pedidos: filtros por estado + contadores, búsqueda, rango de fechas,
  ordenamiento, paginación, detalle completo y cambio de estado con transiciones válidas.
- Recaudo (diario / quincenal / mensual / rango personalizado) y **cierres de caja**
  persistentes como snapshots históricos.
- Exportación CSV de pedidos y de cierres (con protección anti-fórmula).
- Configuración de domicilio.

---

## Tecnologías

| Capa | Tecnología |
|---|---|
| Backend | Node.js 24 LTS, Express 5 |
| Base de datos | SQLite (dev) con Prisma ORM 6 |
| Frontend | HTML, CSS y JavaScript vanilla (sin framework), servido por Express |
| Seguridad | JWT, Helmet/CSP, CORS por whitelist, bcrypt |
| Otros | Multer (subida de medios), ExcelJS (plantilla/importación Excel) |

---

## Estructura general del proyecto

```
.
├── index.html          # Storefront
├── admin.html          # Panel de administración
├── css/styles.css      # Estilos
├── js/
│   ├── data.js         # Helpers compartidos (API, esc(), estados, settings)
│   ├── app.js          # Lógica del storefront
│   └── admin.js        # Lógica del panel admin
├── assets/             # Logo e imágenes
└── city-pets-backend/
    ├── server.js       # Servidor Express (arranque, CORS, helmet, healthcheck)
    ├── src/
    │   ├── db.js       # Cliente Prisma
    │   ├── logger.js   # Logging estructurado (allowlist de contexto)
    │   ├── constants.js# Estados, transiciones, límites de pedidos
    │   ├── middleware/ # auth, role, rate-limit
    │   ├── controllers/
    │   ├── routes/
    │   └── storage/    # Adaptador de almacenamiento de medios
    ├── prisma/
    │   ├── schema.prisma
    │   ├── migrations/
    │   ├── seed-data.js
    │   └── seed.js     # SOLO desarrollo; no usar en producción
    ├── scripts/        # promote-admin, backup, restore, deploy helpers
    ├── deploy/         # systemd, nginx, deploy.sh (referencia)
    └── uploads/        # Medios subidos (ignorado en Git)
```

La documentación de arquitectura está en [`docs/architecture.md`](docs/architecture.md)
y la guía de despliegue en [`docs/deployment.md`](docs/deployment.md).

---

## Requisitos previos

- **Node.js 24 LTS** (ver `.nvmrc`). El proyecto exige `>=24 <25`.
- **npm** (incluido con Node).
- No se requieren bases de datos externas: SQLite es un archivo local.

---

## Instalación

```bash
# 1. Instalar dependencias del backend (incluye prisma generate en postinstall)
cd city-pets-backend
npm install

# 2. (Si `prisma generate` no corrió) regenerar el cliente Prisma
npx prisma generate

# 3. Crear la BD y aplicar las migraciones
npx prisma migrate deploy

# 4. (Opcional, SOLO desarrollo) sembrar datos de ejemplo
npm run seed
```

> **Advertencia sobre `npm run seed`:** reemplaza el contenido de la base de
> datos con datos de ejemplo. **Nunca lo ejecutes sobre una base de datos de
> producción.** Es exclusivamente para desarrollo.

---

## Configuración (variables de entorno)

Copia `city-pets-backend/.env.example` a `city-pets-backend/.env` y ajusta los
valores. El archivo `.env` **no se sube a Git**.

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `development` (default) o `production`. Otro valor aborta el arranque. |
| `PORT` | Puerto del servidor (default `3000`). |
| `HOST` | `0.0.0.0` en desarrollo; en producción por defecto `127.0.0.1` (solo nginx expone). |
| `DATABASE_URL` | Ruta del SQLite. Dev: `file:./dev.db`. Prod: ruta absoluta en un volumen, p. ej. `file:/var/lib/city-pets/data/dev.db`. |
| `UPLOADS_PATH` | Directorio de medios subidos (default `./uploads` en dev). En prod apuntar a un volumen. |
| `JWT_SECRET` | Secreto para firmar JWT. Mínimo 16 caracteres; el arranque aborta si falta o es débil. |
| `CORS_ORIGINS` | Lista de orígenes permitidos separada por comas (sin `*`). Vacía en producción aborta el arranque. |

> `.env.example` contiene solo placeholders seguros. No copies secretos reales a Git.

---

## Cómo ejecutar

### Desarrollo

```bash
cd city-pets-backend
npm run dev        # nodemon: reinicia al detectar cambios
```

El servidor sirve tanto la API como el frontend (misma origen):

- Storefront: `http://localhost:3000/`
- Panel admin: `http://localhost:3000/admin.html`
- Healthcheck: `http://localhost:3000/api/health`

### Producción

```bash
cd city-pets-backend
NODE_ENV=production npm start
```

En producción el servidor escucha en `127.0.0.1` y debe quedar detrás de un
proxy (nginx) que exponga `80/443` (ver `docs/deployment.md`).

---

## Base de datos y Prisma

- ORM: **Prisma 6** con SQLite.
- `prisma/schema.prisma` define los modelos: `User`, `Pet`, `Product`, `Order`,
  `OrderItem`, `Feedback`, `Attribution`, `StoreSettings` y `StoreClosure`.
- Las migraciones viven en `prisma/migrations/`.

### Aplicar migraciones en un entorno nuevo

```bash
cd city-pets-backend
npx prisma migrate deploy
```

Esto crea/aplica la estructura sin borrar datos. Para el entorno de desarrollo
puedes usar `npx prisma migrate dev` para generar nuevas migraciones, pero
**nunca** con `--force-reset` sobre una base que contenga datos reales.

---

## Healthcheck

`GET /api/health` verifica la conexión a la base de datos:

- `200 {"status":"ok","db":"ok","ip":"..."}` — todo correcto.
- `503 {"status":"degraded","db":"error","ip":"..."}` — la BD no responde
  (el proceso sigue vivo; útil para que el orquestador/healthcheck lo detecte).

---

## Roles y administración

- Los usuarios se registran con rol `user` por defecto.
- El rol **no** se puede escalar desde la API de registro/perfil.
- Para promover un usuario existente a administrador (desarrollo):

```bash
cd city-pets-backend
npm run promote -- <email>
```

- El acceso administrativo se valida en el backend (JWT + rol leído de la BD en
  vivo) en todas las rutas bajo `/api/admin`.

---

## Flujo de pedidos

1. El cliente añade productos al carrito.
2. En checkout se envían `items` (`productId` + `qty`), `address`, `payment` y
   una clave de idempotencia `clientOrderKey`.
3. El backend valida, recalcula precios/domicilio **en el servidor** (nunca confía
   en el cliente), descuenta stock y crea el pedido en una **transacción atómica**.
4. El pedido queda en `pendiente`.

### Gestión de estados

```
pendiente → confirmado → enviado → entregado
    └───→ cancelado  (desde pendiente, confirmado o enviado)
```

- `cancelado` restaura el stock exactamente una vez, dentro de la misma transacción.
- Un pedido `entregado` no puede cancelarse.
- `incidente` es un estado **histórico** de versiones anteriores: se visualiza
  pero no se puede asignar ni transicionar.

### Idempotencia de creación (`clientOrderKey`)

- El frontend genera una clave única por intención de compra.
- Si se repite el mismo `userId + clientOrderKey` con la misma intención, el
  backend devuelve el pedido original (HTTP 200) **sin descontar stock de nuevo**.
- Misma clave con intención distinta → `409`.
- La unicidad la garantiza la restricción de BD `@@unique([userId, clientOrderKey])`,
  protegida frente a solicitudes simultáneas.

### deliveredAt

- Al marcar un pedido como `entregado` se fija `deliveredAt` (una sola vez; no se
  sobrescribe).
- Los pedidos entregados históricos sin `deliveredAt` conservan el valor nulo.

---

## Recaudo y cierres de caja

- **Criterio de recaudo:** solo cuentan pedidos con estado `entregado`, clasificados
  por `deliveredAt` cuando existe y con **fallback a `createdAt`** para los entregados
  históricos (`COALESCE(deliveredAt, createdAt)`).
- **Recaudo dinámico:** `GET /api/admin/revenue?period=diario|quincenal|mensual`
  (o `from`/`to`), desglosado por método (efectivo / digital).
- **Cierres de caja:** `POST /api/admin/closures` guarda una **fotografía (snapshot)
  histórica** del recaudo de un rango. No se recalculan después; si los pedidos
  cambian, el cierre conserva sus valores. `GET /api/admin/closures` lista el historial.

---

## Exportaciones CSV

- Pedidos: `GET /api/admin/export/orders` (respeta filtros `q`, `from`, `to`,
  `status`, `sort`; exporta **todos** los coincidentes, no solo la página visible).
- Cierres: `GET /api/admin/export/closures`.
- Ambos incluyen BOM UTF-8, comillas/escapado correcto y **protección anti-fórmula**
  (celdas que inician con `= + - @` se exportan con prefijo seguro).

---

## Seguridad y robustez implementadas

- **Autenticación JWT** con rol leído de la BD en vivo; rutas admin protegidas.
- **Rate limiting** en login/registro y en la creación de pedidos (HTTP 429 al superar).
- **Validación estricta** de entradas y **límites de pedido** (ítems, cantidades,
  totales, denominaciones de efectivo); rechazo de valores no finitos.
- **Idempotencia** de pedidos (`clientOrderKey`).
- **Protección CAS** (compare-and-swap) en las transiciones de estado para evitar
  condiciones de carrera (doble cancelación, doble entrega, saltos de estado).
- **Stock atómico:** nunca negativo; restauración exacta en cancelación.
- **Logging estructurado** con **allowlist de contexto** (`path`, `method`): nunca
  se registran tokens, contraseñas, cuerpos de peticiones ni objetos arbitrarios.
- **CORS por whitelist**, **Helmet/CSP**, secretos fuera de Git (`.env` ignorado).
- **Shutdown limpio** (SIGTERM/SIGINT cierran el servidor y desconectan Prisma).
- **Healthcheck** con verificación de la base de datos.
- **Cierres** protegidos contra duplicados y concurrentes (unicidad `from,to`).

---

## Comandos útiles

```bash
# Backend (desde city-pets-backend)
npm start                 # Arranque en modo actual
npm run dev               # Arranque con nodemon (desarrollo)
npm run seed              # SOLO desarrollo: sembrar datos de ejemplo (no en prod)
npm run promote -- <email># Promover a administrador (desarrollo)

# Base de datos / Prisma
npx prisma migrate deploy # Aplicar migraciones (no destructivo)
npx prisma generate       # Regenerar el cliente Prisma
npx prisma migrate status # Ver si hay migraciones pendientes

# Backups (desde city-pets-backend)
bash scripts/backup.sh    # Backup de BD + uploads
bash scripts/restore.sh   # Restaurar un backup
```

---

## Limitaciones conocidas y consideraciones de producción

- **SQLite** es de un solo escritor: adecuado para volúmenes bajos/medios. Para
  alta concurrencia se requeriría otro motor.
- **Pagos:** no hay pasarela en línea; el pago se registra contra entrega.
- **Zona horaria:** los rangos de recaudo usan la hora local del servidor;
  conviene fijar `TZ` según la zona del negocio.
- **`npm run seed`** solo para desarrollo (nunca en producción).
- Ver `docs/deployment.md` para el checklist y recomendaciones de despliegue, y
  la sección "Mejoras futuras" al final de `docs/architecture.md` para pendientes
  opcionales no bloqueantes.