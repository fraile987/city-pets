/* =========================================================
   CITY PETS — Datos semilla de productos
   Copia fiel de SEED_PRODUCTS en js/data.js (14 productos,
   mismos valores e ids p1-p14). Los arrays images y tags se
   serializan a JSON para el modelo Product.
   ========================================================= */

const SEED_PRODUCTS = [
  { id: 'p1', name: 'Alimento Adulto Perro 15 kg', species: 'Perros', category: 'Alimento', price: 185000, unit: '15 kg', grams: 15000, stock: 42, desc: 'Alimento balanceado premium para perros adultos con proteína de pollo.', images: ['/uploads/products/p1.jpg'], video: '', rating: 4.7, dailyRation: 210, tags: ['top'] },
  { id: 'p2', name: 'Alimento Cachorro Perro 3 kg', species: 'Perros', category: 'Alimento', price: 62000, unit: '3 kg', grams: 3000, stock: 60, desc: 'Fórmula especial para cachorros en crecimiento, rica en calcio.', images: ['/uploads/products/p2.jpg'], video: '', rating: 4.5, dailyRation: 90, tags: [] },
  { id: 'p3', name: 'Alimento Light Perro 10 kg', species: 'Perros', category: 'Alimento', price: 124000, unit: '10 kg', grams: 10000, stock: 18, desc: 'Control de peso con bajo contenido de grasa y alta fibra.', images: ['/uploads/products/p3.jpg'], video: '', rating: 4.2, dailyRation: 160, tags: [] },
  { id: 'p4', name: 'Alimento Adulto Gato 7 kg', species: 'Gatos', category: 'Alimento', price: 142000, unit: '7 kg', grams: 7000, stock: 35, desc: 'Alimento balanceado para gatos adultos, sabor salmón y arroz.', images: ['/uploads/products/p4.jpg'], video: '', rating: 4.8, dailyRation: 55, tags: ['top'] },
  { id: 'p5', name: 'Alimento Gato Esterilizado 3 kg', species: 'Gatos', category: 'Alimento', price: 98000, unit: '3 kg', grams: 3000, stock: 27, desc: 'Fórmula para gatos esterilizados que ayuda al control urinario.', images: ['/uploads/products/p5.jpg'], video: '', rating: 4.6, dailyRation: 48, tags: [] },
  { id: 'p6', name: 'Galletas Dentales 1 kg', species: 'Perros', category: 'Snacks', price: 28500, unit: '1 kg', grams: 1000, stock: 120, desc: 'Snack dental que reduce sarro y mal aliento.', images: ['/uploads/products/p6.jpg'], video: '', rating: 4.4, dailyRation: 15, tags: [] },
  { id: 'p7', name: 'Snack Premium Gato 400 g', species: 'Gatos', category: 'Snacks', price: 22400, unit: '400 g', grams: 400, stock: 95, desc: 'Premios suaves sabor atún, perfectos para entrenamiento.', images: ['/uploads/products/p7.jpg'], video: '', rating: 4.3, dailyRation: 10, tags: [] },
  { id: 'p8', name: 'Juguete Cuerda + Pelota', species: 'Perros', category: 'Juguetes', price: 18400, unit: '1 und', grams: 0, stock: 74, desc: 'Combo de juguete resistente para morder y lanzar.', images: ['/uploads/products/p8.jpg'], video: '', rating: 4.1, dailyRation: 0, tags: [] },
  { id: 'p9', name: 'Rascador Torre Gato', species: 'Gatos', category: 'Juguetes', price: 135000, unit: '1 und', grams: 0, stock: 12, desc: 'Torre rascador de 120 cm con plataformas y peluche.', images: ['/uploads/products/p9.jpg'], video: '', rating: 4.9, dailyRation: 0, tags: ['top'] },
  { id: 'p10', name: 'Arena Sanitaria 10 kg', species: 'Gatos', category: 'Higiene', price: 32000, unit: '10 kg', grams: 0, stock: 88, desc: 'Arena aglomerante con control de olores, 10 kg.', images: ['/uploads/products/p10.jpg'], video: '', rating: 4.5, dailyRation: 0, tags: [] },
  { id: 'p11', name: 'Shampoo Antipulgas 500 ml', species: 'General', category: 'Higiene', price: 26500, unit: '500 ml', grams: 0, stock: 66, desc: 'Baño con protección contra pulgas y garrapatas hasta 14 días.', images: ['/uploads/products/p11.jpg'], video: '', rating: 4.2, dailyRation: 0, tags: [] },
  { id: 'p12', name: 'Collar Reflectivo ajustable', species: 'General', category: 'Accesorios', price: 19800, unit: '1 und', grams: 0, stock: 130, desc: 'Collar de nailon con banda reflectiva para paseos nocturnos.', images: ['/uploads/products/p12.jpg'], video: '', rating: 4.6, dailyRation: 0, tags: [] },
  { id: 'p13', name: 'Cama Deluxe para Mascota', species: 'General', category: 'Accesorios', price: 89000, unit: '1 und', grams: 0, stock: 9, desc: 'Cama acolchada tipo peluche, lavable, talla única.', images: ['/uploads/products/p13.jpg'], video: '', rating: 4.8, dailyRation: 0, tags: [] },
  { id: 'p14', name: 'Comida Húmeda Perro 200 g (12 und)', species: 'Perros', category: 'Alimento', price: 45900, unit: '12 x 200 g', grams: 2400, stock: 54, desc: 'Sobres húmedos sabor res, para perros de todas las edades.', images: ['/uploads/products/p14.jpg'], video: '', rating: 4.7, dailyRation: 90, tags: [] }
];

module.exports = { SEED_PRODUCTS };