/* =========================================================
   CITY PETS — Servidor Express (Fase 2)
   ========================================================= */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

/* ---------- Entorno (Fase 9.5A) ----------
   Desarrollo por defecto. Solo se permiten development/production;
   cualquier otro valor aborta el arranque para no mezclar configuraciones. */
const NODE_ENV = process.env.NODE_ENV || 'development';
if (!['development', 'production'].includes(NODE_ENV)) {
  console.error(`[FATAL] NODE_ENV inválido: "${NODE_ENV}". Usa 'development' o 'production'.`);
  process.exit(1);
}
const IS_PROD = NODE_ENV === 'production';

/* ---------- Guard de arranque (fail fast) ---------- */
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET === 'cambia-esto-por-un-secreto-seguro' || JWT_SECRET.length < 16) {
  console.error('[FATAL] JWT_SECRET no configurado o demasiado débil. Define uno en .env');
  process.exit(1);
}

/* ---------- Interfaz de escucha (Fase 9.6) ----------
   Desarrollo: 0.0.0.0 (accesible desde la red local para pruebas).
   Producción: 127.0.0.1 (solo nginx debe exponer el servicio).
   Un despliegue de producción escuchando en 0.0.0.0/:: es un error de
   configuración peligroso: el arranque aborta (fail-fast). */
const HOST = process.env.HOST || (IS_PROD ? '127.0.0.1' : '0.0.0.0');
if (IS_PROD && (HOST === '0.0.0.0' || HOST === '::')) {
  console.error(`[FATAL] Producción no puede escuchar en ${HOST}: nginx debe ser la única entrada (usa HOST=127.0.0.1).`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

/* ---------- Proxy de confianza (Fase 9.6) ----------
   Detrás de nginx, Express confía SOLO en el proxy inmediato (1) para
   leer X-Forwarded-For y conocer la IP real del cliente. En desarrollo
   no hay proxy: se ignora cualquier cabecera forjada por el cliente. */
app.set('trust proxy', IS_PROD ? 1 : false);

/* ---------- Cabeceras de seguridad (Fase 9.3.1) ----------
   Helmet con CSP adaptada a City Pets:
   - style-src 'unsafe-inline' porque la interfaz usa estilos inline
     (se retirará en una fase futura para endurecer la política).
   - img-src permite el catálogo local ('self'), data: y blob:
     (previsualización de archivos en el admin). Sin dependencias externas.
   - COEP desactivado: requiere-CORP bloquearía las imágenes externas.
   - HSTS NO activado: solo se habilitará cuando el sitio esté bajo HTTPS. */
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"]
    }
  },
  strictTransportSecurity: IS_PROD
    ? { maxAge: 15552000, includeSubDomains: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

/* Permissions-Policy: helmet 8 ya no la incluye; ninguna feature se usa. */
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

/* ---------- Middlewares ---------- */
/* CORS separado por entorno (Fase 9.5A):
   - Desarrollo: localhost/127.0.0.1 + CORS_ORIGINS.
   - Producción: SOLO CORS_ORIGINS (lista exacta, sin "*").
     Sin CORS_ORIGINS en producción, el arranque aborta: así una mala
     configuración no convierte producción en modo desarrollo. */
const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const configuredOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

if (configuredOrigins.includes('*')) {
  console.error('[FATAL] CORS_ORIGINS no admite "*": enumera los orígenes exactos (p. ej. https://citypets.com).');
  process.exit(1);
}
if (IS_PROD && !configuredOrigins.length) {
  console.error('[FATAL] Producción sin CORS_ORIGINS: define la lista de orígenes permitidos en .env');
  process.exit(1);
}

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (IS_PROD) return cb(null, configuredOrigins.includes(origin));
    return cb(null, DEV_ORIGIN_RE.test(origin) || configuredOrigins.includes(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '2mb' }));

/* ---------- Rutas ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ip: req.ip });
});

app.use('/api/products', require('./src/routes/products'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/pets', require('./src/routes/pets'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/upload', require('./src/routes/upload'));

/* ---------- 404 y errores (siempre JSON, sin stack en producción) ---------- */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

/* ---------- Frontend servido desde la API (misma origen) ---------- */
const FRONTEND_ROOT = path.resolve(__dirname, '..');

/* Medios subidos (Fase 9.5B): /uploads/products/... servidos con
   nosniff; las extensiones están restringidas por el adaptador. */
const { UPLOADS_ROOT } = require('./src/storage');
app.use('/uploads', express.static(UPLOADS_ROOT, {
  index: false,
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/city-pets-backend') || req.path.startsWith('/.git')) {
    return res.status(404).send('Not found');
  }
  next();
});
app.use(express.static(FRONTEND_ROOT));

app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo supera el tamaño máximo permitido'
      : 'Archivo inválido' });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.expose && err.message ? err.message : 'Error interno del servidor' });
});

/* ---------- Arranque ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, HOST, () => {
  console.log(`City Pets API [${NODE_ENV}] escuchando en http://${HOST}:${PORT}`);
});