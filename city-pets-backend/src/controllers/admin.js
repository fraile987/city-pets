/* =========================================================
   CITY PETS — Controladores de administración
   Todas estas rutas requieren authRequired + requireRole('admin').
   ========================================================= */

const prisma = require('../db');
const { ORDER_STATUSES } = require('../constants');
const { serializeOrder } = require('./orders');

async function listAllOrders(req, res) {
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders.map(serializeOrder));
}

async function updateOrderStatus(req, res) {
  const status = req.body && req.body.status;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido: usa pendiente, entregado o incidente' });
  }

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true }
  });
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status },
    include: { items: true }
  });
  res.json(serializeOrder(updated));
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