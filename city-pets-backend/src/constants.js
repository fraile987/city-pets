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

/* Límites operativos de pedidos (P7.1).
   - maxItems: 50 líneas por pedido (un pedido mayor se rechaza con 400).
   - maxQty: 100 unidades por producto (protege cálculos y stock).
   - maxTotal: 500.000.000 COP. Justificación: el producto más caro del
     catálogo cuesta ≤ 100.000.000 y la cantidad máxima por línea es 100,
     por lo que una línea real no supera ~18,5M (185.000 × 100) en el seed.
     Un tope de 500M está muy por encima de cualquier pedido real de la
     tienda y, a la vez, muy por debajo del máximo de Int32 (2.147.483.647),
     lo que evita desbordes en subtotal/total.
   - maxCashDenomination: 1.000.000 COP. El billete colombiano más alto es
     de 100.000; 1M admite cualquier billete legítimo y rechaza valores
     absurdos. */
const ORDER_LIMITS = {
  maxItems: 50,
  maxQty: 100,
  maxTotal: 500000000,
  maxCashDenomination: 1000000
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim());
}

module.exports = { CHANNELS, ORDER_STATUSES, ORDER_TRANSITIONS, MAX, ORDER_LIMITS, EMAIL_RE, isEmail };