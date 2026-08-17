/* =========================================================
   CITY PETS — Migración de medios (Fase 9.5B)
   Convierte imágenes/videos guardados como data: URI (Base64) en
   archivos reales en /uploads y actualiza la BD con la URL relativa.
   Uso: node scripts/migrate-media.js
   Idempotente: las URLs /uploads y https ya se dejan igual.
   ========================================================= */

const prisma = require('../src/db');
const storage = require('../src/storage');

function parseArray(v) {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function parseDataUri(uri) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  try { return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }; }
  catch { return null; }
}

async function migrate() {
  const products = await prisma.product.findMany();
  let changed = 0;

  for (const p of products) {
    const images = parseArray(p.images);
    const newImages = [];
    let dirty = false;

    for (const img of images) {
      if (typeof img === 'string' && img.startsWith('data:')) {
        const d = parseDataUri(img);
        const mime = d && storage.sniffMime(d.buffer);
        if (mime && (mime !== 'image/svg+xml' || storage.isSafeSvg(d.buffer))) {
          const url = await storage.save({ buffer: d.buffer, mime });
          newImages.push(url); dirty = true;
        } else {
          newImages.push(img);
        }
      } else {
        newImages.push(img);
      }
    }

    let video = p.video || '';
    if (video.startsWith('data:')) {
      const d = parseDataUri(video);
      const mime = d && storage.sniffMime(d.buffer);
      if (mime) {
        video = await storage.save({ buffer: d.buffer, mime });
        dirty = true;
      } else {
        video = ''; // data URI inválido/truncado: se descarta
        dirty = true;
      }
    }

    if (dirty) {
      await prisma.product.update({ where: { id: p.id }, data: { images: JSON.stringify(newImages), video } });
      changed++;
      console.log(`  ${p.id}: ${p.name}`);
    }
  }

  console.log(`Migración completada: ${changed} producto(s) actualizado(s) a /uploads.`);
}

migrate()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());