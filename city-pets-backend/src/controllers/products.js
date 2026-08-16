/* =========================================================
   CITY PETS — Controladores de productos
   ========================================================= */

const prisma = require('../db');

async function listProducts(req, res) {
  const products = await prisma.product.findMany();
  res.json(products);
}

module.exports = { listProducts };