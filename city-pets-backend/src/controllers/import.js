/* =========================================================
   CITY PETS — Importación masiva desde Excel (Fase 2)
   Flujo organizado:
     1. GET  /api/admin/import/template  -> plantilla .xlsx con columnas
        en celdas separadas (una por columna).
     2. POST /api/admin/import/preview    -> sube el .xlsx, lo parsea,
        valida FILA POR FILA y devuelve la vista previa (sin tocar la BD).
     3. POST /api/admin/import/commit     -> importa SOLO las filas válidas
        de la vista previa confirmada (importId), nunca datos del cliente.
   ========================================================= */

const ExcelJS = require('exceljs');
const crypto = require('crypto');
const prisma = require('../db');
const { MAX } = require('../constants');
const logger = require('../logger');

/* ---------- Definición de columnas de la plantilla ---------- */
const COLUMNS = [
  { key: 'name',       aliases: ['nombre', 'name', 'producto', 'product'], label: 'Nombre del producto', type: 'string', required: true,  max: MAX.name },
  { key: 'species',    aliases: ['especie', 'species'], label: 'Especie', type: 'species', required: true },
  { key: 'category',   aliases: ['categoria', 'category'], label: 'Categoría', type: 'string', fallback: 'General', max: MAX.category },
  { key: 'price',      aliases: ['precio', 'price'], label: 'Precio ($)', type: 'int', required: true, max: 100000000 },
  { key: 'unit',       aliases: ['unidad', 'unit'], label: 'Unidad', type: 'string', fallback: '1 und', max: MAX.unit },
  { key: 'grams',      aliases: ['gramos', 'grams'], label: 'Gramos', type: 'int', fallback: 0, max: 1000000 },
  { key: 'stock',      aliases: ['stock'], label: 'Stock', type: 'int', fallback: 0, max: 1000000 },
  { key: 'desc',       aliases: ['descripcion', 'desc'], label: 'Descripción', type: 'string', fallback: '', max: MAX.desc },
  { key: 'dailyRation', aliases: ['raciondiaria', 'racion diaria', 'dailyration', 'daily ration'], label: 'Ración diaria (g)', type: 'int', fallback: 0, max: 100000 },
  { key: 'tags',       aliases: ['tags', 'etiquetas'], label: 'Tags (separadas por ;)', type: 'tags', fallback: [] }
];

const SPECIES_ALLOWED = ['Perros', 'Gatos', 'General'];

const MAX_ROWS = 1000;
const PREVIEW_TTL = 15 * 60 * 1000; // 15 minutos

/* ---------- Almacén temporal de vistas previas (en memoria) ----------
   El commit usa el importId para importar EXACTAMENTE lo que el admin
   revisó en la vista previa. Nunca se confía en datos reenviados. */
const previews = new Map();

function storePreview(rows) {
  const id = crypto.randomUUID();
  previews.set(id, { rows, createdAt: Date.now() });
  return id;
}

function consumePreview(id) {
  const entry = previews.get(id);
  if (!entry) return null;
  previews.delete(id);
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of previews) {
    if (now - entry.createdAt > PREVIEW_TTL) previews.delete(id);
  }
}, PREVIEW_TTL).unref();

/* ---------- Utilidades de conversión ---------- */

/* Normaliza el encabezado: minúsculas, sin acentos, solo alfanumérico.
   Los paréntesis son solo pistas visuales ("Precio ($)", "Ración (g)")
   y se descartan para poder comparar con las columnas. */
function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/* Extrae el texto visible de una celda de Excel (admite richText). */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (typeof v.text === 'string') return v.text;
    return '';
  }
  return String(v);
}

/* Convierte un valor de celda a entero, tolerando formato colombiano:
   "$185.000", "185000", "1.234.567", "98.500,5". Devuelve null si no es
   un número válido. */
function toIntLenient(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  } else {
    s = s.replace(/\.(?=\d{3}(\.\d{3})*(\D|$))/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -Math.round(n) : Math.round(n)) : null;
}

