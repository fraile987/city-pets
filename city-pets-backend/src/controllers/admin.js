/* =========================================================
   CITY PETS — Controladores de administración
   Todas estas rutas requieren authRequired + requireRole('admin').
   ========================================================= */

const prisma = require('../db');
const { ORDER_STATUSES, ORDER_TRANSITIONS } = require('../constants');
const { serializeOrder } = require('./orders');

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toDateOnly(s) {
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/* Rango del recaudo. Prioridad: from/to (validados); si no, period
   (diario | quincenal | mensual). Devuelve { from, to, label } o null. */
function revenueRange(period, from, to) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  if (from || to) {
    const f = toDateOnly(from);
    const t = toDateOnly(to);
    if (!f || !t || f > t) return null;
    return { from: startOfDay(f), to: endOfDay(t), label: `${from} → ${to}` };
  }

  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'diario') {
    return { from: startOfDay(now), to: endOfDay(now), label: 'Hoy' };
  }
  if (period === 'mensual') {
    return { from: new Date(y, m, 1), to: endOfDay(new Date(y, m + 1, 0)), label: 'Mes actual' };
  }
  if (period === 'quincenal') {
    const day = now.getDate();
    if (day <= 15) {
      return { from: new Date(y, m, 1), to: endOfDay(new Date(y, m, 15)), label: 'Quincena 1–15' };
    }
    return { from: new Date(y, m, 16), to: endOfDay(new Date(y, m + 1, 0)), label: 'Quincena 16–fin' };
  }
  return null;
}

/* Recaudo de pedidos ENTREGADOS dentro de un rango (fotografía).
   Criterio de fecha: deliveredAt cuando exista; si el pedido entregado es
   histórico (deliveredAt null), se usa createdAt como fallback. */
async function computeRevenue(range) {
  const orders = await prisma.order.findMany({
    where: {
      status: 'entregado',
      OR: [
        { deliveredAt: { gte: range.from, lte: range.to } },
        { deliveredAt: null, createdAt: { gte: range.from, lte: range.to } }
      ]
    }
  });
  let total = 0;
  let efectivo = 0;
  let digital = 0;
  orders.forEach((o) => {
    total += o.total;
    const pay = parseJson(o.payment, { method: 'digital' });
    if (pay.method === 'efectivo') efectivo += o.total;
    else digital += o.total;
  });
  return { total, efectivo, digital, cantidadPedidos: orders.length };
}

/* Recaudo dinámico por período (GET /api/admin/revenue). */
async function getRevenue(req, res) {
  const period = req.query.period;
  const range = revenueRange(period, req.query.from, req.query.to);
  if (!range) {
    return res.status(400).json({ error: 'Período inválido: usa period=diario|quincenal|mensual o from/to (YYYY-MM-DD)' });
  }

  const rev = await computeRevenue(range);

  res.json({
    ...rev,
    period: period || 'rango',
    from: fmtDay(range.from),
    to: fmtDay(range.to),
    periodLabel: range.label
  });
}

/* Cierre de caja persistente: snapshot del recaudo en un rango. */
async function createClosure(req, res) {
  const { period, from, to } = req.body || {};
  const range = revenueRange(period, from, to);
  if (!range) {
    return res.status(400).json({ error: 'Período inválido: usa period=diario|quincenal|mensual o from/to (YYYY-MM-DD)' });
  }
  const fromS = fmtDay(range.from);
  const toS = fmtDay(range.to);

  const existing = await prisma.storeClosure.findFirst({ where: { from: fromS, to: toS } });
  if (existing) {
    return res.status(409).json({ error: `Este período ya fue cerrado (${fromS} → ${toS})` });
  }

  const rev = await computeRevenue(range);

  try {
    const closure = await prisma.storeClosure.create({
      data: {
        adminId: req.user.id,
        period: period || 'rango',
        from: fromS,
        to: toS,
        total: rev.total,
        efectivo: rev.efectivo,
        digital: rev.digital,
        cantidadPedidos: rev.cantidadPedidos
      }
    });
    res.status(201).json({ ...closure, adminName: req.user.name });
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: `Este período ya fue cerrado (${fromS} → ${toS})` });
    }
    throw e;
  }
}

