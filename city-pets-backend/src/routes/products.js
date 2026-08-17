/* =========================================================
   CITY PETS — Rutas de productos
   GET es público; el CRUD de escritura es solo para admin.
   ========================================================= */

const express = require('express');
const { listProducts, createProduct, updateProduct, deleteProduct } = require('../controllers/products');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();

router.get('/', listProducts);
router.post('/', authRequired, requireRole('admin'), createProduct);
router.put('/:id', authRequired, requireRole('admin'), updateProduct);
router.delete('/:id', authRequired, requireRole('admin'), deleteProduct);

module.exports = router;