/* =========================================================
   CITY PETS — Controladores de productos
   ========================================================= */

const prisma = require('../db');
const { MAX } = require('../constants');

/* En la BD, tags e images se guardan serializados a JSON (String).
   Aquí se restauran a su forma original de array. */
function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* Conserva el orden del catálogo (p1..p14) usando el número del id. */
function byCatalogOrder(a, b) {
  return Number(a.id.replace(/\D/g, '')) - Number(b.id.replace(/\D/g, ''));
}

async function listProducts(req, res) {
  const products = await prisma.product.findMany();
  res.json(
    products
      .map((p) => ({
        ...p,
        tags: parseJson(p.tags, []),
        images: parseJson(p.images, [])
      }))
      .sort(byCatalogOrder)
  );
}

/* ---- Utilidades de validación para el CRUD (solo admin) ---- */
function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : fallback;
}

function toNonNegInt(v, fallback = 0) {
  const n = toInt(v, fallback);
  return n >= 0 ? n : fallback;
}

function toJsonArray(v, fallback = []) {
  return Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(fallback);
}

/* Corta un string a la longitud máxima permitida. */
function cap(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/* ---- Medios (Fase 9.5B) ----
   Solo se aceptan URLs (rutas /uploads/ o http(s)), nunca Base64/data:.
   El adaptador de almacenamiento genera las rutas del catálogo local. */
function isMediaUrl(v) {
  return typeof v === 'string' && (v.startsWith('/uploads/') || /^https?:\/\//i.test(v));
}

function sanitizeImages(images) {
  if (!Array.isArray(images)) return undefined;
  return images.filter(isMediaUrl).slice(0, 5);
}

function sanitizeVideo(video) {
  if (video === undefined) return undefined;
  if (video === '') return '';
  return isMediaUrl(video) ? video : '';
}

function validateProductFields(body) {
  const { name, species, category } = body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'El nombre es obligatorio';
  }
  if (name.trim().length > MAX.name) {
    return `El nombre no puede superar ${MAX.name} caracteres`;
  }
  if (!species || typeof species !== 'string' || !species.trim()) {
    return 'La especie es obligatoria';
  }
  if (species.trim().length > MAX.species) {
    return `La especie no puede superar ${MAX.species} caracteres`;
  }
  if (category !== undefined && typeof category === 'string' && category.trim().length > MAX.category) {
    return `La categoría no puede superar ${MAX.category} caracteres`;
  }
  return null;
}

async function createProduct(req, res) {
  const err = validateProductFields(req.body);
  if (err) return res.status(400).json({ error: err });

  const product = await prisma.product.create({
    data: {
      name: req.body.name.trim(),
      species: req.body.species.trim(),
      category: cap(req.body.category, MAX.category) || 'General',
      price: Math.min(toNonNegInt(req.body.price), 100000000),
      unit: cap(req.body.unit, MAX.unit) || '1 und',
      grams: Math.min(toNonNegInt(req.body.grams), 1000000),
      stock: Math.min(toNonNegInt(req.body.stock), 1000000),
      desc: cap(req.body.desc, MAX.desc),
      dailyRation: Math.min(toNonNegInt(req.body.dailyRation), 100000),
      tags: toJsonArray(req.body.tags),
      images: toJsonArray(sanitizeImages(req.body.images) || []),
      video: sanitizeVideo(req.body.video) || '',
      rating: isNaN(parseFloat(req.body.rating)) ? 4.0 : Math.min(Math.max(parseFloat(req.body.rating), 0), 5)
    }
  });

  res.status(201).json({
    ...product,
    tags: parseJson(product.tags, []),
    images: parseJson(product.images, [])
  });
}

async function updateProduct(req, res) {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  const { name, species, category, price, unit, grams, stock, desc, dailyRation, tags, images, video, rating } = req.body;
  const data = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'El nombre no es válido' });
    }
    if (name.trim().length > MAX.name) {
      return res.status(400).json({ error: `El nombre no puede superar ${MAX.name} caracteres` });
    }
    data.name = name.trim();
  }
  if (species !== undefined) {
    if (typeof species !== 'string' || !species.trim()) {
      return res.status(400).json({ error: 'La especie no es válida' });
    }
    if (species.trim().length > MAX.species) {
      return res.status(400).json({ error: `La especie no puede superar ${MAX.species} caracteres` });
    }
    data.species = species.trim();
  }
  if (category !== undefined) data.category = cap(category, MAX.category);
  if (price !== undefined) data.price = Math.min(toNonNegInt(price), 100000000);
  if (unit !== undefined) data.unit = cap(unit, MAX.unit);
  if (grams !== undefined) data.grams = Math.min(toNonNegInt(grams), 1000000);
  if (stock !== undefined) data.stock = Math.min(toNonNegInt(stock), 1000000);
  if (desc !== undefined) data.desc = cap(desc, MAX.desc);
  if (dailyRation !== undefined) data.dailyRation = Math.min(toNonNegInt(dailyRation), 100000);
  if (tags !== undefined) data.tags = toJsonArray(tags);
  if (images !== undefined) data.images = toJsonArray(sanitizeImages(images) || []);
  if (video !== undefined) data.video = sanitizeVideo(video);
  if (rating !== undefined) data.rating = isNaN(parseFloat(rating)) ? 4.0 : Math.min(Math.max(parseFloat(rating), 0), 5);

  const product = await prisma.product.update({ where: { id: existing.id }, data });
  res.json({
    ...product,
    tags: parseJson(product.tags, []),
    images: parseJson(product.images, [])
  });
}

async function deleteProduct(req, res) {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  /* Los OrderItem conservan el histórico: productId se pone NULL (ON DELETE SET NULL). */
  await prisma.product.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}

module.exports = { listProducts, createProduct, updateProduct, deleteProduct };