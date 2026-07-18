-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StoreRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('TRIAL', 'STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'WHATSAPP_CLOUD', 'WHATSAPP_BAILEYS');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('GOOGLE_SHEETS', 'YALIDINE', 'ZR_EXPRESS');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'HANDOFF', 'CLOSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CAPTURED', 'CONFIRMED', 'PACKING', 'SHIPPED', 'DELIVERED', 'CANCELED', 'RETURNED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('YALIDINE', 'ZR_EXPRESS');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Algiers',
    "locale" TEXT NOT NULL DEFAULT 'ar-DZ',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMembership" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "StoreRole" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'TRIAL',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "providerCustomerId" TEXT,
    "providerContractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'PENDING',
    "externalAccountId" TEXT NOT NULL,
    "externalBusinessId" TEXT,
    "credentialsEncrypted" TEXT NOT NULL,
    "credentialKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "webhookSubscribedAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentialsEncrypted" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "basePrice" DECIMAL(12,2) NOT NULL,
    "promoPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRules" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "generalRules" TEXT NOT NULL,
    "exchangePolicy" TEXT NOT NULL DEFAULT '',
    "specialOffers" TEXT NOT NULL DEFAULT '',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'سمحلي، صرا مشكل تقني صغير. نجاوبك بعد لحظات.',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRate" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "wilayaName" TEXT NOT NULL,
    "homePrice" DECIMAL(12,2) NOT NULL,
    "deskPrice" DECIMAL(12,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "municipalities" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "customerExternalId" TEXT NOT NULL,
    "customerName" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "externalMessageId" TEXT,
    "sourceEventId" UUID,
    "direction" "MessageDirection" NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "wilayaName" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "wilayaName" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "deliveryType" TEXT NOT NULL DEFAULT 'HOME',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "deliveryPrice" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "status" "OrderStatus" NOT NULL DEFAULT 'CAPTURED',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "productNameSnapshot" TEXT NOT NULL,
    "variantSnapshot" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "storeId" UUID,
    "channelId" UUID,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'PENDING',
    "credentialsEnc" TEXT NOT NULL,
    "qrCodeDataUrl" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "phoneJid" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAuthKey" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingDispatch" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "trackingNumber" TEXT,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE INDEX "Store_isActive_deletedAt_idx" ON "Store"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "StoreMembership_userId_idx" ON "StoreMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMembership_storeId_userId_key" ON "StoreMembership"("storeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_storeId_key" ON "Subscription"("storeId");

-- CreateIndex
CREATE INDEX "Channel_storeId_type_status_idx" ON "Channel"("storeId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_type_externalAccountId_key" ON "Channel"("type", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_storeId_id_key" ON "Channel"("storeId", "id");

-- CreateIndex
CREATE INDEX "Connector_storeId_enabled_idx" ON "Connector"("storeId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_storeId_type_key" ON "Connector"("storeId", "type");

-- CreateIndex
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_sku_key" ON "Product"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_id_key" ON "Product"("storeId", "id");

-- CreateIndex
CREATE INDEX "ProductVariant_storeId_productId_isAvailable_idx" ON "ProductVariant"("storeId", "productId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_storeId_productId_sku_key" ON "ProductVariant"("storeId", "productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_storeId_id_key" ON "ProductVariant"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRules_storeId_key" ON "MerchantRules"("storeId");

-- CreateIndex
CREATE INDEX "DeliveryRate_storeId_enabled_idx" ON "DeliveryRate"("storeId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRate_storeId_wilayaCode_key" ON "DeliveryRate"("storeId", "wilayaCode");

-- CreateIndex
CREATE INDEX "Conversation_storeId_status_lastMessageAt_idx" ON "Conversation"("storeId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_storeId_channelId_customerExternalId_key" ON "Conversation"("storeId", "channelId", "customerExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_storeId_id_key" ON "Conversation"("storeId", "id");

-- CreateIndex
CREATE INDEX "Message_storeId_conversationId_createdAt_idx" ON "Message"("storeId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_storeId_channelId_externalMessageId_key" ON "Message"("storeId", "channelId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_storeId_sourceEventId_direction_key" ON "Message"("storeId", "sourceEventId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "Message_storeId_id_key" ON "Message"("storeId", "id");

-- CreateIndex
CREATE INDEX "Lead_storeId_phone_idx" ON "Lead"("storeId", "phone");

-- CreateIndex
CREATE INDEX "Lead_storeId_status_createdAt_idx" ON "Lead"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_storeId_id_key" ON "Lead"("storeId", "id");

-- CreateIndex
CREATE INDEX "Order_storeId_status_createdAt_idx" ON "Order"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_orderNumber_key" ON "Order"("storeId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_idempotencyKey_key" ON "Order"("storeId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_id_key" ON "Order"("storeId", "id");

-- CreateIndex
CREATE INDEX "OrderItem_storeId_orderId_idx" ON "OrderItem"("storeId", "orderId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_storeId_status_idx" ON "WebhookEvent"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventKey_key" ON "WebhookEvent"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_storeId_expiresAt_idx" ON "RefreshSession"("userId", "storeId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_channelId_key" ON "WhatsAppSession"("channelId");

-- CreateIndex
CREATE INDEX "WhatsAppSession_storeId_status_idx" ON "WhatsAppSession"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_storeId_id_key" ON "WhatsAppSession"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_storeId_channelId_key" ON "WhatsAppSession"("storeId", "channelId");

-- CreateIndex
CREATE INDEX "WhatsAppAuthKey_storeId_sessionId_idx" ON "WhatsAppAuthKey"("storeId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAuthKey_sessionId_category_keyId_key" ON "WhatsAppAuthKey"("sessionId", "category", "keyId");

-- CreateIndex
CREATE INDEX "ShippingDispatch_storeId_status_idx" ON "ShippingDispatch"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingDispatch_storeId_orderId_key" ON "ShippingDispatch"("storeId", "orderId");

-- CreateIndex
CREATE INDEX "AuditLog_storeId_createdAt_idx" ON "AuditLog"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreMembership" ADD CONSTRAINT "StoreMembership_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMembership" ADD CONSTRAINT "StoreMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRules" ADD CONSTRAINT "MerchantRules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeId_channelId_fkey" FOREIGN KEY ("storeId", "channelId") REFERENCES "Channel"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_storeId_channelId_fkey" FOREIGN KEY ("storeId", "channelId") REFERENCES "Channel"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_storeId_conversationId_fkey" FOREIGN KEY ("storeId", "conversationId") REFERENCES "Conversation"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_storeId_channelId_fkey" FOREIGN KEY ("storeId", "channelId") REFERENCES "Channel"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_storeId_conversationId_fkey" FOREIGN KEY ("storeId", "conversationId") REFERENCES "Conversation"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_channelId_fkey" FOREIGN KEY ("storeId", "channelId") REFERENCES "Channel"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_conversationId_fkey" FOREIGN KEY ("storeId", "conversationId") REFERENCES "Conversation"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_leadId_fkey" FOREIGN KEY ("storeId", "leadId") REFERENCES "Lead"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "Product"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_storeId_channelId_fkey" FOREIGN KEY ("storeId", "channelId") REFERENCES "Channel"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAuthKey" ADD CONSTRAINT "WhatsAppAuthKey_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAuthKey" ADD CONSTRAINT "WhatsAppAuthKey_storeId_sessionId_fkey" FOREIGN KEY ("storeId", "sessionId") REFERENCES "WhatsAppSession"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingDispatch" ADD CONSTRAINT "ShippingDispatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingDispatch" ADD CONSTRAINT "ShippingDispatch_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
