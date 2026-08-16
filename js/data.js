/* =========================================================
   CITY PETS — Datos y almacenamiento (localStorage)
   ========================================================= */

const STORE = {
  products: 'cp_products',
  users: 'cp_users',
  session: 'cp_session',
  cart: 'cp_cart',
  orders: 'cp_orders',
  feedback: 'cp_feedback',
  attributions: 'cp_attributions'
};

const DELIVERY_COST = 8000;
const CHANNELS = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'Google', 'Referido', 'Directo'];

/* =========================================================
   Cliente HTTP hacia el backend (Fase 7.1)
   La sesión ahora se mantiene con el token JWT en cp_session.
   ========================================================= */
const API_BASE = 'http://localhost:3000/api';

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

/* ============ Productos semilla ============ */
const SEED_PRODUCTS = [
  { id: 'p1', name: 'Alimento Adulto Perro 15 kg', species: 'Perros', category: 'Alimento', price: 185000, unit: '15 kg', grams: 15000, stock: 42, desc: 'Alimento balanceado premium para perros adultos con proteína de pollo.', images: ['https://picsum.photos/seed/dogfood1/600/450'], video: '', rating: 4.7, dailyRation: 210, tags: ['top'] },
  { id: 'p2', name: 'Alimento Cachorro Perro 3 kg', species: 'Perros', category: 'Alimento', price: 62000, unit: '3 kg', grams: 3000, stock: 60, desc: 'Fórmula especial para cachorros en crecimiento, rica en calcio.', images: ['https://picsum.photos/seed/dogfood2/600/450'], video: '', rating: 4.5, dailyRation: 90, tags: [] },
  { id: 'p3', name: 'Alimento Light Perro 10 kg', species: 'Perros', category: 'Alimento', price: 124000, unit: '10 kg', grams: 10000, stock: 18, desc: 'Control de peso con bajo contenido de grasa y alta fibra.', images: ['https://picsum.photos/seed/dogfood3/600/450'], video: '', rating: 4.2, dailyRation: 160, tags: [] },
  { id: 'p4', name: 'Alimento Adulto Gato 7 kg', species: 'Gatos', category: 'Alimento', price: 142000, unit: '7 kg', grams: 7000, stock: 35, desc: 'Alimento balanceado para gatos adultos, sabor salmón y arroz.', images: ['https://picsum.photos/seed/catfood1/600/450'], video: '', rating: 4.8, dailyRation: 55, tags: ['top'] },
  { id: 'p5', name: 'Alimento Gato Esterilizado 3 kg', species: 'Gatos', category: 'Alimento', price: 98000, unit: '3 kg', grams: 3000, stock: 27, desc: 'Fórmula para gatos esterilizados que ayuda al control urinario.', images: ['https://picsum.photos/seed/catfood2/600/450'], video: '', rating: 4.6, dailyRation: 48, tags: [] },
  { id: 'p6', name: 'Galletas Dentales 1 kg', species: 'Perros', category: 'Snacks', price: 28500, unit: '1 kg', grams: 1000, stock: 120, desc: 'Snack dental que reduce sarro y mal aliento.', images: ['https://picsum.photos/seed/snack1/600/450'], video: '', rating: 4.4, dailyRation: 15, tags: [] },
  { id: 'p7', name: 'Snack Premium Gato 400 g', species: 'Gatos', category: 'Snacks', price: 22400, unit: '400 g', grams: 400, stock: 95, desc: 'Premios suaves sabor atún, perfectos para entrenamiento.', images: ['https://picsum.photos/seed/snack2/600/450'], video: '', rating: 4.3, dailyRation: 10, tags: [] },
  { id: 'p8', name: 'Juguete Cuerda + Pelota', species: 'Perros', category: 'Juguetes', price: 18400, unit: '1 und', grams: 0, stock: 74, desc: 'Combo de juguete resistente para morder y lanzar.', images: ['https://picsum.photos/seed/toy1/600/450'], video: '', rating: 4.1, dailyRation: 0, tags: [] },
  { id: 'p9', name: 'Rascador Torre Gato', species: 'Gatos', category: 'Juguetes', price: 135000, unit: '1 und', grams: 0, stock: 12, desc: 'Torre rascador de 120 cm con plataformas y peluche.', images: ['https://picsum.photos/seed/toy2/600/450'], video: '', rating: 4.9, dailyRation: 0, tags: ['top'] },
  { id: 'p10', name: 'Arena Sanitaria 10 kg', species: 'Gatos', category: 'Higiene', price: 32000, unit: '10 kg', grams: 0, stock: 88, desc: 'Arena aglomerante con control de olores, 10 kg.', images: ['https://picsum.photos/seed/litter/600/450'], video: '', rating: 4.5, dailyRation: 0, tags: [] },
  { id: 'p11', name: 'Shampoo Antipulgas 500 ml', species: 'General', category: 'Higiene', price: 26500, unit: '500 ml', grams: 0, stock: 66, desc: 'Baño con protección contra pulgas y garrapatas hasta 14 días.', images: ['https://picsum.photos/seed/shampoo/600/450'], video: '', rating: 4.2, dailyRation: 0, tags: [] },
  { id: 'p12', name: 'Collar Reflectivo ajustable', species: 'General', category: 'Accesorios', price: 19800, unit: '1 und', grams: 0, stock: 130, desc: 'Collar de nailon con banda reflectiva para paseos nocturnos.', images: ['https://picsum.photos/seed/collar/600/450'], video: '', rating: 4.6, dailyRation: 0, tags: [] },
  { id: 'p13', name: 'Cama Deluxe para Mascota', species: 'General', category: 'Accesorios', price: 89000, unit: '1 und', grams: 0, stock: 9, desc: 'Cama acolchada tipo peluche, lavable, talla única.', images: ['https://picsum.photos/seed/cama/600/450'], video: '', rating: 4.8, dailyRation: 0, tags: [] },
  { id: 'p14', name: 'Comida Húmeda Perro 200 g (12 und)', species: 'Perros', category: 'Alimento', price: 45900, unit: '12 x 200 g', grams: 2400, stock: 54, desc: 'Sobres húmedos sabor res, para perros de todas las edades.', images: ['https://picsum.photos/seed/wetdog/600/450'], video: '', rating: 4.7, dailyRation: 90, tags: [] }
];

/* ============ Almacenamiento ============ */
function dbRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function dbWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function seedProducts() {
  if (!localStorage.getItem(STORE.products)) {
    dbWrite(STORE.products, SEED_PRODUCTS);
  }
}

const App = {
  get products() { return dbRead(STORE.products, []); },
  set products(v) { dbWrite(STORE.products, v); },

  get users() { return dbRead(STORE.users, []); },
  set users(v) { dbWrite(STORE.users, v); },

  get session() { return dbRead(STORE.session, null); },
  set session(v) { dbWrite(STORE.session, v); },

  get cart() { return dbRead(STORE.cart, []); },
  set cart(v) { dbWrite(STORE.cart, v); },

  get orders() { return dbRead(STORE.orders, []); },
  set orders(v) { dbWrite(STORE.orders, v); },

  get feedback() { return dbRead(STORE.feedback, []); },
  set feedback(v) { dbWrite(STORE.feedback, v); },

  get attributions() { return dbRead(STORE.attributions, []); },
  set attributions(v) { dbWrite(STORE.attributions, v); },

  currentUser() { return _currentUser; },
  setCurrentUser(u) { _currentUser = u || null; }
};

let _currentUser = null;

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