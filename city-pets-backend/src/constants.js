/* =========================================================
   CITY PETS — Constantes y validaciones compartidas
   ========================================================= */

const CHANNELS = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'Google', 'Referido', 'Directo'];

const ORDER_STATUSES = ['pendiente', 'entregado', 'incidente'];

/* Límites de longitud para campos ingresados por usuarios/admins. */
const MAX = {
  name: 120,
  species: 60,
  category: 60,
  unit: 40,
  desc: 600,
  address: 300,
  phone: 30,
  breed: 60
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim());
}

module.exports = { CHANNELS, ORDER_STATUSES, MAX, EMAIL_RE, isEmail };