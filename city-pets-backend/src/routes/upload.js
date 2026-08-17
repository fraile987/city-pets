/* =========================================================
   CITY PETS — Subida de medios (Fase 9.5B)
   Solo admin. Multipart (multer), nunca Base64 en el JSON.
   - Imágenes: JPEG/PNG/WebP/SVG seguro, máx 5 MB.
   - Videos: MP4, máx 25 MB.
   Devuelve la URL relativa (/uploads/products/<uuid>.<ext>).
   ========================================================= */

const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const storage = require('../storage');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

const IMAGE_MAX = 5 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_MAX } });
const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX } });

async function accept(req, res, allowedSet, kind, label) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: `Envía un archivo en el campo "file"` });
  }
  const mime = storage.sniffMime(req.file.buffer);
  if (!mime || !allowedSet.has(mime) || (mime === 'image/svg+xml' && !storage.isSafeSvg(req.file.buffer))) {
    return res.status(400).json({ error: label });
  }
  const url = await storage.save({ buffer: req.file.buffer, mime });
  if (!url) return res.status(400).json({ error: label });
  res.status(201).json({ url });
}

router.post('/image', imageUpload.single('file'), (req, res) => {
  accept(req, res, storage.ALLOWED_IMAGE_MIME, 'image', 'Imagen no permitida: usa JPEG, PNG o WebP (máx 5 MB)')
    .catch(() => res.status(400).json({ error: 'Imagen inválida' }));
});

router.post('/video', videoUpload.single('file'), (req, res) => {
  accept(req, res, storage.ALLOWED_VIDEO_MIME, 'video', 'Solo se permiten videos MP4 (máx 25 MB)')
    .catch(() => res.status(400).json({ error: 'Video inválido' }));
});

module.exports = router;