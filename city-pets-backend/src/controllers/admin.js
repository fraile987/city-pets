/* =========================================================
   CITY PETS — Controladores de administración
   Todas estas rutas requieren authRequired + requireRole('admin').
   ========================================================= */

const prisma = require('../db');
const { Prisma } = require('@prisma/client');
const logger = require('../logger');
const { ORDER_STATUSES, ORDER_TRANSITIONS } = require('../constants');
const ExcelJS = require('exceljs');
const { serializeOrder } = require('./orders');

/* Indica que el estado leído quedó obsoleto por un cambio concurrente. */
class OrderStateConflictError extends Error {}

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

/* Filtro de exportación de pedidos (CSV y Excel): mismas reglas que
   listAllOrders/exportOrdersCSV. Devuelve { where } o { error }. */
function orderExportWhere(query) {
  const { from, to, status } = query;
  const where = {};
  if (status && status !== 'todos') {
    if (!ORDER_STATUS_SEQ.includes(status)) {
      return { error: 'Estado inválido' };
    }
    where.status = status;
  }
  if (from || to) {
    if (!from || !to || !toDateOnly(from) || !toDateOnly(to) || from > to) {
      return { error: 'Rango de fechas inválido' };
    }
    where.createdAt = { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59.999') };
  }
  return { where };
}

/* Lista filtrada y ordenada de pedidos para exportación (misma lógica que CSV). */
async function orderExportList(where, q, sort) {
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
  return list;
}

function orderExportRows(list) {
  return list.map((o) => {
    const pay = parseJson(o.payment, { method: 'digital' });
    return {
      id: o.id,
      cliente: o.userName,
      telefono: o.phone,
      fechaPedido: o.createdAt.toISOString(),
      fechaEntrega: o.deliveredAt ? o.deliveredAt.toISOString() : '',
      estado: o.status,
      subtotal: o.subtotal,
      domicilio: o.delivery,
      total: o.total,
      pago: pay.method === 'efectivo' ? 'Efectivo' : 'Digital'
    };
  });
}

/* Resumen coherente con el conjunto filtrado (Fase B):
   - status = todos (o ausente) -> "Total vendido" = suma SOLO de entregados.
   - status = entregado      -> "Total vendido" = suma de la lista (todos entregados).
   - otro estado específico  -> "Total del filtro" = suma de la lista filtrada. */
function orderExportSummary(list, status, from, to) {
  const delivered = list.filter((o) => o.status === 'entregado');
  const cancelled = list.filter((o) => o.status === 'cancelado');
  const isTodos = !status || status === 'todos';
  const soldSet = isTodos || status === 'entregado' ? delivered : list;
  const totalLabel = isTodos || status === 'entregado' ? 'Total vendido' : 'Total del filtro';

  const sum = soldSet.reduce((acc, o) => {
    acc.total += o.total;
    const pay = parseJson(o.payment, { method: 'digital' });
    if (pay.method === 'efectivo') acc.efectivo += o.total;
    else acc.digital += o.total;
    return acc;
  }, { total: 0, efectivo: 0, digital: 0 });

  const period = from && to ? `${from} a ${to}` : from || to || 'Todo el historial';
  return {
    period: period + (status && status !== 'todos' ? ` · Estado: ${status}` : ''),
    pedidos: list.length,
    entregados: delivered.length,
    cancelados: cancelled.length,
    totalLabel,
    total: sum.total,
    efectivo: sum.efectivo,
    digital: sum.digital
  };
}

async function exportOrdersCSV(req, res) {
  const { q, from, to, status, sort } = req.query;
  const w = orderExportWhere(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  const list = await orderExportList(w.where, q, sort);

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

/* Informe de ventas en Excel (.xlsx): Hoja "Pedidos" + Hoja "Resumen".
   Usa EXACTAMENTE los mismos filtros y reglas de seguridad que el CSV. */
async function exportOrdersXLSX(req, res) {
  const { q, from, to, status, sort } = req.query;
  const w = orderExportWhere(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  const list = await orderExportList(w.where, q, sort);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'City Pets';

  const ws1 = wb.addWorksheet('Pedidos');
  ws1.columns = [
    { header: 'ID', key: 'id', width: 26 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'Teléfono', key: 'telefono', width: 18 },
    { header: 'Fecha pedido', key: 'fechaPedido', width: 24 },
    { header: 'Fecha entrega', key: 'fechaEntrega', width: 24 },
    { header: 'Estado', key: 'estado', width: 14 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Domicilio', key: 'domicilio', width: 12 },
    { header: 'Total', key: 'total', width: 14 },
    { header: 'Método de pago', key: 'pago', width: 14 }
  ];
  ws1.getRow(1).font = { bold: true };
  orderExportRows(list).forEach((r) => ws1.addRow(r));

  const summary = orderExportSummary(list, status, from, to);
  const ws2 = wb.addWorksheet('Resumen');
  ws2.columns = [
    { header: 'Indicador', key: 'k', width: 34 },
    { header: 'Valor', key: 'v', width: 24 }
  ];
  ws2.getRow(1).font = { bold: true };
  [
    ['Período', summary.period],
    ['Pedidos totales', summary.pedidos],
    ['Entregados', summary.entregados],
    ['Cancelados', summary.cancelados],
    [summary.totalLabel, summary.total],
    ['Total efectivo', summary.efectivo],
    ['Total digital', summary.digital]
  ].forEach(([k, v]) => ws2.addRow({ k, v }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="citypets_pedidos.xlsx"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const buf = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buf));
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
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const from = req.query.from;
  const to = req.query.to;
  const status = req.query.status;
  const sort = req.query.sort || 'fecha';
  const page = req.query.page === undefined ? 1 : parseInt(req.query.page, 10);
  const limit = req.query.limit === undefined ? 25 : parseInt(req.query.limit, 10);

  if (Number.isNaN(page) || page < 1 || Number.isNaN(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'page (>=1) o limit (1-100) inválidos' });
  }

  if (status && status !== 'todos' && !ORDER_STATUS_SEQ.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  if (!['fecha', 'total', 'estado'].includes(sort)) {
    return res.status(400).json({ error: 'Ordenamiento inválido' });
  }
  if ((from && !to) || (to && !from) || (from && (!toDateOnly(from) || !toDateOnly(to) || from > to))) {
    return res.status(400).json({ error: 'Rango de fechas inválido' });
  }

  /* Base: búsqueda + rango createdAt (para contadores byStatus y totalVal). */
  const whereBase = {};
  if (q) {
    whereBase.OR = [
      { userName: { contains: q } },
      { phone: { contains: q } },
      { id: { contains: q } }
    ];
  }
  if (from || to) {
    whereBase.createdAt = { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59.999') };
  }
  /* Con el filtro de pestaña (estado) para el paginado real. */
  const whereStatus = { ...whereBase };
  if (status && status !== 'todos') whereStatus.status = status;

  const offset = (page - 1) * limit;
  let items;

  if (sort === 'estado') {
    /* Orden por flujo de negocio resuelto 100% en SQL antes de paginar,
       con desempate estable (createdAt DESC, id DESC). */
    const conds = [];
    if (status && status !== 'todos') conds.push(Prisma.sql`"status" = ${status}`);
    if (from || to) {
      conds.push(Prisma.sql`"createdAt" >= ${new Date(from + 'T00:00:00')}`);
      conds.push(Prisma.sql`"createdAt" <= ${new Date(to + 'T23:59:59.999')}`);
    }
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      conds.push(Prisma.sql`(LOWER("userName") LIKE ${like} OR LOWER("phone") LIKE ${like} OR LOWER("id") LIKE ${like})`);
    }
    const whereSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Order"
      ${whereSql}
      ORDER BY CASE "status"
        WHEN 'pendiente' THEN 0 WHEN 'confirmado' THEN 1
        WHEN 'enviado' THEN 2 WHEN 'entregado' THEN 3
        WHEN 'cancelado' THEN 4 ELSE 5 END,
        "createdAt" DESC, "id" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const fetched = await prisma.order.findMany({ where: { id: { in: ids } }, include: { items: true } });
      const byId = new Map(fetched.map((o) => [o.id, o]));
      items = ids.map((id) => byId.get(id)).filter(Boolean);
    } else {
      items = [];
    }
  } else {
    const orderBy = sort === 'total'
      ? [{ total: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
    items = await prisma.order.findMany({
      where: whereStatus,
      orderBy,
      skip: offset,
      take: limit,
      include: { items: true }
    });
  }

  const [total, totalAgg, byStatusRows] = await Promise.all([
    prisma.order.count({ where: whereStatus }),
    prisma.order.aggregate({ where: whereBase, _sum: { total: true } }),
    prisma.order.groupBy({ by: ['status'], where: whereBase, _count: true })
  ]);

  const byStatus = { pendiente: 0, confirmado: 0, enviado: 0, entregado: 0, cancelado: 0, incidente: 0 };
  byStatusRows.forEach((r) => { if (byStatus[r.status] !== undefined) byStatus[r.status] = r._count; });

  res.json({
    items: items.map(serializeOrder),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    totalVal: totalAgg._sum.total || 0,
    byStatus
  });
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
       atómica, con actualización condicional (CAS): la transición solo se
       aplica si el pedido sigue en el estado leído. Si otro proceso lo
       cambió de forma concurrente, la transacción se aborta sin efectos. */
    const updateData = { status: target };
    if (target === 'entregado' && !order.deliveredAt) {
      updateData.deliveredAt = new Date();
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cas = await tx.order.updateMany({
        where: { id: order.id, status: current },
        data: updateData
      });
      if (cas.count !== 1) {
        throw new OrderStateConflictError();
      }

      /* Solo tras asegurar la transición se restaura el stock (si cancela). */
      if (target === 'cancelado') {
        for (const item of order.items) {
          if (!item.productId) continue; // producto eliminado: se omite
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.qty } }
          });
        }
      }

      return tx.order.findUnique({
        where: { id: order.id },
        include: { items: true }
      });
    });

    res.json(serializeOrder(updated));
  } catch (e) {
    if (e instanceof OrderStateConflictError) {
      return res.status(409).json({ error: 'El pedido cambió de estado en otro proceso; vuelve a cargar e intenta de nuevo' });
    }
    logger.error("Actualizar estado del pedido: error", { err: e });
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

module.exports = { listAllOrders, updateOrderStatus, listAttribution, getRevenue, createClosure, listClosures, exportOrdersCSV, exportOrdersXLSX, exportClosuresCSV };