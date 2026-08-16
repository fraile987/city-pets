/* =========================================================
   CITY PETS — Rutas de productos
   ========================================================= */

const express = require('express');
const { listProducts } = require('../controllers/products');

const router = express.Router();

router.get('/', listProducts);

module.exports = router;