/* =========================================================
   CITY PETS — Rutas de autenticación
   ========================================================= */

const express = require('express');
const { register, login, me, updateMe, forgot, reset } = require('../controllers/auth');
const { authRequired } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.post('/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Demasiados registros desde esta IP. Intenta más tarde' }), register);
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: 'Demasiados intentos de inicio de sesión. Intenta más tarde' }), login);
/* Recuperación de contraseña (D1): límites conservadores por IP. */
router.post('/forgot', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Demasiadas solicitudes de recuperación. Intenta más tarde' }), forgot);
router.post('/reset', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Demasiados intentos de restablecimiento. Intenta más tarde' }), reset);
router.get('/me', authRequired, me);
router.put('/me', authRequired, updateMe);

module.exports = router;