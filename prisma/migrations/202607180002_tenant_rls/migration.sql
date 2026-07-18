-- Tenant isolation is enforced twice: composite tenant foreign keys in the schema
-- and PostgreSQL row-level security for every table reached by the tenant role.
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.current_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_store_id', true), '')::uuid
$$;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_store_id() FROM PUBLIC;

ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_tenant_isolation ON "Store"
  USING (id = app_private.current_store_id())
  WITH CHECK (id = app_private.current_store_id());

ALTER TABLE "StoreMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_tenant_isolation ON "StoreMembership"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_tenant_isolation ON "Subscription"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Channel" FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_tenant_isolation ON "Channel"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Connector" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Connector" FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_tenant_isolation ON "Connector"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_tenant_isolation ON "Product"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" FORCE ROW LEVEL SECURITY;
CREATE POLICY variant_tenant_isolation ON "ProductVariant"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "MerchantRules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MerchantRules" FORCE ROW LEVEL SECURITY;
CREATE POLICY rules_tenant_isolation ON "MerchantRules"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "DeliveryRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_tenant_isolation ON "DeliveryRate"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_tenant_isolation ON "Conversation"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY message_tenant_isolation ON "Message"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_tenant_isolation ON "Lead"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY order_tenant_isolation ON "Order"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY item_tenant_isolation ON "OrderItem"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "WhatsAppSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_tenant_isolation ON "WhatsAppSession"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "WhatsAppAuthKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppAuthKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_key_tenant_isolation ON "WhatsAppAuthKey"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "ShippingDispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShippingDispatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatch_tenant_isolation ON "ShippingDispatch"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_isolation ON "AuditLog"
  USING ("storeId" = app_private.current_store_id())
  WITH CHECK ("storeId" = app_private.current_store_id());

-- Domain invariants that must hold even if a future code path bypasses validation.
ALTER TABLE "Product"
  ADD CONSTRAINT product_price_nonnegative CHECK ("basePrice" >= 0 AND ("promoPrice" IS NULL OR "promoPrice" >= 0)),
  ADD CONSTRAINT product_stock_nonnegative CHECK ("stockQuantity" >= 0);
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT variant_stock_nonnegative CHECK ("stockQuantity" >= 0);
ALTER TABLE "DeliveryRate"
  ADD CONSTRAINT delivery_wilaya_valid CHECK ("wilayaCode" BETWEEN 1 AND 58),
  ADD CONSTRAINT delivery_price_nonnegative CHECK ("homePrice" >= 0 AND ("deskPrice" IS NULL OR "deskPrice" >= 0));
ALTER TABLE "Lead"
  ADD CONSTRAINT lead_wilaya_valid CHECK ("wilayaCode" BETWEEN 1 AND 58),
  ADD CONSTRAINT lead_phone_valid CHECK (phone ~ '^(05|06|07)[0-9]{8}$');
ALTER TABLE "Order"
  ADD CONSTRAINT order_wilaya_valid CHECK ("wilayaCode" BETWEEN 1 AND 58),
  ADD CONSTRAINT order_phone_valid CHECK (phone ~ '^(05|06|07)[0-9]{8}$'),
  ADD CONSTRAINT order_amounts_nonnegative CHECK (subtotal >= 0 AND "deliveryPrice" >= 0 AND "totalAmount" >= 0),
  ADD CONSTRAINT order_total_consistent CHECK ("totalAmount" = subtotal + "deliveryPrice");
ALTER TABLE "OrderItem"
  ADD CONSTRAINT order_item_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT order_item_amounts_nonnegative CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0),
  ADD CONSTRAINT order_item_total_consistent CHECK ("lineTotal" = "unitPrice" * quantity);
ALTER TABLE "Subscription"
  ADD CONSTRAINT subscription_period_valid CHECK ("currentPeriodEnd" > "currentPeriodStart");

-- Grants are conditional so local migration diffing does not require application roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amigo_system') THEN
    GRANT USAGE ON SCHEMA public, app_private TO amigo_system;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO amigo_system;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO amigo_system;
    GRANT EXECUTE ON FUNCTION app_private.current_store_id() TO amigo_system;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amigo_app') THEN
    GRANT USAGE ON SCHEMA public, app_private TO amigo_app;
    GRANT EXECUTE ON FUNCTION app_private.current_store_id() TO amigo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "Store", "StoreMembership", "Subscription", "Channel", "Connector",
      "Product", "ProductVariant", "MerchantRules", "DeliveryRate",
      "Conversation", "Message", "Lead", "Order", "OrderItem",
      "WhatsAppSession", "WhatsAppAuthKey", "ShippingDispatch", "AuditLog"
      TO amigo_app;
  END IF;
END
$$;
