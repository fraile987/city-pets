/* =========================================================
   CITY PETS — Controladores de pedidos
   El pedido siempre se asocia a req.user.id (nunca se acepta
   userId del cuerpo). El backend recalcula precios, totales y
   la franja de entrega; no confía en el frontend.
   ========================================================= */

const prisma = require('../db');
const { MAX } = require('../constants');
const { getStoreSettings, computeDelivery } = require('./settings');

const MAX_QTY = 100;

/* ---- Regla logística replicada del prototipo (js/data.js) ---- */
function getCurrentSlot(date = new Date()) {
  return date.getHours() < 13 ? 'manana' : 'tarde';
}

function getNextDeliverySlot(date = new Date()) {
  const current = getCurrentSlot(date);
  if (current === 'manana') {
    return {
      slot: 'tarde',
      name: 'Tarde',
      hours: '13:00 – 22:00',
      deliveryDate: date.toISOString().slice(0, 10),
      dateLabel: formatDate(date)
    };
  }
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return {
    slot: 'manana',
    name: 'Mañana',
    hours: '06:00 – 13:00',
    deliveryDate: next.toISOString().slice(0, 10),
    dateLabel: formatDate(next)
  };
}

function formatDate(iso) {
  const d = iso instanceof Date ? iso : new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---- Utilidades ---- */
function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toPositiveInt(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* Forma serializada de un pedido para la API (items + payment como objeto). */
function serializeOrder(o) {
  return {
    ...o,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      qty: i.qty,
      price: i.price,
      image: i.image
    })),
    payment: parseJson(o.payment, { method: 'digital' })
  };
}

/* ---------- Huella determinista de la intención (P6.2) ----------
   Compara la intención de compra usando datos históricos (items, address,
   payment), NUNCA precios enviados por el cliente. La intención NO incluye
   precios ni stock actuales. */
function intentFromRequest(normalized, address, payMethod, denomination) {
  const items = normalized.map((it) => `${it.productId}:${it.qty}`).sort().join('|');
  return [items, (address || '').trim(), `${payMethod}:${denomination}`].join('||');
}

function intentFromOrder(o) {
  const items = o.items
    .map((i) => `${i.productId || '#' + i.name}:${i.qty}`)
    .sort()
    .join('|');
  const pay = parseJson(o.payment, { method: 'digital' });
  const payMethod = pay.method === 'efectivo' ? 'efectivo' : 'digital';
  const denomination = parseInt(pay.denomination, 10) || 0;
  return [items, (o.address || '').trim(), `${payMethod}:${denomination}`].join('||');
}

/* Devuelve el pedido existente por (userId, clientOrderKey) o null. */
function findByIdempotencyKey(userId, key) {
  return prisma.order.findUnique({
    where: { userId_clientOrderKey: { userId, clientOrderKey: key } },
    include: { items: true }
  });
}

async function listOrders(req, res) {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    include: { items: true },
    orderBy: { createdAt: 'desc' }
  });

  res.json(orders.map(serializeOrder));
}

