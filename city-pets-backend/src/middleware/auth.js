/* =========================================================
   CITY PETS — Middleware de autenticación
   Verifica el token JWT y carga el usuario en req.user.
   ========================================================= */

const jwt = require('jsonwebtoken');
const prisma = require('../db');

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/* Autenticación opcional (compra como invitado):
   - Sin cabecera Authorization  -> req.user = null (modo invitado).
   - Token válido                -> req.user cargado (modo autenticado).
   - Token inválido/expirado     -> 401 (no se degrada silenciosamente a invitado). */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { authRequired, optionalAuth };