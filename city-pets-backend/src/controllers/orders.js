/* =========================================================
   CITY PETS — Controladores de pedidos
   El pedido siempre se asocia a req.user.id (nunca se acepta
   userId del cuerpo). El backend recalcula precios, totales y
   la franja de entrega; no confía en el frontend.
   ========================================================= */

const prisma = require('../db');

const DELIVERY_COST = 8000;

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
    if (seen.has(it.productId)) {
      return res.status(400).json({ error: 'No repitas productos en el pedido' });
    }
    seen.add(it.productId);
    normalized.push({ productId: it.productId, qty });
  }

  if (typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'Indica la dirección de entrega' });
  }

  /* Normaliza el método de pago (objeto -> String serializado). */
  const payMethod = payment && payment.method === 'efectivo' ? 'efectivo' : 'digital';
  const denomination = payMethod === 'efectivo' ? toPositiveInt(payment && payment.denomination) : 0;
  const paymentSerialized = JSON.stringify({
    method: payMethod,
    denomination: denomination || 0
  });

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

  /* Cálculos del lado del servidor (nunca del cliente). */
  const subtotal = lineItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const delivery = subtotal > 0 ? DELIVERY_COST : 0;
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
          status: 'pendiente'
        },
        include: { items: true }
      });
    });

    res.status(201).json(serializeOrder(order));
  } catch (e) {
    if (e.message && e.message.startsWith('Stock insuficiente')) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}

module.exports = { listOrders, createOrder, serializeOrder };