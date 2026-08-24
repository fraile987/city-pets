-- City Pets F2: periodicidad de compra por producto (migración ESTRICTAMENTE aditiva)
-- Indica cada cuántos meses se compra aproximadamente el producto.
--   purchaseFrequencyMonths = 1  -> se compra aproximadamente cada mes
--   purchaseFrequencyMonths = 2  -> cada 2 meses
--   purchaseFrequencyMonths = 3  -> cada 3 meses
-- Los productos existentes conservan sus datos y reciben el valor por defecto 1.
-- Solo se usa para calcular consumo/año cuando el producto NO tiene dailyRation.

ALTER TABLE "Product" ADD COLUMN "purchaseFrequencyMonths" INTEGER NOT NULL DEFAULT 1;
