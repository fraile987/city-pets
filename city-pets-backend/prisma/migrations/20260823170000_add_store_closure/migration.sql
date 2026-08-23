-- City Pets P3.1: cierres de caja persistentes (no destructiva)
-- No toca Product/User/Order; agrega solo la tabla StoreClosure.

CREATE TABLE "StoreClosure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "adminId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "total" INTEGER NOT NULL,
  "efectivo" INTEGER NOT NULL,
  "digital" INTEGER NOT NULL,
  "cantidadPedidos" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreClosure_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StoreClosure_from_to_key" ON "StoreClosure"("from", "to");