async function createOrder(req, res) {
  const { items, address, payment } = req.body;
  let clientOrderKey = req.body && req.body.clientOrderKey;

  /* Clave de idempotencia opcional (P6.2): clave única por intención. */
  if (clientOrderKey !== undefined && clientOrderKey !== null) {
    if (typeof clientOrderKey !== 'string' || clientOrderKey.trim() === '' || clientOrderKey.trim().length > 128) {
      return res.status(400).json({ error: 'clientOrderKey debe ser una cadena de 1 a 128 caracteres' });
    }
    clientOrderKey = clientOrderKey.trim();
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe incluir al menos un producto' });
  }

  /* Valida y normaliza los ítems recibidos: solo productId + qty. */
  const normalized = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it.productId !== 'string' || !it.productId.trim()) {
      return res.status(400).json({ error: 'Cada ítem debe indicar productId' });
    }
    const qty = toPositiveInt(it.qty);
    if (qty === null) {
      return res.status(400).json({ error: 'La cantidad de cada ítem debe ser un entero positivo' });
    }
    if (qty > MAX_QTY) {
      return res.status(400).json({ error: `La cantidad máxima por ítem es ${MAX_QTY}` });
    }
    if (seen.has(it.productId)) {
      return res.status(400).json({ error: 'No repitas productos en el pedido' });
    }
    seen.add(it.productId);
    normalized.push({ productId: it.productId, qty });
  }

  if (typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'Indica la dirección de entrega' });
  }
  if (address.trim().length > MAX.address) {
    return res.status(400).json({ error: `La dirección no puede superar ${MAX.address} caracteres` });
  }

  /* Normaliza el método de pago (objeto -> String serializado). */
  const payMethod = payment && payment.method === 'efectivo' ? 'efectivo' : 'digital';
  const denomination = payMethod === 'efectivo' ? toPositiveInt(payment && payment.denomination) : 0;
  const paymentSerialized = JSON.stringify({
    method: payMethod,
    denomination: denomination || 0
  });

  /* Idempotencia (P6.2): si ya existe un pedido para (userId, clientOrderKey),
     se devuelve el original si la intención coincide; si difiere, 409. */
  if (clientOrderKey) {
    const existing = await findByIdempotencyKey(req.user.id, clientOrderKey);
    if (existing) {
      if (intentFromOrder(existing) === intentFromRequest(normalized, address, payMethod, denomination)) {
        return res.status(200).json(serializeOrder(existing));
      }
      return res.status(409).json({ error: 'La clave de pedido ya fue utilizada para una intención diferente' });
    }
  }

  const productIds = normalized.map((n) => n.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  /* Verifica existencia y stock de todos los ítems antes de escribir. */
  const lineItems = [];
  for (const n of normalized) {
    const p = byId.get(n.productId);
    if (!p) {
      return res.status(400).json({ error: `El producto ${n.productId} ya no existe` });
    }
    if (n.qty > p.stock) {
      return res.status(400).json({
        error: `Stock insuficiente para ${p.name}: hay ${p.stock} disponibles`
      });
    }
    lineItems.push({ product: p, qty: n.qty });
  }

  /* Cálculos del lado del servidor (nunca del cliente). El costo del
     domicilio sale de la configuración persistida (StoreSettings). */
  const subtotal = lineItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const settings = await getStoreSettings();
  const delivery = computeDelivery(subtotal, settings);
  const total = subtotal + delivery;
  const slot = getNextDeliverySlot();

  try {
    const order = await prisma.$transaction(async (tx) => {
      /* Descarta inventario de forma atómica por ítem. */
      for (const i of lineItems) {
        const result = await tx.product.updateMany({
          where: { id: i.product.id, stock: { gte: i.qty } },
          data: { stock: { decrement: i.qty } }
        });
        if (result.count !== 1) {
          throw new Error(`Stock insuficiente para ${i.product.name}`);
        }
      }

      return tx.order.create({
        data: {
          userId: req.user.id,
          userName: req.user.name,
          phone: req.user.phone,
          address: address.trim(),
          items: {
            create: lineItems.map((i) => ({
              productId: i.product.id,
              name: i.product.name,
              qty: i.qty,
              price: i.product.price,
              image: parseJson(i.product.images, [])[0] || ''
            }))
          },
          subtotal,
          delivery,
          total,
          slotGenerated: getCurrentSlot(),
          deliverySlot: slot.slot,
          deliveryDate: slot.deliveryDate,
          deliveryLabel: slot.dateLabel,
          payment: paymentSerialized,
          status: 'pendiente',
          clientOrderKey: clientOrderKey || undefined
        },
        include: { items: true }
      });
    });

    res.status(201).json(serializeOrder(order));
  } catch (e) {
    if (e.message && e.message.startsWith('Stock insuficiente')) {
      return res.status(400).json({ error: e.message });
    }
    /* Concurrencia (P6.2): otra solicitud con la misma clave creó el pedido.
       La transacción (incluido el descuento de stock) se revierte. Se recupera
       el pedido existente y se devuelve si la intención coincide. */
    if (e.code === 'P2002' && clientOrderKey) {
      const existing = await findByIdempotencyKey(req.user.id, clientOrderKey);
      if (existing) {
        if (intentFromOrder(existing) === intentFromRequest(normalized, address, payMethod, denomination)) {
          return res.status(200).json(serializeOrder(existing));
        }
        return res.status(409).json({ error: 'La clave de pedido ya fue utilizada para una intención diferente' });
      }
    }
    throw e;
  }
}

module.exports = { listOrders, createOrder, serializeOrder };