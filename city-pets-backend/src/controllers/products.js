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

module.exports = { listProducts };