function splitTags(v) {
  return String(v || '')
    .split(/[;,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/* ---------- Validación FILA POR FILA ----------
   Devuelve { data, errors }. errors contiene TODOS los problemas de la
   fila (no solo el primero) para que la vista previa sea completa. */
function validateRow(raw) {
  const errors = [];
  const text = (k) => (raw[k] === undefined || raw[k] === null) ? '' : cellText(raw[k]).trim();
  const data = {};

  /* name */
  const name = text('name');
  if (!name) errors.push('El nombre es obligatorio');
  else if (name.length > MAX.name) errors.push(`El nombre no puede superar ${MAX.name} caracteres`);
  data.name = name.slice(0, MAX.name);

  /* species */
  const speciesRaw = text('species');
  const speciesNorm = normalizeHeader(speciesRaw);
  const species = SPECIES_ALLOWED.find((s) => normalizeHeader(s) === speciesNorm);
  if (!species) errors.push(`La especie debe ser: ${SPECIES_ALLOWED.join(', ')}`);
  data.species = species || speciesRaw.slice(0, MAX.species);

  /* category */
  const category = text('category');
  if (category.length > MAX.category) errors.push(`La categoría no puede superar ${MAX.category} caracteres`);
  data.category = (category || 'General').slice(0, MAX.category);

  /* price */
  const priceRaw = text('price');
  const price = toIntLenient(priceRaw);
  if (!priceRaw) errors.push('El precio es obligatorio');
  else if (price === null) errors.push('El precio debe ser un número');
  else if (price < 0) errors.push('El precio no puede ser negativo');
  else if (price > 100000000) errors.push('El precio supera el máximo permitido');
  data.price = price === null ? 0 : Math.min(price, 100000000);

  /* unit */
  const unit = text('unit');
  if (unit.length > MAX.unit) errors.push(`La unidad no puede superar ${MAX.unit} caracteres`);
  data.unit = (unit || '1 und').slice(0, MAX.unit);

  /* grams / stock / dailyRation (enteros opcionales) */
  for (const key of ['grams', 'stock', 'dailyRation']) {
    const rawV = text(key);
    const col = COLUMNS.find((c) => c.key === key);
    let val = col.fallback;
    if (rawV !== '') {
      const n = toIntLenient(rawV);
      if (n === null) {
        errors.push(parseIntLabel(key) + ' debe ser un número');
      } else if (n < 0) {
        errors.push(parseIntLabel(key) + ' no puede ser negativo');
      } else if (n > col.max) {
        errors.push(parseIntLabel(key) + ' supera el máximo permitido');
      } else {
        val = n;
      }
    }
    data[key] = val;
  }

  /* desc */
  data.desc = text('desc').slice(0, MAX.desc);

  /* tags */
  data.tags = splitTags(text('tags'));

  return { data, errors };
}

function parseIntLabel(key) {
  return { grams: 'Gramos', stock: 'Stock', dailyRation: 'La ración diaria' }[key] || key;
}

/* ---------- Parseo del libro ---------- */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no contiene hojas de cálculo');

  const sheetRows = [];
  ws.eachRow({ includeEmpty: false }, (row) => sheetRows.push(row));
  if (sheetRows.length === 0) throw new Error('El archivo está vacío');

  /* Encabezados: se aceptan nombres en español o en inglés (alias). */
  const colMap = {}; // colNumber -> key
  const headerRow = sheetRows[0];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const h = normalizeHeader(cellText(cell.value));
    if (!h) return;
    const col = COLUMNS.find(
      (c) => normalizeHeader(c.label) === h || c.aliases.some((a) => normalizeHeader(a) === h)
    );
    if (col) colMap[colNumber] = col.key;
  });

  const knownKeys = Object.values(colMap);
  const missing = COLUMNS.filter((c) => c.required).filter((c) => !knownKeys.includes(c.key));
  if (missing.length) {
    throw new Error('Faltan columnas obligatorias en la plantilla: ' + missing.map((c) => c.label).join(', '));
  }

  const rows = [];
  sheetRows.slice(1).forEach((row, i) => {
    if (rows.length >= MAX_ROWS) return;
    const raw = {};
    for (const [colNumber, key] of Object.entries(colMap)) {
      raw[key] = row.getCell(Number(colNumber)).value;
    }
    const isBlank = Object.keys(raw).every((k) => {
      const v = raw[k];
      return v === null || v === undefined || cellText(v).trim() === '';
    });
    if (isBlank) return;
    rows.push({ row: i + 2, raw });
  });

  if (rows.length === 0) throw new Error('El archivo no tiene filas con datos');
  if (rows.length > MAX_ROWS) throw new Error(`El archivo supera el máximo de ${MAX_ROWS} filas`);

  return rows;
}

