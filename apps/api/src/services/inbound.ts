import { Prisma, type Channel } from "@prisma/client";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { buildMerchantSystemPrompt } from "../prompt.js";
import { dispatchOutbound } from "./messaging.js";
import { transcribeMetaVoice } from "./media-intelligence.js";
import { runMerchantAgent } from "./xai.js";

export type NormalizedInbound = {
  externalMessageId: string;
  customerExternalId: string;
  customerName?: string;
  text: string;
  timestamp: string;
  rawType?: string;
  mediaUrl?: string;
};

async function deliver(c: Channel, to: string, text: string, id: string) {
  const claim = await systemDb.message.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "PROCESSING", error: null },
  });
  if (!claim.count) return;
  try {
    if (c.type === "WHATSAPP_BAILEYS") {
      await systemDb.message.update({
        where: { id },
        data: { status: "QUEUED", payload: { transport: "baileys-queue" } },
      });
      await dispatchOutbound(c, to, text, id);
      return;
    }
    const r = await dispatchOutbound(c, to, text, id);
    await systemDb.message.update({
      where: { id },
      data: {
        status: "SENT",
        externalMessageId: r.externalMessageId,
        processedAt: new Date(),
      },
    });
  } catch (e) {
    await systemDb.message.update({
      where: { id },
      data: {
        status: "QUEUED",
        error: e instanceof Error ? e.message.slice(0, 1000) : "send failed",
      },
    });
    throw e;
  }
}

export async function processInboundEvent(eventId: string) {
  const claim = await systemDb.webhookEvent.updateMany({
    where: { id: eventId, status: { in: ["RECEIVED", "FAILED"] } },
    data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
  });
  if (!claim.count) return;
  try {
    const e = await systemDb.webhookEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    if (!e.storeId || !e.channelId)
      throw new AppError(422, "UNROUTED_EVENT", "لم نحدد المتجر");
    const p = e.payload as unknown as NormalizedInbound;
    if (!p.externalMessageId || !p.customerExternalId || !p.text?.trim()) {
      await systemDb.webhookEvent.update({
        where: { id: eventId },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return;
    }

    const channel = await systemDb.channel.findFirstOrThrow({
      where: { id: e.channelId, storeId: e.storeId },
    });
    let inboundText = p.text.trim();
    if (p.rawType === "audio" && p.mediaUrl) {
      const transcript = await transcribeMetaVoice(channel, p.mediaUrl);
      inboundText = transcript?.trim()
        ? transcript.trim()
        : "الزبون أرسل رسالة صوتية، لكن الصوت لم يتحول إلى نص. اطلب منه باختصار إعادة الصوت أو كتابة طلبه.";
    }

    const conv = await systemDb.conversation.upsert({
      where: {
        storeId_channelId_customerExternalId: {
          storeId: e.storeId,
          channelId: e.channelId,
          customerExternalId: p.customerExternalId,
        },
      },
      update: {
        lastMessageAt: new Date(p.timestamp),
        customerName: p.customerName,
      },
      create: {
        storeId: e.storeId,
        channelId: e.channelId,
        customerExternalId: p.customerExternalId,
        customerName: p.customerName,
        lastMessageAt: new Date(p.timestamp),
      },
    });
    if (conv.status === "HANDOFF" || conv.status === "BLOCKED") {
      await systemDb.webhookEvent.update({
        where: { id: eventId },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return;
    }

    const enrichedPayload = {
      ...p,
      ...(p.rawType === "audio" ? { transcribedText: inboundText } : {}),
    } as Prisma.InputJsonValue;
    try {
      await systemDb.message.create({
        data: {
          storeId: e.storeId,
          conversationId: conv.id,
          channelId: e.channelId,
          externalMessageId: p.externalMessageId,
          sourceEventId: e.id,
          direction: "INBOUND",
          role: "USER",
          content: inboundText,
          payload: enrichedPayload,
          status: "RECEIVED",
        },
      });
    } catch (err) {
      if (
        !(
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        )
      )
        throw err;
    }

    const [store, rules, products, rates, hist, recent] = await Promise.all([
      systemDb.store.findUniqueOrThrow({
        where: { id: e.storeId },
        include: { subscription: true },
      }),
      systemDb.merchantRules.findUnique({ where: { storeId: e.storeId } }),
      systemDb.product.findMany({
        where: { storeId: e.storeId, status: "ACTIVE" },
        include: { variants: { orderBy: { createdAt: "asc" } } },
        take: 500,
      }),
      systemDb.deliveryRate.findMany({
        where: { storeId: e.storeId, enabled: true },
        orderBy: { wilayaCode: "asc" },
      }),
      systemDb.message.findMany({
        where: {
          storeId: e.storeId,
          conversationId: conv.id,
          role: { in: ["USER", "ASSISTANT"] },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { role: true, content: true },
      }),
      systemDb.order.findFirst({
        where: {
          storeId: e.storeId,
          conversationId: conv.id,
          status: { in: ["CAPTURED", "CONFIRMED", "PACKING"] },
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        orderBy: { createdAt: "desc" },
        select: { orderNumber: true, status: true, createdAt: true },
      }),
    ]);
    const sub = store.subscription;
    if (
      !sub ||
      !(sub.status === "ACTIVE" || sub.status === "TRIALING") ||
      sub.currentPeriodEnd <= new Date()
    ) {
      await systemDb.webhookEvent.update({
        where: { id: e.id },
        data: {
          status: "IGNORED",
          processedAt: new Date(),
          lastError: "subscription inactive",
        },
      });
      return;
    }

    const prompt = buildMerchantSystemPrompt({
      storeName: store.name,
      currency: store.currency,
      generalRules: rules?.generalRules ?? "",
      exchangePolicy: rules?.exchangePolicy ?? "",
      specialOffers: rules?.specialOffers ?? "",
      products: products.map((x) => ({
        id: x.id,
        sku: x.sku,
        name: x.name,
        description: x.description,
        basePrice: x.basePrice.toFixed(2),
        promoPrice: x.promoPrice?.toFixed(2) ?? null,
        stockQuantity: x.stockQuantity,
        trackInventory: x.trackInventory,
        variants: x.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          priceDelta: v.priceDelta.toFixed(2),
          stockQuantity: v.stockQuantity,
          isAvailable: v.isAvailable,
        })),
      })),
      deliveryRates: rates.map((r) => ({
        wilayaCode: r.wilayaCode,
        wilayaName: r.wilayaName,
        homePrice: r.homePrice.toFixed(2),
        deskPrice: r.deskPrice?.toFixed(2) ?? null,
      })),
      recentOrder: recent
        ? {
            orderNumber: recent.orderNumber,
            status: recent.status,
            createdAt: recent.createdAt.toISOString(),
          }
        : undefined,
    });
    const result = await runMerchantAgent({
      storeId: e.storeId,
      channelId: e.channelId,
      conversationId: conv.id,
      eventId: e.id,
      systemPrompt: prompt,
      history: hist.reverse().map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    });
    const out = await systemDb.message.upsert({
      where: {
        storeId_sourceEventId_direction: {
          storeId: e.storeId,
          sourceEventId: e.id,
          direction: "OUTBOUND",
        },
      },
      update: {},
      create: {
        storeId: e.storeId,
        conversationId: conv.id,
        channelId: e.channelId,
        sourceEventId: e.id,
        direction: "OUTBOUND",
        role: "ASSISTANT",
        content: result.text,
        payload: result.order ? { orderId: result.order.id } : {},
        status: "QUEUED",
      },
    });
    await deliver(channel, p.customerExternalId, out.content, out.id);
    await systemDb.$transaction([
      systemDb.message.updateMany({
        where: {
          storeId: e.storeId,
          sourceEventId: e.id,
          direction: "INBOUND",
        },
        data: { processedAt: new Date() },
      }),
      systemDb.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date() },
      }),
      systemDb.webhookEvent.update({
        where: { id: e.id },
        data: { status: "COMPLETED", processedAt: new Date(), lastError: null },
      }),
    ]);
  } catch (err) {
    await systemDb.webhookEvent
      .update({
        where: { id: eventId },
        data: {
          status: "FAILED",
          lastError:
            err instanceof Error ? err.message.slice(0, 1000) : "unknown",
        },
      })
      .catch(() => {});
    throw err;
  }
}

