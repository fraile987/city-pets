-- City Pets P6.2: idempotencia de pedidos (no destructiva)
-- Agrega clientOrderKey nullable + UNIQUE compuesto (userId, clientOrderKey).
-- Pedidos existentes conservan clientOrderKey = NULL.

ALTER TABLE "Order" ADD COLUMN "clientOrderKey" TEXT;
CREATE UNIQUE INDEX "Order_userId_clientOrderKey_key" ON "Order"("userId", "clientOrderKey");
