/* =========================================================
   CITY PETS — Datos y almacenamiento (localStorage)
   ========================================================= */

const STORE = {
  session: 'cp_session',
  cart: 'cp_cart',
  feedback: 'cp_feedback'
};

const DELIVERY_COST = 8000;
const CHANNELS = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'Google', 'Referido', 'Directo'];

/* =========================================================
   Cliente HTTP hacia el backend (Fase 7.1)
   La sesión ahora se mantiene con el token JWT en cp_session.
   ========================================================= */
/* El frontend lo sirve el propio backend (misma origen), así que la
   API es relativa. En producción se sirve igual desde el mismo host. */
const API_BASE = '/api';

function getToken() {
  try { return localStorage.getItem(STORE.session); } catch { return null; }
}
function setToken(token) {
  try {
    if (token) localStorage.setItem(STORE.session, token);
    else localStorage.removeItem(STORE.session);
  } catch { /* noop */ }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión con el servidor');
  return data;
}

/* Subida de medios en multipart (Fase 9.5B): devuelve { url } con la ruta
   /uploads/... generada por el servidor. Nunca se envía Base64. */
async function uploadFile(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: getToken() ? { Authorization: 'Bearer ' + getToken() } : {},
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error al subir el archivo');
  return data;
}

/* Franjas horarias */
const SLOTS = [
  { id: 'manana', name: 'Mañana', hours: '06:00 – 13:00', dayOffset: 0 },
  { id: 'tarde', name: 'Tarde', hours: '13:00 – 22:00', dayOffset: 0 }
];

/* Regla logística: pedido en la mañana -> entrega en la tarde (mismo día).
   Pedido en la tarde -> entrega al día siguiente en la mañana. */
function getCurrentSlot(date = new Date()) {
  const h = date.getHours();
  if (h < 13) return 'manana';
  return 'tarde';
}

function getNextDeliverySlot(date = new Date()) {
  const current = getCurrentSlot(date);
  if (current === 'manana') {
    return { slot: 'tarde', name: 'Tarde', hours: '13:00 – 22:00', deliveryDate: date.toISOString().slice(0, 10), dateLabel: formatDate(date) };
  }
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return { slot: 'manana', name: 'Mañana', hours: '06:00 – 13:00', deliveryDate: next.toISOString().slice(0, 10), dateLabel: formatDate(next) };
}

function formatDate(iso) {
  const d = iso instanceof Date ? iso : new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ============ Almacenamiento ============ */
function dbRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function dbWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

/* El catálogo ya no persiste en localStorage: siempre viene de la API. */
let _products = [];
let _currentUser = null;

const App = {
  get products() { return _products; },
  set products(v) { _products = Array.isArray(v) ? v : []; },

  get cart() { return dbRead(STORE.cart, []); },
  set cart(v) { dbWrite(STORE.cart, v); },

  get feedback() { return dbRead(STORE.feedback, []); },
  set feedback(v) { dbWrite(STORE.feedback, v); },

  currentUser() { return _currentUser; },
  setCurrentUser(u) { _currentUser = u || null; }
};

/* ============ Utilidades ============ */
function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function detectChannel() {
  const url = new URLSearchParams(location.search);
  const s = url.get('src') || url.get('utm_source');
  if (s && CHANNELS.some(c => c.toLowerCase() === s.toLowerCase())) {
    return CHANNELS.find(c => c.toLowerCase() === s.toLowerCase());
  }
  if (s) return s;
  return null;
}

function renderStars(n) {
  const full = Math.round(n || 0);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

/* Escapa HTML para evitar XSS al interpolar datos de usuarios/admins. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}