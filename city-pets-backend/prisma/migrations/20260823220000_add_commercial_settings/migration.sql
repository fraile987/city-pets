-- City Pets Fase A: configuración comercial (migración ESTRICTAMENTE aditiva)
-- Datos comerciales editables desde el panel admin y consumidos por el
-- storefront vía GET /api/settings. Defaults = valores que estaban hardcodeados.
ALTER TABLE "StoreSettings" ADD COLUMN "whatsapp" TEXT NOT NULL DEFAULT '3001234567';
ALTER TABLE "StoreSettings" ADD COLUMN "daysOfWeek" TEXT NOT NULL DEFAULT 'Lun a Sáb';
ALTER TABLE "StoreSettings" ADD COLUMN "openingTime" TEXT NOT NULL DEFAULT '8:00 AM';
ALTER TABLE "StoreSettings" ADD COLUMN "closingTime" TEXT NOT NULL DEFAULT '8:00 PM';
