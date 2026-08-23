/* =========================================================
   CITY PETS — Logger estructurado (una línea JSON por evento)
   Seguridad: SOLO se serializan las claves de contexto incluidas
   en la allowlist. Cualquier otro dato (tokens, contraseñas,
   cuerpos de peticiones, objetos arbitrarios) se ignora.
   ========================================================= */

/* Claves adicionales permitidas en el contexto (además de err). */
const ALLOWED_CTX_KEYS = ['path', 'method'];

function serialize(level, msg, ctx) {
  const entry = { level, time: new Date().toISOString(), msg };
  if (ctx && typeof ctx === 'object') {
    if (ctx.err instanceof Error) {
      entry.errMessage = ctx.err.message;
      if (ctx.err.code !== undefined) entry.errCode = ctx.err.code;
    }
    ALLOWED_CTX_KEYS.forEach((k) => {
      const v = ctx[k];
      if (v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        entry[k] = v;
      }
    });
  }
  return JSON.stringify(entry);
}

function emit(level, msg, ctx) {
  const out = serialize(level, msg, ctx);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

module.exports = {
  error: (msg, ctx) => emit('error', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx)
};