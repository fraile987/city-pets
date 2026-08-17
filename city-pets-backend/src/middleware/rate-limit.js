/* =========================================================
   CITY PETS — Middleware de límite de peticiones (en memoria)
   Ventana deslizante por IP; responde 429 al superar el tope.
   ========================================================= */

function rateLimit({ windowMs, max, message }) {
  const buckets = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, hit] of buckets) {
      if (hit.resetAt <= now) buckets.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const hit = buckets.get(key);

    if (!hit || hit.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    hit.count += 1;
    if (hit.count > max) {
      res.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

module.exports = { rateLimit };