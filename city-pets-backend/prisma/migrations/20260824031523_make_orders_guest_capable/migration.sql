-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "delivery" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slotGenerated" TEXT NOT NULL,
    "deliverySlot" TEXT NOT NULL,
    "deliveryDate" TEXT NOT NULL,
    "deliveryLabel" TEXT NOT NULL,
    "payment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "deliveredAt" DATETIME,
    "clientOrderKey" TEXT,
    "guestKey" TEXT,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("address", "clientOrderKey", "createdAt", "deliveredAt", "delivery", "deliveryDate", "deliveryLabel", "deliverySlot", "id", "payment", "phone", "slotGenerated", "status", "subtotal", "total", "userId", "userName") SELECT "address", "clientOrderKey", "createdAt", "deliveredAt", "delivery", "deliveryDate", "deliveryLabel", "deliverySlot", "id", "payment", "phone", "slotGenerated", "status", "subtotal", "total", "userId", "userName" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_guestKey_key" ON "Order"("guestKey");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_status_deliveredAt_idx" ON "Order"("status", "deliveredAt");
CREATE UNIQUE INDEX "Order_userId_clientOrderKey_key" ON "Order"("userId", "clientOrderKey");
CREATE TABLE "new_StoreSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "deliveryCost" INTEGER NOT NULL DEFAULT 10000,
    "freeDeliveryFrom" INTEGER NOT NULL DEFAULT 100000,
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "daysOfWeek" TEXT NOT NULL DEFAULT '',
    "openingTime" TEXT NOT NULL DEFAULT '',
    "closingTime" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StoreSettings" ("closingTime", "daysOfWeek", "deliveryCost", "freeDeliveryFrom", "id", "openingTime", "updatedAt", "whatsapp") SELECT "closingTime", "daysOfWeek", "deliveryCost", "freeDeliveryFrom", "id", "openingTime", "updatedAt", "whatsapp" FROM "StoreSettings";
DROP TABLE "StoreSettings";
ALTER TABLE "new_StoreSettings" RENAME TO "StoreSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
