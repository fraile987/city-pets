/* =========================================================
   CITY PETS — Rutas de pedidos
   Todas las rutas requieren autenticación (JWT).
   ========================================================= */

const express = require('express');
const { listOrders, createOrder } = require('../controllers/orders');
const { authRequired } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authRequired);

router.get('/', listOrders);
/* P7.1: límite de creación de pedidos por IP (ventana 1 min). Generoso para
   no afectar reintentos idempotentes legítimos (misma clientOrderKey); solo
   frena abuso/spam. */
router.post('/',
  rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Demasiados pedidos desde esta IP. Intenta más tarde' }),
  createOrder);

module.exports = router;