import { Router } from "express";
import {
  Prisma,
  type ConnectorType,
  type ShippingProvider,
} from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../auth.js";
import { systemDb, withTenant } from "../db.js";
import { AppError } from "../errors.js";
import {
  cloudWhatsAppSchema,
  connectorSchema,
  orderStatusSchema,
  productSchema,
  settingsSchema,
} from "../schemas.js";
import { encryptJson } from "../security.js";
import {
  dispatchOrder,
  syncOrdersToGoogleSheets,
} from "../services/shipping.js";
import { transitionOrderStatus } from "../services/orders.js";
import { WILAYAS, wilayaName } from "../wilayas.js";
import { cacheRedis } from "../queues.js";
import { env } from "../config.js";
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

const DAY_MS = 86_400_000;
const ALGIERS_OFFSET_MS = 60 * 60 * 1000;

function startOfAlgiersDay(date = new Date()) {
  const shifted = new Date(date.getTime() + ALGIERS_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - ALGIERS_OFFSET_MS);
}

function algiersDateKey(date: Date) {
  return new Date(date.getTime() + ALGIERS_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

dashboardRouter.get("/stats", async (req, res) => {
  const s = req.auth!.storeId;
  res.json(
    await withTenant(s, async (tx) => {
      const todayStart = startOfAlgiersDay();
      const sevenDayStart = new Date(todayStart.getTime() - 6 * DAY_MS);
      const thirtyDayStart = new Date(todayStart.getTime() - 29 * DAY_MS);
      type DailyAggregate = {
        day: string;
        orders: number;
        revenue: Prisma.Decimal;
      };

      const [
        products,
        channels,
        openOrders,
        todayOrders,
        revenue,
        dailyAggregates,
        statusGroups,
        channelOrders,
        channelMessages,
        channelDirectory,
        recentOrders,
      ] = await Promise.all([
        tx.product.count({ where: { storeId: s, status: "ACTIVE" } }),
        tx.channel.count({ where: { storeId: s, status: "CONNECTED" } }),
        tx.order.count({
          where: {
            storeId: s,
            status: { in: ["CAPTURED", "CONFIRMED", "PACKING"] },
          },
        }),
        tx.order.count({
          where: {
            storeId: s,
            createdAt: { gte: todayStart },
          },
        }),
        tx.order.aggregate({
          where: { storeId: s, status: { notIn: ["CANCELED", "RETURNED"] } },
          _sum: { totalAmount: true },
        }),
        tx.$queryRaw<DailyAggregate[]>`
            SELECT
              to_char("createdAt" AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders,
              COALESCE(
                SUM(
                  CASE
                    WHEN status NOT IN ('CANCELED', 'RETURNED') THEN "totalAmount"
                    ELSE 0
                  END
                ),
                0
              ) AS revenue
            FROM "Order"
            WHERE "storeId" = ${s}::uuid
              AND "createdAt" >= ${sevenDayStart}
            GROUP BY 1
            ORDER BY 1
          `,
        tx.order.groupBy({
          by: ["status"],
          where: { storeId: s },
          _count: { _all: true },
        }),
        tx.order.groupBy({
          by: ["channelId"],
          where: { storeId: s, createdAt: { gte: thirtyDayStart } },
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        tx.message.groupBy({
          by: ["channelId"],
          where: {
            storeId: s,
            direction: "INBOUND",
            createdAt: { gte: thirtyDayStart },
          },
          _count: { _all: true },
        }),
        tx.channel.findMany({
          where: { storeId: s },
          select: { id: true, name: true, type: true, status: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.order.findMany({
          where: { storeId: s },
          select: {
            id: true,
            orderNumber: true,
            fullName: true,
            wilayaName: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            channel: { select: { name: true, type: true } },
            items: {
              select: { productNameSnapshot: true, quantity: true },
              take: 2,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

      const dailyByDate = new Map(dailyAggregates.map((row) => [row.day, row]));
      const daily = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(sevenDayStart.getTime() + index * DAY_MS);
        const key = algiersDateKey(date);
        const row = dailyByDate.get(key);
        return {
          date: key,
          orders: row?.orders ?? 0,
          revenue: row?.revenue.toFixed(2) ?? "0.00",
        };
      });
      const ordersByChannel = new Map(
        channelOrders.map((row) => [row.channelId, row]),
      );
      const messagesByChannel = new Map(
        channelMessages.map((row) => [row.channelId, row._count._all]),
      );

      return {
        products,
        channels,
        openOrders,
        todayOrders,
        revenue: revenue._sum.totalAmount?.toFixed(2) ?? "0.00",
        analytics: {
          daily,
          orderStatuses: statusGroups.map((row) => ({
            status: row.status,
            count: row._count._all,
          })),
          channels: channelDirectory.map((channel) => {
            const orderData = ordersByChannel.get(channel.id);
            const orders = orderData?._count._all ?? 0;
            const messages = messagesByChannel.get(channel.id) ?? 0;
            return {
              id: channel.id,
              name: channel.name,
              type: channel.type,
              status: channel.status,
              messages,
              orders,
              revenue: orderData?._sum.totalAmount?.toFixed(2) ?? "0.00",
              conversionRate:
                messages > 0
                  ? Math.min(100, Math.round((orders / messages) * 100))
                  : 0,
            };
          }),
          recentOrders,
        },
      };
    }),
  );
});
dashboardRouter.get("/products", async (req, res) => {
  const s = req.auth!.storeId;
  res.json({
    products: await withTenant(s, (tx) =>
      tx.product.findMany({
        where: {
          storeId: s,
          status:
            req.query.archived === "true" ? undefined : { not: "ARCHIVED" },
        },
        include: { variants: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
      }),
    ),
  });
});
dashboardRouter.post("/products", requireRole("ADMIN"), async (req, res) => {
  const s = req.auth!.storeId,
    i = productSchema.parse(req.body),
    p = await withTenant(s, (tx) =>
      tx.product.create({
        data: {
          storeId: s,
          sku: i.sku,
          name: i.name,
          description: i.description,
          basePrice: i.basePrice,
          promoPrice: i.promoPrice ?? null,
          status: i.status,
          trackInventory: i.trackInventory,
          stockQuantity: i.stockQuantity,
          images: i.images,
          variants: {
            create: i.variants.map((v) => ({
              storeId: s,
              sku: v.sku,
              size: v.size ?? null,
              color: v.color ?? null,
              priceDelta: v.priceDelta,
              stockQuantity: v.stockQuantity,
              isAvailable: v.isAvailable,
            })),
          },
        },
        include: { variants: true },
      }),
    );
  res.status(201).json({ product: p });
});
dashboardRouter.put("/products/:id", requireRole("ADMIN"), async (req, res) => {
  const s = req.auth!.storeId,
    id = z.uuid().parse(req.params.id),
    i = productSchema.parse(req.body),
    p = await withTenant(s, async (tx) => {
      if (!(await tx.product.findFirst({ where: { id, storeId: s } })))
        throw new AppError(404, "PRODUCT_NOT_FOUND", "المنتج غير موجود");
      const kept = i.variants.flatMap((v) => (v.id ? [v.id] : []));
      await tx.productVariant.updateMany({
        where: { storeId: s, productId: id, id: { notIn: kept } },
        data: { isAvailable: false, stockQuantity: 0 },
      });
      for (const v of i.variants) {
        const data = {
          sku: v.sku,
          size: v.size ?? null,
          color: v.color ?? null,
          priceDelta: v.priceDelta,
          stockQuantity: v.stockQuantity,
          isAvailable: v.isAvailable,
        };
        if (v.id) {
          const r = await tx.productVariant.updateMany({
            where: { id: v.id, storeId: s, productId: id },
            data,
          });
          if (!r.count)
            throw new AppError(422, "INVALID_VARIANT", "خيار غير صالح");
        } else
          await tx.productVariant.create({
            data: { ...data, storeId: s, productId: id },
          });
      }
      return tx.product.update({
        where: { id },
        data: {
          sku: i.sku,
          name: i.name,
          description: i.description,
          basePrice: i.basePrice,
          promoPrice: i.promoPrice ?? null,
          status: i.status,
          trackInventory: i.trackInventory,
          stockQuantity: i.stockQuantity,
          images: i.images,
        },
        include: { variants: true },
      });
    });
  res.json({ product: p });
});
dashboardRouter.delete(
  "/products/:id",
  requireRole("ADMIN"),
  async (req, res) => {
    const s = req.auth!.storeId,
      id = z.uuid().parse(req.params.id),
      r = await withTenant(s, (tx) =>
        tx.product.updateMany({
          where: { id, storeId: s },
          data: { status: "ARCHIVED", stockQuantity: 0 },
        }),
      );
    if (!r.count)
      throw new AppError(404, "PRODUCT_NOT_FOUND", "المنتج غير موجود");
    res.status(204).end();
  },
);
dashboardRouter.get("/settings", async (req, res) => {
  const s = req.auth!.storeId;
  res.json(
    await withTenant(s, async (tx) => {
      const [rules, deliveryRates] = await Promise.all([
        tx.merchantRules.findUnique({ where: { storeId: s } }),
        tx.deliveryRate.findMany({
          where: { storeId: s },
          orderBy: { wilayaCode: "asc" },
        }),
      ]);
      return { rules, deliveryRates, wilayas: WILAYAS };
    }),
  );
});
dashboardRouter.put("/settings", requireRole("ADMIN"), async (req, res) => {
  const s = req.auth!.storeId,
    i = settingsSchema.parse(req.body);
  await withTenant(s, async (tx) => {
    await tx.merchantRules.upsert({
      where: { storeId: s },
      update: {
        generalRules: i.generalRules,
        exchangePolicy: i.exchangePolicy,
        specialOffers: i.specialOffers,
        fallbackMessage: i.fallbackMessage,
      },
      create: {
        storeId: s,
        generalRules: i.generalRules,
        exchangePolicy: i.exchangePolicy,
        specialOffers: i.specialOffers,
        fallbackMessage: i.fallbackMessage,
      },
    });
    for (const r of i.deliveryRates) {
      const n = wilayaName(r.wilayaCode);
      if (n)
        await tx.deliveryRate.upsert({
          where: {
            storeId_wilayaCode: { storeId: s, wilayaCode: r.wilayaCode },
          },
          update: {
            wilayaName: n,
            homePrice: r.homePrice,
            deskPrice: r.deskPrice ?? null,
            enabled: r.enabled,
          },
          create: {
            storeId: s,
            wilayaCode: r.wilayaCode,
            wilayaName: n,
            homePrice: r.homePrice,
            deskPrice: r.deskPrice ?? null,
            enabled: r.enabled,
          },
        });
    }
  });
  res.json({ ok: true });
});
dashboardRouter.get("/channels", async (req, res) => {
  const s = req.auth!.storeId;
  res.json({
    channels: await withTenant(s, (tx) =>
      tx.channel.findMany({
        where: { storeId: s },
        select: {
          id: true,
          type: true,
          name: true,
          status: true,
          externalAccountId: true,
          lastConnectedAt: true,
          lastError: true,
          createdAt: true,
          whatsappSession: {
            select: {
              status: true,
              qrCodeDataUrl: true,
              qrExpiresAt: true,
              phoneJid: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ),
  });
});
dashboardRouter.post(
  "/channels/whatsapp/cloud",
  requireRole("ADMIN"),
  async (req, res) => {
    const s = req.auth!.storeId,
      i = cloudWhatsAppSchema.parse(req.body),
      old = await systemDb.channel.findUnique({
        where: {
          type_externalAccountId: {
            type: "WHATSAPP_CLOUD",
            externalAccountId: i.phoneNumberId,
          },
        },
      });
    if (old && old.storeId !== s)
      throw new AppError(
        409,
        "CHANNEL_ALREADY_LINKED",
        "الرقم مربوط بمتجر آخر",
      );
    const data = {
        storeId: s,
        type: "WHATSAPP_CLOUD" as const,
        name: i.name,
        externalAccountId: i.phoneNumberId,
        externalBusinessId: i.wabaId,
        credentialsEncrypted: encryptJson({
          accessToken: i.accessToken,
          phoneNumberId: i.phoneNumberId,
          wabaId: i.wabaId,
        }),
        status: "CONNECTED" as const,
        lastConnectedAt: new Date(),
        lastError: null,
      },
      c = old
        ? await systemDb.channel.update({ where: { id: old.id }, data })
        : await systemDb.channel.create({ data });
    res.status(201).json({
      channel: { id: c.id, name: c.name, type: c.type, status: c.status },
    });
  },
);
dashboardRouter.post(
  "/channels/whatsapp/baileys",
  requireRole("ADMIN"),
  async (req, res) => {
    if (!env.ENABLE_BAILEYS)
      throw new AppError(
        503,
        "BAILEYS_DISABLED",
        "ربط QR غير متاح على الاستضافة المجانية؛ استعمل WhatsApp Cloud API",
      );
    const { createBaileysChannel } = await import("../services/baileys.js");
    const s = req.auth!.storeId,
      name = z
        .object({ name: z.string().min(2).max(100) })
        .parse(req.body).name,
      r = await createBaileysChannel(s, name);
    await cacheRedis.publish(
      "whatsapp-control",
      JSON.stringify({ action: "start", channelId: r.channel.id }),
    );
    res.status(201).json({ channel: r.channel });
  },
);
dashboardRouter.post(
  "/channels/:id/disconnect",
  requireRole("ADMIN"),
  async (req, res) => {
    const s = req.auth!.storeId,
      id = z.uuid().parse(req.params.id),
      c = await systemDb.channel.findFirst({ where: { id, storeId: s } });
    if (!c) throw new AppError(404, "CHANNEL_NOT_FOUND", "القناة غير موجودة");
    await systemDb.channel.update({
      where: { id },
      data: { status: "DISCONNECTED" },
    });
    if (c.type === "WHATSAPP_BAILEYS" && env.ENABLE_BAILEYS)
      await cacheRedis.publish(
        "whatsapp-control",
        JSON.stringify({ action: "stop", channelId: id }),
      );
    res.json({ ok: true });
  },
);
dashboardRouter.get("/orders", async (req, res) => {
  const s = req.auth!.storeId,
    page = Math.max(1, Number(req.query.page ?? 1)),
    size = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 30))),
    status =
      typeof req.query.status === "string" && req.query.status !== "ALL"
        ? z
            .enum([
              "CAPTURED",
              "CONFIRMED",
              "PACKING",
              "SHIPPED",
              "DELIVERED",
              "CANCELED",
              "RETURNED",
            ])
            .parse(req.query.status)
        : undefined;
  res.json(
    await withTenant(s, async (tx) => {
      const where: Prisma.OrderWhereInput = {
          storeId: s,
          ...(status ? { status } : {}),
        },
        [orders, total] = await Promise.all([
          tx.order.findMany({
            where,
            include: { items: true, dispatches: true },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * size,
            take: size,
          }),
          tx.order.count({ where }),
        ]);
      return { orders, total, page, pageSize: size };
    }),
  );
});
dashboardRouter.patch(
  "/orders/:id/status",
  requireRole("AGENT"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      { status } = orderStatusSchema.parse(req.body);
    res.json({
      order: await transitionOrderStatus(req.auth!.storeId, id, status),
    });
  },
);
const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
dashboardRouter.get("/orders/export.csv", async (req, res) => {
  const s = req.auth!.storeId,
    orders = await withTenant(s, (tx) =>
      tx.order.findMany({
        where: { storeId: s },
        include: { items: true },
        orderBy: { createdAt: "desc" },
        take: 10000,
      }),
    ),
    rows = orders.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString(),
      o.fullName,
      o.phone,
      `${o.wilayaCode} - ${o.wilayaName}`,
      o.municipality,
      o.items.map((i) => `${i.productNameSnapshot} x${i.quantity}`).join("; "),
      o.subtotal,
      o.deliveryPrice,
      o.totalAmount,
      o.status,
    ]),
    csv = `\uFEFF${[["Order", "Date", "Name", "Phone", "Wilaya", "Municipality", "Products", "Subtotal", "Delivery", "Total", "Status"], ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}`;
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="amigo-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});
dashboardRouter.post(
  "/orders/sync/google-sheets",
  requireRole("ADMIN"),
  async (req, res) =>
    res.json(await syncOrdersToGoogleSheets(req.auth!.storeId)),
);
dashboardRouter.post(
  "/orders/:id/dispatch",
  requireRole("AGENT"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      provider = z
        .object({ provider: z.enum(["YALIDINE", "ZR_EXPRESS"]) })
        .parse(req.body).provider as ShippingProvider;
    res.json({
      dispatch: await dispatchOrder(req.auth!.storeId, id, provider),
    });
  },
);
dashboardRouter.get("/connectors", async (req, res) => {
  const s = req.auth!.storeId;
  res.json({
    connectors: await withTenant(s, (tx) =>
      tx.connector.findMany({
        where: { storeId: s },
        select: {
          id: true,
          type: true,
          name: true,
          enabled: true,
          config: true,
          lastError: true,
          updatedAt: true,
        },
      }),
    ),
  });
});
dashboardRouter.put(
  "/connectors/:type",
  requireRole("ADMIN"),
  async (req, res) => {
    const s = req.auth!.storeId,
      type = z
        .enum(["GOOGLE_SHEETS", "YALIDINE", "ZR_EXPRESS"])
        .parse(req.params.type) as ConnectorType,
      i = connectorSchema.parse({ ...req.body, type }),
      c = await withTenant(s, (tx) =>
        tx.connector.upsert({
          where: { storeId_type: { storeId: s, type } },
          update: {
            name: i.name,
            enabled: i.enabled,
            credentialsEncrypted: encryptJson(i.credentials),
            config: i.config as Prisma.InputJsonValue,
            lastError: null,
          },
          create: {
            storeId: s,
            type,
            name: i.name,
            enabled: i.enabled,
            credentialsEncrypted: encryptJson(i.credentials),
            config: i.config as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            type: true,
            name: true,
            enabled: true,
            config: true,
            updatedAt: true,
          },
        }),
      );
    res.json({ connector: c });
  },
);
