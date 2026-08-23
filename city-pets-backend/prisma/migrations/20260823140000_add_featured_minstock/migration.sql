-- City Pets F1: gestion inteligente de inventario (no destructiva)
-- featured / minStock con defaults; backfill featured desde tag top

ALTER TABLE "Product" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "minStock" INTEGER NOT NULL DEFAULT 10;
UPDATE "Product" SET "featured" = true WHERE "tags" LIKE '%"top"%';
