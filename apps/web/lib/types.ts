export type Channel = {
  id: string;
  type: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP_CLOUD" | "WHATSAPP_BAILEYS";
  name: string;
  status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
  externalAccountId: string;
  lastConnectedAt?: string | null;
  lastError: string | null;
  whatsappSession?: {
    qrCodeDataUrl: string | null;
    phoneJid: string | null;
  } | null;
};

export type ChannelDiagnosticCheck = {
  key: string;
  label: string;
  state: "PASS" | "WARN" | "FAIL" | "INFO";
  summary: string;
  detail?: string;
};

export type ChannelDiagnostics = {
  channelId: string;
  channelType: Channel["type"];
  overall: "READY" | "DEGRADED" | "BLOCKED";
  checkedAt: string;
  checks: ChannelDiagnosticCheck[];
  activity: {
    lastWebhookAt: string | null;
    lastWebhookStatus: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastOutboundStatus: string | null;
    failedWebhookEvents: number;
    queuedOutboundMessages: number;
  };
  recommendations: string[];
};

export type Variant = {
  id?: string;
  sku: string;
  size: string | null;
  color: string | null;
  priceDelta: string | number;
  stockQuantity: number;
  isAvailable: boolean;
};
export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  basePrice: string;
  promoPrice: string | null;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  trackInventory: boolean;
  stockQuantity: number;
  images: string[];
  variants: Variant[];
};
export type Order = {
  id: string;
  orderNumber: string;
  createdAt: string;
  fullName: string;
  phone: string;
  wilayaCode: number;
  wilayaName: string;
  municipality: string;
  totalAmount: string;
  status:
    | "CAPTURED"
    | "CONFIRMED"
    | "PACKING"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELED"
    | "RETURNED";
  items: Array<{
    id: string;
    productNameSnapshot: string;
    variantSnapshot: string | null;
    quantity: number;
  }>;
  dispatches: Array<{
    provider: string;
    status: string;
    trackingNumber: string | null;
  }>;
};