export async function sendFallbackForEvent(id: string) {
  const e = await systemDb.webhookEvent.findUnique({ where: { id } });
  if (!e?.storeId || !e.channelId) return;
  const p = e.payload as unknown as NormalizedInbound;
  const conv = await systemDb.conversation.findUnique({
    where: {
      storeId_channelId_customerExternalId: {
        storeId: e.storeId,
        channelId: e.channelId,
        customerExternalId: p.customerExternalId,
      },
    },
  });
  if (!conv) return;
  const [channel, rules] = await Promise.all([
    systemDb.channel.findUniqueOrThrow({ where: { id: e.channelId } }),
    systemDb.merchantRules.findUnique({ where: { storeId: e.storeId } }),
  ]);
  const old = await systemDb.message.findUnique({
    where: {
      storeId_sourceEventId_direction: {
        storeId: e.storeId,
        sourceEventId: e.id,
        direction: "OUTBOUND",
      },
    },
  });
  if (
    old?.status === "SENT" ||
    (old?.payload &&
      typeof old.payload === "object" &&
      !Array.isArray(old.payload) &&
      (old.payload as Record<string, unknown>).transport === "baileys-queue")
  )
    return;
  const text = rules?.fallbackMessage ?? "سمحلي، صرا مشكل تقني صغير.";
  const out =
    old ??
    (await systemDb.message.create({
      data: {
        storeId: e.storeId,
        channelId: e.channelId,
        conversationId: conv.id,
        sourceEventId: e.id,
        direction: "OUTBOUND",
        role: "ASSISTANT",
        content: text,
        status: "QUEUED",
        payload: { fallback: true },
      },
    }));
  if (out.status === "PROCESSING")
    await systemDb.message.update({
      where: { id: out.id },
      data: { status: "QUEUED" },
    });
  await deliver(channel, p.customerExternalId, text, out.id);
  logger.warn({ eventId: id }, "fallback sent");
}
