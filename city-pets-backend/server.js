/* =========================================================
   CITY PETS — Servidor Express (Fase 2)
   ========================================================= */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

/* ---------- Guard de arranque (fail fast) ---------- */
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET || JWT_SECRET === 'cambia-esto-por-un-secreto-seguro' || JWT_SECRET.length < 16) {
  console.error('[FATAL] JWT_SECRET no configurado o demasiado débil. Define uno en .env');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

/* ---------- Middlewares ---------- */
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* ---------- Rutas ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/products', require('./src/routes/products'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/pets', require('./src/routes/pets'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/admin', require('./src/routes/admin'));

/* ---------- 404 y errores (siempre JSON, sin stack en producción) ---------- */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.expose && err.message ? err.message : 'Error interno del servidor' });
});

/* ---------- Arranque ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`City Pets API escuchando en http://localhost:${PORT}`);
});