import { ConnectorType, Prisma, ShippingProvider } from "@prisma/client";
import { z } from "zod";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { decryptJson } from "../security.js";
const yc = z.object({ apiId: z.string().min(1), apiToken: z.string().min(1) }),
  yconf = z.object({
    baseUrl: z.url().default("https://api.yalidine.app/v1"),
    fromWilayaName: z.string().min(1),
    senderName: z.string().min(1),
    senderPhone: z.string().min(8),
    senderAddress: z.string().min(2),
  }),
  zc = z.object({ apiToken: z.string().min(1), apiId: z.string().optional() }),
  zconf = z.object({
    baseUrl: z.url(),
    createPath: z.string().startsWith("/").default("/api/orders"),
    senderName: z.string().min(1),
    senderPhone: z.string().min(8),
    senderAddress: z.string().min(2),
  });
async function parse(r: Response) {
  const t = await r.text();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return { raw: t.slice(0, 2000) };
  }
}
export async function dispatchOrder(
  storeId: string,
  orderId: string,
  provider: ShippingProvider,
) {
  const type: ConnectorType =
      provider === "YALIDINE" ? "YALIDINE" : "ZR_EXPRESS",
    [connector, order] = await Promise.all([
      systemDb.connector.findUnique({
        where: { storeId_type: { storeId, type } },
      }),
      systemDb.order.findFirst({
        where: { id: orderId, storeId },
        include: { items: true, dispatches: true },
      }),
    ]);
  if (!connector?.enabled)
    throw new AppError(422, "CONNECTOR_DISABLED", "ربط الشحن غير مفعّل");
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "الطلبية غير موجودة");
  const old = order.dispatches[0];
  if (old?.status === "ACCEPTED") {
    if (old.provider !== provider)
      throw new AppError(
        409,
        "ALREADY_DISPATCHED",
        `مرسلة عبر ${old.provider}`,
      );
    if (order.status !== "SHIPPED")
      await systemDb.order.update({
        where: { id: order.id },
        data: { status: "SHIPPED" },
      });
    return old;
  }
  if (old && old.provider !== provider && old.status !== "FAILED")
    throw new AppError(409, "DISPATCH_IN_PROGRESS", "إرسال آخر قيد المعالجة");
  if (order.status !== "CONFIRMED" && order.status !== "PACKING")
    throw new AppError(409, "ORDER_NOT_READY", "أكد الطلبية قبل الشحن");
  const common = {
      reference: order.orderNumber,
      customer: {
        fullName: order.fullName,
        phone: order.phone,
        wilayaCode: order.wilayaCode,
        wilayaName: order.wilayaName,
        municipality: order.municipality,
      },
      deliveryType: order.deliveryType,
      amountToCollect: Number(order.totalAmount),
      products: order.items
        .map(
          (i) =>
            `${i.productNameSnapshot}${i.variantSnapshot ? ` (${i.variantSnapshot})` : ""} x${i.quantity}`,
        )
        .join(", "),
    },
    pending = old
      ? await systemDb.shippingDispatch.update({
          where: { id: old.id },
          data: {
            provider,
            status: "PENDING",
            lastError: null,
            requestPayload: common,
          },
        })
      : await systemDb.shippingDispatch.create({
          data: { storeId, orderId, provider, requestPayload: common },
        });
  try {
    let r: Response;
    if (provider === "YALIDINE") {
      const c = yc.parse(decryptJson(connector.credentialsEncrypted)),
        cfg = yconf.parse(connector.config);
      r = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/parcels/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-API-ID": c.apiId,
          "X-API-TOKEN": c.apiToken,
        },
        body: JSON.stringify([
          {
            order_id: order.orderNumber,
            from_wilaya_name: cfg.fromWilayaName,
            firstname: order.fullName.split(" ")[0],
            familyname:
              order.fullName.split(" ").slice(1).join(" ") || "Client",
            contact_phone: order.phone,
            address: order.municipality,
            to_commune_name: order.municipality,
            to_wilaya_name: order.wilayaName,
            product_list: common.products,
            price: Number(order.totalAmount),
            freeshipping: false,
            is_stopdesk: order.deliveryType === "DESK",
            has_exchange: false,
          },
        ]),
      });
    } else {
      const c = zc.parse(decryptJson(connector.credentialsEncrypted)),
        cfg = zconf.parse(connector.config);
      r = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${cfg.createPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.apiToken}`,
          ...(c.apiId ? { "x-api-id": c.apiId } : {}),
        },
        body: JSON.stringify({
          orderId: order.orderNumber,
          recipient: common.customer,
          deliveryType: order.deliveryType,
          productDescription: common.products,
          codAmount: Number(order.totalAmount),
          sender: {
            name: cfg.senderName,
            phone: cfg.senderPhone,
            address: cfg.senderAddress,
          },
        }),
      });
    }
    const p = await parse(r);
    if (!r.ok)
      throw new AppError(
        502,
        "SHIPPING_REJECTED",
        String(p.message ?? p.error ?? "شركة الشحن رفضت"),
      );
    const tracking = String(
        p.tracking ?? p.tracking_number ?? p.trackingNumber ?? p.id ?? "",
      ),
      accepted = await systemDb.shippingDispatch.update({
        where: { id: pending.id },
        data: {
          status: "ACCEPTED",
          responsePayload: p as Prisma.InputJsonValue,
          trackingNumber: tracking || null,
          externalId: String((p.id ?? tracking) || order.orderNumber),
        },
      });
    await systemDb.order.update({
      where: { id: order.id },
      data: { status: "SHIPPED" },
    });
    return accepted;
  } catch (e) {
    await systemDb.shippingDispatch.update({
      where: { id: pending.id },
      data: {
        status: "FAILED",
        lastError: e instanceof Error ? e.message.slice(0, 1000) : "failed",
      },
    });
    throw e;
  }
}
export async function syncOrdersToGoogleSheets(storeId: string) {
  const c = await systemDb.connector.findUnique({
    where: { storeId_type: { storeId, type: "GOOGLE_SHEETS" } },
  });
  if (!c?.enabled)
    throw new AppError(422, "SHEETS_DISABLED", "Google Sheets غير مفعّل");
  const x = z
      .object({ webhookUrl: z.url(), secret: z.string().min(12) })
      .parse(decryptJson(c.credentialsEncrypted)),
    orders = await systemDb.order.findMany({
      where: { storeId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    rows = orders.map((o) => ({
      orderNumber: o.orderNumber,
      createdAt: o.createdAt.toISOString(),
      fullName: o.fullName,
      phone: o.phone,
      wilaya: `${o.wilayaCode} - ${o.wilayaName}`,
      municipality: o.municipality,
      products: o.items
        .map((i) => `${i.productNameSnapshot} x${i.quantity}`)
        .join(", "),
      subtotal: o.subtotal.toFixed(2),
      delivery: o.deliveryPrice.toFixed(2),
      total: o.totalAmount.toFixed(2),
      status: o.status,
    })),
    r = await fetch(x.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "orders.sync",
        storeId,
        secret: x.secret,
        rows,
      }),
    });
  if (!r.ok) throw new AppError(502, "SHEETS_SYNC_FAILED", "فشلت المزامنة");
  return { synced: rows.length };
}
