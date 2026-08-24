/* =========================================================
   CITY PETS — Rutas de pedidos
   - GET (historial) exige autenticación (JWT).
   - POST acepta autenticado (comportamiento actual) o invitado
     (sin JWT; requiere name/phone/clientOrderKey en el cuerpo).
   ========================================================= */

const express = require('express');
const { listOrders, createOrder } = require('../controllers/orders');
const { authRequired, optionalAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.get('/', authRequired, listOrders);
/* P7.1: límite de creación de pedidos por IP (ventana 1 min). Generoso para
   no afectar reintentos idempotentes legítimos (misma clientOrderKey); solo
   frena abuso/spam. */
router.post('/',
  optionalAuth,
  rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Demasiados pedidos desde esta IP. Intenta más tarde' }),
  createOrder);

module.exports = router;