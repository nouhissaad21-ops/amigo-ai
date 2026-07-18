-- A variant reference must belong to the same tenant as its order item.
-- PostgreSQL does not check the relationship when variantId is NULL.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_storeId_variantId_fkey"
  FOREIGN KEY ("storeId", "variantId")
  REFERENCES "ProductVariant"("storeId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
