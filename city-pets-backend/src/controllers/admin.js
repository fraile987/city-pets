/* =========================================================
   CITY PETS — Controladores de administración
   Todas estas rutas requieren authRequired + requireRole('admin').
   ========================================================= */

const prisma = require('../db');
const { ORDER_STATUSES, ORDER_TRANSITIONS } = require('../constants');
const { serializeOrder } = require('./orders');

async function listAllOrders(req, res) {
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders.map(serializeOrder));
}

async function updateOrderStatus(req, res) {
  const target = req.body && req.body.status;

  /* El estado incidente es histórico: no puede asignarse a pedidos nuevos. */
  if (target === 'incidente') {
    return res.status(400).json({ error: 'El estado incidente es histórico y no puede asignarse' });
  }
  if (!ORDER_STATUSES.includes(target)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true }
  });
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  const current = order.status;

  /* Idempotente: pedido ya en el estado solicitado (evita doble restauración). */
  if (current === target) {
    return res.json(serializeOrder(order));
  }

  const allowed = ORDER_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) {
    return res.status(400).json({ error: `Transición no permitida: ${current} → ${target}` });
  }

  try {
    /* Actualización de estado y restauración de stock en UNA transacción
       atómica. Al cancelar se devuelven las cantidades al inventario. */
    const updated = await prisma.$transaction(async (tx) => {
      if (target === 'cancelado') {
        for (const item of order.items) {
          if (!item.productId) continue; // producto eliminado: se omite
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.qty } }
          });
        }
      }
      return tx.order.update({
        where: { id: order.id },
        data: { status: target },
        include: { items: true }
      });
    });

    res.json(serializeOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el estado del pedido' });
  }
}

async function listAttribution(req, res) {
  const attributions = await prisma.attribution.findMany({
    include: { user: true },
    orderBy: { date: 'desc' }
  });

  const byChannel = {};
  attributions.forEach((a) => {
    byChannel[a.channel] = (byChannel[a.channel] || 0) + 1;
  });

  res.json({
    channels: Object.entries(byChannel)
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count),
    detail: attributions.map((a) => ({
      id: a.id,
      userId: a.userId,
      userName: a.user ? a.user.name : '—',
      channel: a.channel,
      date: a.date
    }))
  });
}

module.exports = { listAllOrders, updateOrderStatus, listAttribution };