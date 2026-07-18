import { describe, expect, it } from "vitest";
import { orderToolSchema, productSchema, settingsSchema } from "./schemas.js";

const order = {
  fullName: "أمين بن علي",
  phone: "0550123456",
  wilayaCode: 16,
  municipality: "باب الزوار",
  deliveryType: "HOME" as const,
  items: [
    {
      productId: "00000000-0000-4000-8000-000000000001",
      variantId: null,
      quantity: 2,
    },
  ],
};

describe("order tool validation", () => {
  it("accepts a complete Algerian order", () => {
    expect(orderToolSchema.parse(order)).toEqual(order);
  });

  it.each([
    "0450123456",
    "0850123456",
    "055012345",
    "05501234567",
    "+213550123456",
  ])("rejects invalid phone %s", (phone) =>
    expect(() => orderToolSchema.parse({ ...order, phone })).toThrow(),
  );

  it.each([0, 59, 99])("rejects invalid wilaya %s", (wilayaCode) => {
    expect(() => orderToolSchema.parse({ ...order, wilayaCode })).toThrow();
  });

  it("rejects empty or non-positive order lines", () => {
    expect(() => orderToolSchema.parse({ ...order, items: [] })).toThrow();
    expect(() =>
      orderToolSchema.parse({
        ...order,
        items: [{ ...order.items[0], quantity: 0 }],
      }),
    ).toThrow();
  });
});

describe("merchant input validation", () => {
  it("rejects a promotion above the base price", () => {
    expect(() =>
      productSchema.parse({
        sku: "A",
        name: "منتج",
        description: "",
        basePrice: 1000,
        promoPrice: 1200,
        stockQuantity: 1,
        images: [],
        variants: [],
      }),
    ).toThrow();
  });

  it("limits delivery configuration to valid Algerian wilayas", () => {
    expect(() =>
      settingsSchema.parse({
        generalRules: "",
        fallbackMessage: "رسالة",
        deliveryRates: [{ wilayaCode: 60, homePrice: 500, enabled: true }],
      }),
    ).toThrow();
  });
});
