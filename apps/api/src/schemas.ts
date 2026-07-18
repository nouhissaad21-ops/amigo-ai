import { z } from "zod";
export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.email().toLowerCase(),
  password: z.string().min(10).max(128),
  storeName: z.string().trim().min(2).max(100),
});
export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(128),
});
const variant = z.object({
  id: z.uuid().optional(),
  sku: z.string().trim().min(1).max(64),
  size: z.string().trim().max(50).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  priceDelta: z.coerce.number().min(-100000000).max(100000000).default(0),
  stockQuantity: z.coerce.number().int().nonnegative().max(1000000),
  isAvailable: z.boolean().default(true),
});
export const productSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(2).max(160),
    description: z.string().max(5000).default(""),
    basePrice: z.coerce.number().nonnegative().max(100000000),
    promoPrice: z.coerce
      .number()
      .nonnegative()
      .max(100000000)
      .nullable()
      .optional(),
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
    trackInventory: z.boolean().default(true),
    stockQuantity: z.coerce.number().int().nonnegative().max(1000000),
    images: z.array(z.url()).max(10).default([]),
    variants: z.array(variant).max(200).default([]),
  })
  .refine((v) => v.promoPrice == null || v.promoPrice <= v.basePrice, {
    message: "السعر الترويجي يجب أن يكون أقل من أو يساوي السعر الأساسي",
    path: ["promoPrice"],
  });
export const settingsSchema = z.object({
  generalRules: z.string().max(50000),
  exchangePolicy: z.string().max(20000).default(""),
  specialOffers: z.string().max(20000).default(""),
  fallbackMessage: z.string().trim().min(2).max(500),
  deliveryRates: z
    .array(
      z.object({
        wilayaCode: z.coerce.number().int().min(1).max(58),
        homePrice: z.coerce.number().nonnegative().max(100000),
        deskPrice: z.coerce
          .number()
          .nonnegative()
          .max(100000)
          .nullable()
          .optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .max(58),
});
export const cloudWhatsAppSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phoneNumberId: z.string().trim().min(3).max(100),
  wabaId: z.string().trim().min(3).max(100),
  accessToken: z.string().trim().min(20),
});
export const connectorSchema = z.object({
  type: z.enum(["GOOGLE_SHEETS", "YALIDINE", "ZR_EXPRESS"]),
  name: z.string().trim().min(2).max(100),
  credentials: z.record(z.string(), z.string().max(2000)),
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export const orderToolSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().regex(/^(05|06|07)\d{8}$/),
  wilayaCode: z.number().int().min(1).max(58),
  municipality: z.string().trim().min(2).max(120),
  deliveryType: z.enum(["HOME", "DESK"]).default("HOME"),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        variantId: z.uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(20),
});
export type OrderToolInput = z.infer<typeof orderToolSchema>;
export const orderStatusSchema = z.object({
  status: z.enum([
    "CAPTURED",
    "CONFIRMED",
    "PACKING",
    "SHIPPED",
    "DELIVERED",
    "CANCELED",
    "RETURNED",
  ]),
});
