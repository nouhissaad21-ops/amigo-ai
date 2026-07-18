import { Prisma, type Order, type OrderStatus } from "@prisma/client";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { orderToolSchema, type OrderToolInput } from "../schemas.js";
import { wilayaName } from "../wilayas.js";
type C = {
  storeId: string;
  channelId: string;
  conversationId: string;
  idempotencyKey: string;
  input: OrderToolInput;
};
export type CreatedOrder = {
  id: string;
  orderNumber: string;
  totalAmount: string;
  subtotal: string;
  deliveryPrice: string;
  currency: string;
  status: string;
};
const pub = (o: Order): CreatedOrder => ({
  id: o.id,
  orderNumber: o.orderNumber,
  totalAmount: o.totalAmount.toFixed(2),
  subtotal: o.subtotal.toFixed(2),
  deliveryPrice: o.deliveryPrice.toFixed(2),
  currency: o.currency,
  status: o.status,
});
const number = () =>
  `AMG-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
export async function createOrderFromTool(c: C): Promise<CreatedOrder> {
  const input = orderToolSchema.parse(c.input),
    wilaya = wilayaName(input.wilayaCode);
  if (!wilaya)
    throw new AppError(422, "INVALID_WILAYA", "رقم الولاية غير صالح");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await systemDb.$transaction(
        async (tx) => {
          const old = await tx.order.findUnique({
            where: {
              storeId_idempotencyKey: {
                storeId: c.storeId,
                idempotencyKey: c.idempotencyKey,
              },
            },
          });
          if (old) return pub(old);
          const store = await tx.store.findUniqueOrThrow({
              where: { id: c.storeId },
              select: { currency: true },
            }),
            delivery = await tx.deliveryRate.findUnique({
              where: {
                storeId_wilayaCode: {
                  storeId: c.storeId,
                  wilayaCode: input.wilayaCode,
                },
              },
            });
          if (!delivery?.enabled)
            throw new AppError(
              422,
              "DELIVERY_UNAVAILABLE",
              "التوصيل غير متوفر لهذه الولاية",
            );
          const ids = [...new Set(input.items.map((x) => x.productId))],
            products = await tx.product.findMany({
              where: { storeId: c.storeId, id: { in: ids }, status: "ACTIVE" },
              include: { variants: true },
            });
          if (products.length !== ids.length)
            throw new AppError(
              422,
              "INVALID_PRODUCT",
              "منتج غير موجود أو غير متاح",
            );
          const map = new Map(products.map((p) => [p.id, p]));
          const lines = input.items.map((item) => {
            const product = map.get(item.productId);
            if (!product)
              throw new AppError(422, "INVALID_PRODUCT", "المنتج غير موجود");
            const v = item.variantId
              ? product.variants.find((x) => x.id === item.variantId)
              : undefined;
            if (item.variantId && (!v || !v.isAvailable))
              throw new AppError(
                422,
                "INVALID_VARIANT",
                `خيار ${product.name} غير متوفر`,
              );
            if (product.variants.length && !v)
              throw new AppError(
                422,
                "VARIANT_REQUIRED",
                `اختار المقاس/اللون تاع ${product.name}`,
              );
            const unit = (product.promoPrice ?? product.basePrice).add(
              v?.priceDelta ?? 0,
            );
            if (unit.isNegative())
              throw new AppError(422, "INVALID_PRICE", "سعر غير صالح");
            return { item, product, v, unit, total: unit.mul(item.quantity) };
          });
          for (const l of lines) {
            if (!l.product.trackInventory) continue;
            const result = l.v
              ? await tx.productVariant.updateMany({
                  where: {
                    storeId: c.storeId,
                    id: l.v.id,
                    isAvailable: true,
                    stockQuantity: { gte: l.item.quantity },
                  },
                  data: { stockQuantity: { decrement: l.item.quantity } },
                })
              : await tx.product.updateMany({
                  where: {
                    storeId: c.storeId,
                    id: l.product.id,
                    stockQuantity: { gte: l.item.quantity },
                  },
                  data: { stockQuantity: { decrement: l.item.quantity } },
                });
            if (result.count !== 1)
              throw new AppError(
                409,
                "OUT_OF_STOCK",
                `${l.product.name} نفد من المخزون`,
              );
          }
          const subtotal = lines.reduce(
              (s, l) => s.add(l.total),
              new Prisma.Decimal(0),
            ),
            deliveryValue =
              input.deliveryType === "DESK"
                ? delivery.deskPrice
                : delivery.homePrice;
          if (deliveryValue == null)
            throw new AppError(
              422,
              "DELIVERY_TYPE_UNAVAILABLE",
              "نوع التوصيل غير متوفر",
            );
          const prior = await tx.lead.findFirst({
              where: {
                storeId: c.storeId,
                conversationId: c.conversationId,
                phone: input.phone,
              },
            }),
            lead = prior
              ? await tx.lead.update({
                  where: { id: prior.id },
                  data: {
                    fullName: input.fullName,
                    wilayaCode: input.wilayaCode,
                    wilayaName: wilaya,
                    municipality: input.municipality,
                    status: "CONVERTED",
                  },
                })
              : await tx.lead.create({
                  data: {
                    storeId: c.storeId,
                    channelId: c.channelId,
                    conversationId: c.conversationId,
                    fullName: input.fullName,
                    phone: input.phone,
                    wilayaCode: input.wilayaCode,
                    wilayaName: wilaya,
                    municipality: input.municipality,
                    status: "CONVERTED",
                  },
                });
          const fee = new Prisma.Decimal(deliveryValue),
            order = await tx.order.create({
              data: {
                storeId: c.storeId,
                channelId: c.channelId,
                conversationId: c.conversationId,
                leadId: lead.id,
                orderNumber: number(),
                idempotencyKey: c.idempotencyKey,
                fullName: input.fullName,
                phone: input.phone,
                wilayaCode: input.wilayaCode,
                wilayaName: wilaya,
                municipality: input.municipality,
                deliveryType: input.deliveryType,
                subtotal,
                deliveryPrice: fee,
                totalAmount: subtotal.add(fee),
                currency: store.currency,
              },
            });
          await tx.orderItem.createMany({
            data: lines.map((l) => ({
              storeId: c.storeId,
              orderId: order.id,
              productId: l.product.id,
              variantId: l.v?.id ?? null,
              productNameSnapshot: l.product.name,
              variantSnapshot: l.v
                ? [l.v.size, l.v.color].filter(Boolean).join(" / ")
                : null,
              skuSnapshot: l.v?.sku ?? l.product.sku,
              unitPrice: l.unit,
              quantity: l.item.quantity,
              lineTotal: l.total,
            })),
          });
          return pub(order);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
  throw new AppError(409, "ORDER_CONFLICT", "تعارض مؤقت");
}
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  CAPTURED: ["CONFIRMED", "CANCELED"],
  CONFIRMED: ["PACKING", "SHIPPED", "CANCELED"],
  PACKING: ["SHIPPED", "CANCELED"],
  SHIPPED: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELED: [],
  RETURNED: [],
};
export const canTransitionOrder = (from: OrderStatus, to: OrderStatus) =>
  from === to || transitions[from].includes(to);
export async function transitionOrderStatus(
  storeId: string,
  id: string,
  next: OrderStatus,
) {
  return systemDb.$transaction(
    async (tx) => {
      const o = await tx.order.findFirst({
        where: { id, storeId },
        include: {
          items: { include: { product: { select: { trackInventory: true } } } },
        },
      });
      if (!o) throw new AppError(404, "ORDER_NOT_FOUND", "الطلبية غير موجودة");
      if (!canTransitionOrder(o.status, next))
        throw new AppError(
          409,
          "INVALID_ORDER_TRANSITION",
          `لا يمكن نقل ${o.status} إلى ${next}`,
        );
      if (o.status === next) return o;
      const claim = await tx.order.updateMany({
        where: { id, storeId, status: o.status },
        data: { status: next },
      });
      if (claim.count !== 1)
        throw new AppError(409, "ORDER_CHANGED", "تغيرت الطلبية");
      if (next === "CANCELED")
        for (const item of o.items) {
          if (!item.product.trackInventory) continue;
          if (item.variantId) {
            const r = await tx.productVariant.updateMany({
              where: { id: item.variantId, storeId, productId: item.productId },
              data: { stockQuantity: { increment: item.quantity } },
            });
            if (r.count !== 1)
              throw new AppError(409, "VARIANT_MISSING", "خيار المنتج محذوف");
          } else
            await tx.product.update({
              where: { id: item.productId },
              data: { stockQuantity: { increment: item.quantity } },
            });
        }
      return tx.order.findUniqueOrThrow({ where: { id } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}
