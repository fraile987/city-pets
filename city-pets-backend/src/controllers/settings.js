/* =========================================================
   CITY PETS — Configuración global (domicilio)
   Una sola fila (id=1) en StoreSettings.
   La lógica de cálculo del domicilio vive aquí (compartida con
   la creación de pedidos) para no duplicar reglas.
   ========================================================= */

const prisma = require('../db');

const DEFAULTS = { deliveryCost: 10000, freeDeliveryFrom: 100000 };

async function getStoreSettings() {
  const s = await prisma.storeSettings.findUnique({ where: { id: 1 } });
  if (s) return { deliveryCost: s.deliveryCost, freeDeliveryFrom: s.freeDeliveryFrom };
  const created = await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 }
  });
  return { deliveryCost: created.deliveryCost, freeDeliveryFrom: created.freeDeliveryFrom };
}

/* Regla única de domicilio:
   - subtotal <= 0        -> 0
   - freeDeliveryFrom > 0 y subtotal >= freeDeliveryFrom -> 0 (gratis)
   - freeDeliveryFrom = 0 -> no hay promoción por monto: se cobra deliveryCost
   - caso contrario        -> deliveryCost */
function computeDelivery(subtotal, settings) {
  if (subtotal <= 0) return 0;
  const from = settings.freeDeliveryFrom;
  if (from > 0 && subtotal >= from) return 0;
  return settings.deliveryCost;
}

/* Acepta solo enteros >= 0 (número o string de dígitos). */
function parseNonNegInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v, 10);
  return null;
}

async function getSettings(req, res) {
  try {
    res.json(await getStoreSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
}

async function updateSettings(req, res) {
  const deliveryCost = parseNonNegInt(req.body && req.body.deliveryCost);
  const freeDeliveryFrom = parseNonNegInt(req.body && req.body.freeDeliveryFrom);
  if (deliveryCost === null) {
    return res.status(400).json({ error: 'deliveryCost debe ser un entero mayor o igual a 0' });
  }
  if (freeDeliveryFrom === null) {
    return res.status(400).json({ error: 'freeDeliveryFrom debe ser un entero mayor o igual a 0' });
  }

  try {
    const s = await prisma.storeSettings.upsert({
      where: { id: 1 },
      update: { deliveryCost, freeDeliveryFrom },
      create: { id: 1, deliveryCost, freeDeliveryFrom }
    });
    res.json({ deliveryCost: s.deliveryCost, freeDeliveryFrom: s.freeDeliveryFrom });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
}

module.exports = { getSettings, updateSettings, getStoreSettings, computeDelivery };