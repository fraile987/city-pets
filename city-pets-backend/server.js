/* =========================================================
   CITY PETS — Servidor Express (Fase 2)
   ========================================================= */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

/* ---------- Middlewares ---------- */
app.use(cors());
app.use(express.json());

/* ---------- Rutas ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/products', require('./src/routes/products'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/pets', require('./src/routes/pets'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/admin', require('./src/routes/admin'));

/* ---------- Arranque ---------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`City Pets API escuchando en http://localhost:${PORT}`);
});