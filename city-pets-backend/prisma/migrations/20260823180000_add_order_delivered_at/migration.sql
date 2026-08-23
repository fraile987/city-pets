-- City Pets P4: fecha real de entrega (no destructiva)
-- Agrega columna nullable; no toca datos existentes.

ALTER TABLE "Order" ADD COLUMN "deliveredAt" DATETIME;
