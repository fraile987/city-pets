/* =========================================================
   CITY PETS — Generador de .xlsx para pruebas de importación (G22)
   Crea un libro con filas válidas e inválidas para verificar:
   - columnas en celdas separadas,
   - validación POR FILA,
   - vista previa (solo se importan las filas válidas).
   Uso: node scripts/gen-test-xlsx.js /tmp/cp-g22-inventario.xlsx
   ========================================================= */

const ExcelJS = require('exceljs');
const fs = require('fs');

async function main() {
  const out = process.argv[2] || '/tmp/cp-g22-inventario.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventario');

  ws.columns = [
    { header: 'Nombre del producto', key: 'name', width: 30 },
    { header: 'Especie', key: 'species', width: 14 },
    { header: 'Categoría', key: 'category', width: 16 },
    { header: 'Precio ($)', key: 'price', width: 14 },
    { header: 'Unidad', key: 'unit', width: 14 },
    { header: 'Gramos', key: 'grams', width: 10 },
    { header: 'Stock', key: 'stock', width: 10 },
    { header: 'Descripción', key: 'desc', width: 34 },
    { header: 'Ración diaria (g)', key: 'dailyRation', width: 14 },
    { header: 'Tags (separadas por ;)', key: 'tags', width: 20 }
  ];

  ws.addRows([
    { name: 'Import G22 Perro', species: 'Perros', category: 'Alimento', price: 25000, unit: '1 kg', grams: 1000, stock: 10, desc: 'Fila valida 1', dailyRation: 100, tags: 'g22;prueba' },
    { name: 'Import G22 Gato', species: 'Gatos', category: 'Higiene', price: '30.500', unit: '500 ml', grams: 0, stock: 5, desc: 'Fila valida 2 con formato colombiano', dailyRation: 0, tags: '' },
    { name: '', species: 'Perros', category: 'Alimento', price: 1000 },
    { name: 'Import G22 Mal', species: 'Aves', category: 'Alimento', price: 1000 },
    { name: 'Import G22 Precio', species: 'Perros', category: 'Alimento', price: 'abc' },
    { name: 'Import G22 Negativo', species: 'Perros', category: 'Alimento', price: -5000 }
  ]);

  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(out, Buffer.from(buf));
  console.log(`XLSX de prueba generado: ${out} (${fs.statSync(out).size} bytes, 6 filas)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});