async function listClosures(req, res) {
  const closures = await prisma.storeClosure.findMany({
    include: { admin: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(closures.map((c) => ({
    id: c.id,
    adminId: c.adminId,
    adminName: c.admin ? c.admin.name : '—',
    period: c.period,
    from: c.from,
    to: c.to,
    total: c.total,
    efectivo: c.efectivo,
    digital: c.digital,
    cantidadPedidos: c.cantidadPedidos,
    createdAt: c.createdAt
  })));
}

/* ---------- Exportación CSV (P4/P5) ---------- */
function csvCell(v) {
  let s = String(v ?? '');
  /* Anti fórmula: evita que Excel/hojas interpreten celdas que empiecen
     con = + - @ como fórmula (CSV Formula Injection). */
  if (/^[=+\-@]/.test(s.trim())) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendCSV(res, filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send('\uFEFF' + csv);
}

const ORDER_STATUS_SEQ = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado', 'incidente'];

async function exportOrdersCSV(req, res) {
  const { q, from, to, status, sort } = req.query;

  const where = {};
  if (status && status !== 'todos') {
    if (!ORDER_STATUS_SEQ.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    where.status = status;
  }
  if (from || to) {
    if (!from || !to || !toDateOnly(from) || !toDateOnly(to) || from > to) {
      return res.status(400).json({ error: 'Rango de fechas inválido' });
    }
    where.createdAt = { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59.999') };
  }

  let list = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });

  if (q) {
    const needle = String(q).trim().toLowerCase();
    list = list.filter((o) =>
      (o.userName || '').toLowerCase().includes(needle) ||
      (o.phone || '').toLowerCase().includes(needle) ||
      (o.id || '').toLowerCase().includes(needle)
    );
  }
  if (sort === 'total') list = [...list].sort((a, b) => b.total - a.total);
  else if (sort === 'estado') list = [...list].sort((a, b) => ORDER_STATUS_SEQ.indexOf(a.status) - ORDER_STATUS_SEQ.indexOf(b.status));
  else list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const rows = [
    ['ID', 'Cliente', 'Teléfono', 'Fecha pedido', 'Fecha entrega', 'Estado', 'Subtotal', 'Domicilio', 'Total', 'Método de pago']
  ];
  list.forEach((o) => {
    const pay = parseJson(o.payment, { method: 'digital' });
    rows.push([
      o.id,
      o.userName,
      o.phone,
      o.createdAt.toISOString(),
      o.deliveredAt ? o.deliveredAt.toISOString() : '',
      o.status,
      o.subtotal,
      o.delivery,
      o.total,
      pay.method === 'efectivo' ? 'Efectivo' : 'Digital'
    ]);
  });
  sendCSV(res, 'citypets_pedidos.csv', rows);
}

async function exportClosuresCSV(req, res) {
  const closures = await prisma.storeClosure.findMany({
    include: { admin: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  });
  const rows = [
    ['ID', 'Fecha creación', 'Administrador', 'Período', 'Desde', 'Hasta', 'Total', 'Efectivo', 'Digital', 'Cantidad pedidos']
  ];
  closures.forEach((c) => {
    rows.push([
      c.id,
      c.createdAt.toISOString(),
      c.admin ? c.admin.name : '—',
      c.period,
      c.from,
      c.to,
      c.total,
      c.efectivo,
      c.digital,
      c.cantidadPedidos
    ]);
  });
  sendCSV(res, 'citypets_cierres.csv', rows);
}

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
       atómica. Al cancelar se devuelven las cantidades al inventario.
       Al entregar se registra la fecha real (deliveredAt), sin sobrescribir. */
    const updateData = { status: target };
    if (target === 'entregado' && !order.deliveredAt) {
      updateData.deliveredAt = new Date();
    }

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
        data: updateData,
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

module.exports = { listAllOrders, updateOrderStatus, listAttribution, getRevenue, createClosure, listClosures, exportOrdersCSV, exportClosuresCSV };