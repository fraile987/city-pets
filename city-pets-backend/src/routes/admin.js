/* =========================================================
   CITY PETS — Rutas de administración
   Requieren autenticación (JWT) y rol admin.
   ========================================================= */

const express = require('express');
const multer = require('multer');
const { listAllOrders, updateOrderStatus, listAttribution, getRevenue, createClosure, listClosures, exportOrdersCSV, exportClosuresCSV } = require('../controllers/admin');
const { getTemplate, preview, commit } = require('../controllers/import');
const { updateSettings } = require('../controllers/settings');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.use(authRequired, requireRole('admin'));

/* Importación Excel (Fase 2): plantilla, vista previa y confirmación. */
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.get('/import/template', getTemplate);
router.post('/import/preview', importUpload.single('file'), preview);
router.post('/import/commit', commit);
router.put('/settings', updateSettings);

router.get('/orders', listAllOrders);
router.patch('/orders/:id/status', updateOrderStatus);
router.get('/attribution', listAttribution);
router.get('/revenue', getRevenue);
router.get('/closures', listClosures);
router.post('/closures', createClosure);
router.get('/export/orders', exportOrdersCSV);
router.get('/export/closures', exportClosuresCSV);

module.exports = router;