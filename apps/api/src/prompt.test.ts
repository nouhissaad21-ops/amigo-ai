import { describe, expect, it } from "vitest";
import { buildMerchantSystemPrompt, createOrderTool } from "./prompt.js";

const input = {
  storeName: "متجر التجربة",
  currency: "DZD",
  generalRules: "التوصيل يومين",
  exchangePolicy: "التبدال في 48 ساعة",
  specialOffers: "لا توجد",
  products: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      sku: "TS-1",
      name: "تيشورت",
      description: "قطن",
      basePrice: "2500.00",
      promoPrice: "2000.00",
      stockQuantity: 0,
      trackInventory: true,
      variants: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          sku: "TS-1-BL-M",
          size: "M",
          color: "أزرق",
          priceDelta: "0.00",
          stockQuantity: 0,
          isAvailable: true,
        },
      ],
    },
  ],
  deliveryRates: [
    {
      wilayaCode: 16,
      wilayaName: "الجزائر",
      homePrice: "500.00",
      deskPrice: "350.00",
    },
  ],
};

describe("merchant system prompt", () => {
  it("injects merchant rules, catalog and delivery data", () => {
    const prompt = buildMerchantSystemPrompt(input);
    expect(prompt).toContain("التوصيل يومين");
    expect(prompt).toContain("تيشورت");
    expect(prompt).toContain('"wilayaCode":16');
  });

  it("uses the promotion as the active price and preserves the original", () => {
    const prompt = buildMerchantSystemPrompt(input);
    expect(prompt).toContain('"price":"2000.00"');
    expect(prompt).toContain('"originalPrice":"2500.00"');
  });

  it("marks depleted variants and products unavailable", () => {
    const prompt = buildMerchantSystemPrompt(input);
    expect(prompt).toContain('"available":false');
  });

  it("contains anti-hallucination and server-price rules", () => {
    const prompt = buildMerchantSystemPrompt(input);
    expect(prompt).toContain("ممنوع تخترع");
    expect(prompt).toContain("الخادم يحسبه من قاعدة البيانات");
  });
});

describe("create_order tool", () => {
  it("forbids unknown fields and constrains Algerian phone numbers", () => {
    expect(createOrderTool.parameters.additionalProperties).toBe(false);
    expect(createOrderTool.parameters.properties.phone.pattern).toBe(
      "^(05|06|07)\\d{8}$",
    );
    expect(createOrderTool.parameters.required).toContain("items");
  });
});
