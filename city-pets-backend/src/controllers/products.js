/* =========================================================
   CITY PETS — Controladores de productos
   ========================================================= */

const prisma = require('../db');

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

async function createProduct(req, res) {
  const { name, species, category } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  if (!species || typeof species !== 'string' || !species.trim()) {
    return res.status(400).json({ error: 'La especie es obligatoria' });
  }

  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      species: species.trim(),
      category: typeof category === 'string' && category.trim() ? category.trim() : 'General',
      price: toNonNegInt(req.body.price),
      unit: typeof req.body.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : '1 und',
      grams: toNonNegInt(req.body.grams),
      stock: toNonNegInt(req.body.stock),
      desc: typeof req.body.desc === 'string' ? req.body.desc : '',
      dailyRation: toNonNegInt(req.body.dailyRation),
      tags: toJsonArray(req.body.tags),
      images: toJsonArray(req.body.images),
      video: typeof req.body.video === 'string' ? req.body.video : '',
      rating: isNaN(parseFloat(req.body.rating)) ? 4.0 : parseFloat(req.body.rating)
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
    data.name = name.trim();
  }
  if (species !== undefined) {
    if (typeof species !== 'string' || !species.trim()) {
      return res.status(400).json({ error: 'La especie no es válida' });
    }
    data.species = species.trim();
  }
  if (category !== undefined) data.category = typeof category === 'string' ? category.trim() : '';
  if (price !== undefined) data.price = toNonNegInt(price);
  if (unit !== undefined) data.unit = typeof unit === 'string' ? unit.trim() : '';
  if (grams !== undefined) data.grams = toNonNegInt(grams);
  if (stock !== undefined) data.stock = toNonNegInt(stock);
  if (desc !== undefined) data.desc = typeof desc === 'string' ? desc : '';
  if (dailyRation !== undefined) data.dailyRation = toNonNegInt(dailyRation);
  if (tags !== undefined) data.tags = toJsonArray(tags);
  if (images !== undefined) data.images = toJsonArray(images);
  if (video !== undefined) data.video = typeof video === 'string' ? video : '';
  if (rating !== undefined) data.rating = isNaN(parseFloat(rating)) ? 4.0 : parseFloat(rating);

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