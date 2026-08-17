/* =========================================================
   CITY PETS — Rutas de administración
   Requieren autenticación (JWT) y rol admin.
   ========================================================= */

const express = require('express');
const { listAllOrders, updateOrderStatus, listAttribution } = require('../controllers/admin');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.use(authRequired, requireRole('admin'));

router.get('/orders', listAllOrders);
router.patch('/orders/:id/status', updateOrderStatus);
router.get('/attribution', listAttribution);

module.exports = router;