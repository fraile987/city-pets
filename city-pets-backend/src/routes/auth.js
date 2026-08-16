/* =========================================================
   CITY PETS — Rutas de autenticación
   ========================================================= */

const express = require('express');
const { register, login, me, updateMe } = require('../controllers/auth');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authRequired, me);
router.put('/me', authRequired, updateMe);

module.exports = router;