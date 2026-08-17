/* =========================================================
   CITY PETS — Rutas de autenticación
   ========================================================= */

const express = require('express');
const { register, login, me, updateMe } = require('../controllers/auth');
const { authRequired } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.post('/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Demasiados registros desde esta IP. Intenta más tarde' }), register);
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: 'Demasiados intentos de inicio de sesión. Intenta más tarde' }), login);
router.get('/me', authRequired, me);
router.put('/me', authRequired, updateMe);

module.exports = router;