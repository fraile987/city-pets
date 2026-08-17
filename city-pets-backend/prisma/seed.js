/* =========================================================
   CITY PETS — Seed de productos (Fase 4.2)
   Carga los 14 productos en SQLite usando upsert para que
   pueda ejecutarse de nuevo sin duplicar.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { SEED_PRODUCTS } = require('./seed-data');
const { UPLOADS_ROOT } = require('../src/storage');

const prisma = new PrismaClient();
const CATALOG_SRC = path.resolve(__dirname, '../assets/catalog');

async function seedProducts() {
  for (const p of SEED_PRODUCTS) {
    const data = {
      name: p.name,
      species: p.species,
      category: p.category,
      price: p.price,
      unit: p.unit,
      grams: p.grams,
      stock: p.stock,
      desc: p.desc,
      dailyRation: p.dailyRation,
      tags: JSON.stringify(p.tags),
      images: JSON.stringify(p.images),
      video: p.video,
      rating: p.rating
    };
    await prisma.product.upsert({
      where: { id: p.id },
      update: data,
      create: { id: p.id, ...data }
    });
  }
}

/* Fase B1/B2: copia las imágenes locales del catálogo a
   UPLOADS_ROOT/products/ (idempotente, por hash) y los productos las
   referencian como /uploads/products/p<id>.jpg (sin URLs externas). */
async function ensureCatalogMedia() {
  const destDir = path.join(UPLOADS_ROOT, 'products');
  await fs.promises.mkdir(destDir, { recursive: true });

  const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  let copied = 0;

  for (const name of fs.readdirSync(CATALOG_SRC).sort()) {
    if (!/^p\d+\.(jpg|jpeg|png|webp)$/.test(name)) continue;
    const src = path.join(CATALOG_SRC, name);
    const dst = path.join(destDir, name);
    let needsCopy = true;
    try {
      needsCopy = hashOf(await fs.promises.readFile(dst)) !== hashOf(await fs.promises.readFile(src));
    } catch { /* no existe: copiar */ }
    if (needsCopy) {
      await fs.promises.copyFile(src, dst);
      copied++;
    }
  }
  if (copied) console.log(`Catálogo local: ${copied} imagen(es) copiadas a ${destDir}.`);
}

async function main() {
  await ensureCatalogMedia();
  await seedProducts();
  const count = await prisma.product.count();
  console.log(`Seed completado: ${count} productos en la base de datos.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());