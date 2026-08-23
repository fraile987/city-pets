/* =========================================================
   CITY PETS — Rutas de administración
   Requieren autenticación (JWT) y rol admin.
   ========================================================= */

const express = require('express');
const multer = require('multer');
const { listAllOrders, updateOrderStatus, listAttribution } = require('../controllers/admin');
const { getTemplate, preview, commit } = require('../controllers/import');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.use(authRequired, requireRole('admin'));

/* Importación Excel (Fase 2): plantilla, vista previa y confirmación. */
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.get('/import/template', getTemplate);
router.post('/import/preview', importUpload.single('file'), preview);
router.post('/import/commit', commit);

router.get('/orders', listAllOrders);
router.patch('/orders/:id/status', updateOrderStatus);
router.get('/attribution', listAttribution);

module.exports = router;