/* ---------- Generación de la plantilla .xlsx ---------- */
async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'City Pets';
  wb.created = new Date();

  const ws = wb.addWorksheet('Inventario');
  ws.columns = COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.key === 'desc' ? 45 : 20 }));

  const headerCell = ws.getRow(1);
  headerCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } };
  headerCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;

  ws.addRow({
    name: 'Alimento Perro Adulto 8 kg (ejemplo)',
    species: 'Perros',
    category: 'Alimento',
    price: 98000,
    unit: '8 kg',
    grams: 8000,
    stock: 30,
    desc: 'Reemplaza esta fila de ejemplo con tus productos o bórrala antes de subir.',
    dailyRation: 140,
    tags: 'top'
  });
  ws.addRow({
    name: 'Arena Sanitaria 5 kg (ejemplo)',
    species: 'Gatos',
    category: 'Higiene',
    price: 22000,
    unit: '5 kg',
    grams: 0,
    stock: 45,
    desc: 'Segunda fila de ejemplo.',
    dailyRation: 0,
    tags: ''
  });

  ws.addRow({});
  ws.addRow({ name: 'Aquí van tus productos', species: 'Perros o Gatos o General', price: 0 });

  const inst = wb.addWorksheet('Instrucciones');
  inst.columns = [{ width: 4 }, { width: 34 }, { width: 90 }];
  const notes = [
    ['', 'IMPORTACIÓN EXCEL — CITY PETS', ''],
    ['', '', ''],
    ['', '1. Columnas', 'Cada columna es una celda. No separes valores por comas dentro de una misma celda.'],
    ['', '   · Especie', 'Valores permitidos: Perros, Gatos o General.'],
    ['', '   · Precio', 'En pesos colombianos. Acepta $185.000, 185000 o 185000,50.'],
    ['', '   · Tags', 'Sepáralas por ";" o ",". Ej: top; nuevo'],
    ['', '', ''],
    ['', '2. Filas de ejemplo', 'Las dos primeras filas de datos son ejemplos. Reemplázalas con tus productos o bórralas.'],
    ['', '', ''],
    ['', '3. Vista previa', 'Al subir el archivo verás una vista previa con la validación de CADA fila antes de importar.'],
    ['', '   Solo se importan las filas válidas; las inválidas se omiten y se listan en el reporte.'],
    ['', '', ''],
    ['', '4. Columnas obligatorias', 'nombre, especie y precio. El resto es opcional (usa los valores por defecto).']
  ];
  notes.forEach((r) => inst.addRow(r));
  inst.getRow(2).font = { bold: true, size: 13 };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ---------- Controladores ---------- */
async function getTemplate(req, res) {
  try {
    const buffer = await buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="citypets_plantilla_inventario.xlsx"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (e) {
    logger.error("Importación: error", { err: e });
    res.status(500).json({ error: 'No se pudo generar la plantilla' });
  }
}

async function preview(req, res) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Adjunta un archivo .xlsx en el campo "file"' });
  }
  try {
    const parsed = await parseWorkbook(req.file.buffer);
    const rows = parsed.map(({ row, raw }) => {
      const { data, errors } = validateRow(raw);
      return { row, data, errors, valid: errors.length === 0 };
    });

    const valid = rows.filter((r) => r.valid).length;
    const importId = storePreview(rows);

    res.json({
      importId,
      fileName: req.file.originalname || 'inventario.xlsx',
      summary: { total: rows.length, valid, invalid: rows.length - valid },
      rows
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'No se pudo leer el archivo Excel' });
  }
}

async function commit(req, res) {
  const importId = req.body && typeof req.body.importId === 'string' ? req.body.importId : '';
  const entry = consumePreview(importId);
  if (!entry) {
    return res.status(404).json({ error: 'Vista previa no encontrada o ya fue usada. Vuelve a subir el archivo.' });
  }

  let created = 0;
  const skipped = [];

  try {
    await prisma.$transaction(
      entry.rows
        .filter((r) => r.valid)
        .map((r) => {
          const d = r.data;
          return prisma.product.create({
            data: {
              name: d.name,
              species: d.species,
              category: d.category,
              price: d.price,
              unit: d.unit,
              grams: d.grams,
              stock: d.stock,
              desc: d.desc,
              dailyRation: d.dailyRation,
              tags: JSON.stringify(d.tags),
              images: '[]',
              video: '',
              rating: 4.0
            }
          });
        })
    );
    created = entry.rows.filter((r) => r.valid).length;
    entry.rows.filter((r) => !r.valid).forEach((r) => skipped.push({ row: r.row, name: r.data.name || '(sin nombre)', errors: r.errors }));
  } catch (e) {
    logger.error("Importación: error", { err: e });
    return res.status(500).json({ error: 'Error al importar los productos' });
  }

  res.json({ created, skipped });
}

module.exports = { getTemplate, preview, commit };