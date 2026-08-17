# Catálogo — imágenes de productos

Imágenes locales usadas por el seed (B1/B2). El seed las copia a
`UPLOADS_ROOT/products/` (idempotente) y los productos referencian
`/uploads/products/p<id>.jpg` en vez de URLs externas de picsum.

## Origen y licencia

Descargadas el 2026-08-17 desde `https://picsum.photos/seed/<seed>/600/450`
usando los mismos seeds que tenía el catálogo original (`dogfood1`, ...,
`wetdog`). Las imágenes de Picsum provienen de Unsplash y están cubiertas
por la [Licencia Unsplash](https://unsplash.com/license), que permite uso
comercial y personal sin permiso ni atribución, y permite editar las
imágenes. No está permitido revenderlas sin alterar, compilarlas para
replicar un servicio similar, ni usarlas en IA/bioetría (restricciones
vigentes de la licencia). No se requieren atribuciones, aunque se
agradece crédito.

## Mapeo de archivos

| Archivo | Producto | Seed de origen |
|---|---|---|
| p1.jpg  | p1  Alimento Adulto Perro 15 kg      | dogfood1 |
| p2.jpg  | p2  Alimento Cachorro Perro 3 kg     | dogfood2 |
| p3.jpg  | p3  Alimento Light Perro 10 kg       | dogfood3 |
| p4.jpg  | p4  Alimento Adulto Gato 7 kg        | catfood1 |
| p5.jpg  | p5  Alimento Gato Esterilizado 3 kg  | catfood2 |
| p6.jpg  | p6  Galletas Dentales 1 kg           | snack1 |
| p7.jpg  | p7  Snack Premium Gato 400 g         | snack2 |
| p8.jpg  | p8  Juguete Cuerda + Pelota          | toy1 |
| p9.jpg  | p9  Rascador Torre Gato              | toy2 |
| p10.jpg | p10 Arena Sanitaria 10 kg            | litter |
| p11.jpg | p11 Shampoo Antipulgas 500 ml        | shampoo |
| p12.jpg | p12 Collar Reflectivo ajustable      | collar |
| p13.jpg | p13 Cama Deluxe para Mascota         | cama |
| p14.jpg | p14 Comida Húmeda Perro 200 g (12)   | wetdog |
