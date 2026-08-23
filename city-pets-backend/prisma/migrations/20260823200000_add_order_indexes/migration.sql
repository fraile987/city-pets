-- City Pets P7.2: indices para consultas de pedidos (aditiva, no destructiva)
-- Beneficia a GET /admin/orders (status+createdAt) y revenue/cierres
-- (status+deliveredAt y el fallback status+createdAt).

CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_status_deliveredAt_idx" ON "Order"("status", "deliveredAt");
