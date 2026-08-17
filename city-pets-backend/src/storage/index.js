/* =========================================================
   CITY PETS — Adaptador de almacenamiento de medios (Fase 9.5B)
   La aplicación guarda archivos en disco local por ahora, pero la
   interfaz (save) es la misma que usaría un adaptador de bucket
   (S3/R2/Supabase) en producción. admin.js y los controladores solo
   conocen URLs relativas (/uploads/products/<uuid>.<ext>), nunca Base64.
   ========================================================= */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/* Ubicación de los medios (Fase 9.6): configurable vía UPLOADS_PATH.
   En producción apuntará a un volumen fuera del código
   (p. ej. /var/lib/city-pets/uploads); en desarrollo el default actual. */
const UPLOADS_ROOT = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.resolve(__dirname, '../../uploads');
const CATEGORY = 'products';

/* MIME permitidos y extensión derivada (nunca la del nombre del cliente). */
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4'
};

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4']);

/* Detecta el MIME real por firma de bytes (no confía en la cabecera del cliente). */
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  const head = buf.toString('utf8', 0, 512).replace(/^\uFEFF/, '').trimStart();
  if (head[0] === '<' && /<svg[\s>/]/i.test(head)) return 'image/svg+xml';
  return null;
}

/* SVG puede contener scripts: solo se acepta si el contenido es seguro. */
function isSafeSvg(buf) {
  const s = buf.toString('utf8');
  if (/<script\b/i.test(s)) return false;
  if (/<foreignObject\b/i.test(s)) return false;
  if (/\son\w+\s*=/i.test(s)) return false;
  if (/javascript\s*:/i.test(s)) return false;
  return true;
}

async function save({ buffer, mime }) {
  const ext = EXT_BY_MIME[mime];
  if (!ext || !buffer) return null;
  const dir = path.join(UPLOADS_ROOT, CATEGORY);
  await fs.mkdir(dir, { recursive: true });
  const name = crypto.randomUUID() + ext;
  await fs.writeFile(path.join(dir, name), buffer);
  return `/uploads/${CATEGORY}/${name}`;
}

/* Convierte una URL relativa de /uploads en ruta absoluta con guarda de traversal. */
function absPath(relUrl) {
  if (typeof relUrl !== 'string' || !relUrl.startsWith('/uploads/')) return null;
  const abs = path.join(UPLOADS_ROOT, relUrl.replace(/^\/uploads\//, ''));
  if (!abs.startsWith(UPLOADS_ROOT + path.sep)) return null;
  return abs;
}

module.exports = { save, absPath, sniffMime, isSafeSvg, ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME, UPLOADS_ROOT };