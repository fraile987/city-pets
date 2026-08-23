-- City Pets D1: configuracion de domicilio (no destructiva)
-- Tabla global de una sola fila (id=1); no toca Product/User.

CREATE TABLE "StoreSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
  "deliveryCost" INTEGER NOT NULL DEFAULT 10000,
  "freeDeliveryFrom" INTEGER NOT NULL DEFAULT 100000,
  "updatedAt" DATETIME NOT NULL
);
INSERT INTO "StoreSettings" ("id", "deliveryCost", "freeDeliveryFrom", "updatedAt") VALUES (1, 10000, 100000, datetime('now'));
