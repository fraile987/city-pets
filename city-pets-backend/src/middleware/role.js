/* =========================================================
   CITY PETS — Middleware de autorización por rol
   Debe ejecutarse después de authRequired (req.user ya cargado).
   El rol se lee de la BD en vivo, no del token.
   ========================================================= */

function requireRole(role) {
  return (req, res, next) => {
    if (req.user && req.user.role === role) return next();
    return res.status(403).json({ error: 'Acceso restringido' });
  };
}

module.exports = { requireRole };