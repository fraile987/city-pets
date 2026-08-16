/* =========================================================
   CITY PETS — Seed de productos (Fase 4.2)
   Carga los 14 productos en SQLite usando upsert para que
   pueda ejecutarse de nuevo sin duplicar.
   ========================================================= */

const { PrismaClient } = require('@prisma/client');
const { SEED_PRODUCTS } = require('./seed-data');

const prisma = new PrismaClient();

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

async function main() {
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