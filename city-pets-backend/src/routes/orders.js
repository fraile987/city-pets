/* =========================================================
   CITY PETS — Rutas de pedidos
   Todas las rutas requieren autenticación (JWT).
   ========================================================= */

const express = require('express');
const { listOrders, createOrder } = require('../controllers/orders');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired);

router.get('/', listOrders);
router.post('/', createOrder);

module.exports = router;