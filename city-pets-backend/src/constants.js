/* =========================================================
   CITY PETS — Constantes y validaciones compartidas
   ========================================================= */

const CHANNELS = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'Google', 'Referido', 'Directo'];

/* Estados de pedido (Fase P1):
   - ORDEN: pendiente → confirmado → enviado → entregado
   - cancelado: se puede cancelar desde pendiente, confirmado o enviado.
   - incidente es HISTÓRICO (pedidos antiguos): se visualiza, pero no se
     asigna a pedidos nuevos ni aparece como transición disponible. */
const ORDER_STATUSES = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'];

/* Transiciones permitidas entre estados. Una vez entregado o cancelado no
   hay transiciones salientes. 'incidente' (histórico) no tiene salidas. */
const ORDER_TRANSITIONS = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['enviado', 'cancelado'],
  enviado: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
  incidente: []
};

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

module.exports = { CHANNELS, ORDER_STATUSES, ORDER_TRANSITIONS, MAX, EMAIL_RE, isEmail };