/* =========================================================
   CITY PETS — Generador de PNG válido >1 MB (G15, Fase 9.6)
   Construye un PNG real (firma + IHDR + IDAT zlib + IEND) con píxeles
   aleatorios para que el tamaño final supere 1 MB. Es una imagen que
   cualquier decodificador abre y que el endpoint /api/upload/image
   acepta inequívocamente (MIME real por firma de bytes).
   Uso: node scripts/gen-test-png.js /tmp/cp-proxy.png
   ========================================================= */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const W = 1024;
const H = 768;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const out = process.argv[2] || '/tmp/cp-test.png';
const dir = path.dirname(out);
if (dir !== '.') fs.mkdirSync(dir, { recursive: true });

const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // color type: truecolor RGB
ihdr[10] = 0;  // compresión
ihdr[11] = 0;  // filtro
ihdr[12] = 0;  // sin interlace

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const off = y * (1 + W * 3);
  raw[off] = 0; // filtro "none"
  crypto.randomBytes(W * 3).copy(raw, off + 1);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(out, png);

const size = fs.statSync(out).size;
console.log(`PNG generado: ${out} (${W}x${H}, ${size} bytes)`);
if (size < 1024 * 1024) {
  console.error('[ERROR] El PNG quedó menor a 1 MB');
  process.exit(1);
}