/* =========================================================
   CITY PETS — Configuración global (domicilio + comercial)
   Una sola fila (id=1) en StoreSettings.
   La lógica de cálculo del domicilio vive aquí (compartida con
   la creación de pedidos) para no duplicar reglas.
   ========================================================= */

const prisma = require('../db');
const logger = require('../logger');

const DEFAULTS = {
  deliveryCost: 10000,
  freeDeliveryFrom: 100000,
  whatsapp: '3001234567',
  daysOfWeek: 'Lun a Sáb',
  openingTime: '8:00 AM',
  closingTime: '8:00 PM'
};

const MAX_STRING = 80;

/* Valida una hora: HH:MM (24h, 0-23) o HH:MM AM/PM (12h, 1-12). */
function isValidTime(v) {
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (min > 59) return false;
  if (m[3]) return h >= 1 && h <= 12;
  return h <= 23;
}

/* Normaliza un número de WhatsApp: solo dígitos (elimina espacios, +, -,
   paréntesis y cualquier carácter de presentación). */
function normalizeWhatsapp(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

/* Bloquea HTML/scripts en campos de texto libre. */
function hasHtml(v) {
  return /[<>]/.test(v);
}

async function getStoreSettings() {
  const s = await prisma.storeSettings.findUnique({ where: { id: 1 } });
  if (s) {
    return {
      deliveryCost: s.deliveryCost,
      freeDeliveryFrom: s.freeDeliveryFrom,
      whatsapp: s.whatsapp,
      daysOfWeek: s.daysOfWeek,
      openingTime: s.openingTime,
      closingTime: s.closingTime
    };
  }
  const created = await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 }
  });
  return {
    deliveryCost: created.deliveryCost,
    freeDeliveryFrom: created.freeDeliveryFrom,
    whatsapp: created.whatsapp,
    daysOfWeek: created.daysOfWeek,
    openingTime: created.openingTime,
    closingTime: created.closingTime
  };
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
    logger.error("Settings: error", { err: e });
    res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
}

async function updateSettings(req, res) {
  const body = req.body || {};
  const data = {};

  /* delivery / umbral: enteros >= 0 (cuando se envían). */
  if (body.deliveryCost !== undefined) {
    const deliveryCost = parseNonNegInt(body.deliveryCost);
    if (deliveryCost === null) {
      return res.status(400).json({ error: 'deliveryCost debe ser un entero mayor o igual a 0' });
    }
    data.deliveryCost = deliveryCost;
  }
  if (body.freeDeliveryFrom !== undefined) {
    const freeDeliveryFrom = parseNonNegInt(body.freeDeliveryFrom);
    if (freeDeliveryFrom === null) {
      return res.status(400).json({ error: 'freeDeliveryFrom debe ser un entero mayor o igual a 0' });
    }
    data.freeDeliveryFrom = freeDeliveryFrom;
  }

  /* WhatsApp: obligatorio si se envía; se normaliza a dígitos (7-15). */
  if (body.whatsapp !== undefined) {
    if (typeof body.whatsapp !== 'string' || body.whatsapp.trim() === '') {
      return res.status(400).json({ error: 'El WhatsApp no puede estar vacío' });
    }
    const digits = normalizeWhatsapp(body.whatsapp);
    if (digits.length < 7 || digits.length > 15) {
      return res.status(400).json({ error: 'WhatsApp inválido: usa un número de 7 a 15 dígitos' });
    }
    data.whatsapp = digits;
  }

  /* Días de atención: texto libre seguro (sin HTML), longitud razonable. */
  if (body.daysOfWeek !== undefined) {
    if (typeof body.daysOfWeek !== 'string' || body.daysOfWeek.trim() === '') {
      return res.status(400).json({ error: 'Los días de atención no pueden estar vacíos' });
    }
    if (hasHtml(body.daysOfWeek)) {
      return res.status(400).json({ error: 'Los días de atención no pueden contener HTML' });
    }
    if (body.daysOfWeek.trim().length > MAX_STRING) {
      return res.status(400).json({ error: `Los días de atención no pueden superar ${MAX_STRING} caracteres` });
    }
    data.daysOfWeek = body.daysOfWeek.trim();
  }

  /* Horas de apertura/cierre: formato HH:MM (con AM/PM opcional). */
  for (const [key, label] of [['openingTime', 'apertura'], ['closingTime', 'cierre']]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || body[key].trim() === '') {
        return res.status(400).json({ error: `La hora de ${label} no puede estar vacía` });
      }
      if (hasHtml(body[key])) {
        return res.status(400).json({ error: `La hora de ${label} no puede contener HTML` });
      }
      if (!isValidTime(body[key]) || body[key].trim().length > 20) {
        return res.status(400).json({ error: `La hora de ${label} es inválida (usa formato HH:MM o HH:MM AM/PM)` });
      }
      data[key] = body[key].trim();
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No hay campos de configuración para guardar' });
  }

  try {
    const s = await prisma.storeSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...DEFAULTS, ...data }
    });
    res.json({
      deliveryCost: s.deliveryCost,
      freeDeliveryFrom: s.freeDeliveryFrom,
      whatsapp: s.whatsapp,
      daysOfWeek: s.daysOfWeek,
      openingTime: s.openingTime,
      closingTime: s.closingTime
    });
  } catch (e) {
    logger.error("Settings: error", { err: e });
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
}

module.exports = { getSettings, updateSettings, getStoreSettings, computeDelivery, normalizeWhatsapp };