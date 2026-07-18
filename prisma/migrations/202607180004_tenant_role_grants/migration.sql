-- This migration also supports managed PostgreSQL providers such as Neon,
-- where the limited role is created immediately before `prisma migrate deploy`.
DO $$
BEGIN
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
