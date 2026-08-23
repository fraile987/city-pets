/* =========================================================
   CITY PETS — Configuración pública
   GET /api/settings expone lo necesario para calcular el
   checkout (costo de domicilio y umbral de envío gratis).
   ========================================================= */

const express = require('express');
const { getSettings } = require('../controllers/settings');

const router = express.Router();

router.get('/', getSettings);

module.exports = router;