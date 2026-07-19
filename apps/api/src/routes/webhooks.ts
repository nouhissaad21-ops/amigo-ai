import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Prisma, type Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { enqueueInbound } from "../queues.js";
import { verifyHmacSignature } from "../security.js";
import type { NormalizedInbound } from "../services/inbound.js";

export const metaWebhookRouter = Router(),
  whatsappWebhookRouter = Router();

function verify(req: Request, res: Response) {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === env.META_VERIFY_TOKEN
  )
    return void res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  throw new AppError(403, "INVALID_VERIFY_TOKEN", "Verify token غير صحيح");
}

metaWebhookRouter.get("/", verify);
whatsappWebhookRouter.get("/", verify);

async function persist(x: {
  provider: string;
  eventKey: string;
  storeId: string;
  channelId: string;
  payload: NormalizedInbound;
}) {
  try {
    const e = await systemDb.webhookEvent.create({ data: x });
    await enqueueInbound(e.id);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const e = await systemDb.webhookEvent.findUnique({
        where: {
          provider_eventKey: { provider: x.provider, eventKey: x.eventKey },
        },
      });
      if (e && e.status !== "COMPLETED" && e.status !== "IGNORED")
        await enqueueInbound(e.id, true);
      return;
    }
    throw err;
  }
}

function uniqueIds(values: unknown[]) {
  return [
    ...new Set(
      values
        .filter((value): value is string | number =>
          ["string", "number"].includes(typeof value),
        )
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function messagingEvents(entry: any) {
  const events = Array.isArray(entry?.messaging) ? [...entry.messaging] : [];
  for (const change of entry?.changes ?? []) {
    const value = change?.value;
    if (Array.isArray(value?.messaging)) events.push(...value.messaging);
    else if (value?.message || value?.postback) events.push(value);
  }
  return events;
}

function accountIds(entry: any, event: any) {
  return uniqueIds([
    entry?.id,
    event?.recipient?.id,
    event?.message?.recipient?.id,
    event?.postback?.recipient?.id,
  ]);
}

async function connectedChannel(
  type: "FACEBOOK" | "INSTAGRAM",
  ids: string[],
): Promise<Channel | null> {
  if (!ids.length) return null;
  return systemDb.channel.findFirst({
    where: {
      type,
      status: "CONNECTED",
      OR: [
        { externalAccountId: { in: ids } },
        { externalBusinessId: { in: ids } },
      ],
    },
  });
}

function metaText(event: any) {
  const message = event?.message;
  const postback = event?.postback;
  return String(
    message?.text ??
      message?.quick_reply?.payload ??
      postback?.title ??
      postback?.payload ??
      (message?.attachments?.length
        ? "[الزبون بعث مرفق أو صورة]"
        : ""),
  ).trim();
}

function eventMessageId(event: any, accountId: string, text: string) {
  const supplied =
    event?.message?.mid ??
    event?.postback?.mid ??
    event?.mid ??
    event?.message_id;
  if (supplied) return String(supplied);
  return `synthetic-${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        accountId,
        sender: event?.sender?.id,
        timestamp: event?.timestamp,
        text,
      }),
    )
    .digest("hex")}`;
}

metaWebhookRouter.post("/", async (req, res) => {
  const raw = req.body as Buffer;
  const secrets = [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (!secrets.length)
    throw new AppError(503, "META_NOT_CONFIGURED", "App Secret غير مضبوط");
  if (
    !secrets.some((secret) =>
      verifyHmacSignature(raw, req.get("x-hub-signature-256"), secret),
    )
  )
    throw new AppError(401, "INVALID_META_SIGNATURE", "توقيع غير صالح");

  const body = JSON.parse(raw.toString()) as any;
  const type = body.object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const jobs: Promise<void>[] = [];
  let received = 0;
  let routed = 0;

  for (const entry of body.entry ?? []) {
    for (const event of messagingEvents(entry)) {
      received++;
      const ids = accountIds(entry, event);
      const channel = await connectedChannel(type, ids);
      if (!channel) {
        logger.warn(
          {
            webhookObject: body.object,
            channelType: type,
            candidateAccountIds: ids,
            senderId: event?.sender?.id,
          },
          "Meta webhook could not be matched to a connected channel",
        );
        continue;
      }

      const senderId = String(event?.sender?.id ?? "").trim();
      const message = event?.message;
      const senderIsBusiness = ids.includes(senderId);
      if (
        !senderId ||
        message?.is_echo ||
        (message?.is_self && senderIsBusiness)
      )
        continue;

      const text = metaText(event);
      if (!text) continue;
      const externalMessageId = eventMessageId(event, ids[0] ?? channel.externalAccountId, text);
      routed++;
      jobs.push(
        persist({
          provider: `META_${type}`,
          eventKey: `${channel.id}:${externalMessageId}`,
          storeId: channel.storeId,
          channelId: channel.id,
          payload: {
            externalMessageId,
            customerExternalId: senderId,
            text,
            timestamp: new Date(
              Number(event?.timestamp ?? entry?.time ?? Date.now()),
            ).toISOString(),
            rawType: event?.postback
              ? "postback"
              : message?.attachments
                ? "attachment"
                : "text",
          },
        }),
      );
    }
  }

  await Promise.all(jobs);
  logger.info(
    { webhookObject: body.object, channelType: type, received, routed },
    "Meta webhook processed",
  );
  res.status(200).send("EVENT_RECEIVED");
});

const waText = (m: any) =>
  String(
    m.type === "text"
      ? m.text?.body
      : m.type === "button"
        ? (m.button?.text ?? m.button?.payload)
        : m.type === "interactive"
          ? (m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title)
          : m.type === "image"
            ? (m.image?.caption ?? "[الزبون بعث صورة]")
            : "",
  );

whatsappWebhookRouter.post("/", async (req, res) => {
  const raw = req.body as Buffer;
  if (!env.META_APP_SECRET)
    throw new AppError(503, "META_NOT_CONFIGURED", "Meta App Secret غير مضبوط");
  if (
    !verifyHmacSignature(
      raw,
      req.get("x-hub-signature-256"),
      env.META_APP_SECRET,
    )
  )
    throw new AppError(401, "INVALID_WHATSAPP_SIGNATURE", "توقيع غير صالح");
  const b = JSON.parse(raw.toString()) as any,
    jobs: Promise<void>[] = [];
  for (const e of b.entry ?? [])
    for (const ch of e.changes ?? []) {
      const v = ch.value,
        id = String(v.metadata?.phone_number_id ?? "");
      if (!id) continue;
      const c = await systemDb.channel.findUnique({
        where: {
          type_externalAccountId: {
            type: "WHATSAPP_CLOUD",
            externalAccountId: id,
          },
        },
      });
      if (!c || c.status !== "CONNECTED") continue;
      for (const m of v.messages ?? []) {
        const t = waText(m);
        if (!m.id || !t) continue;
        const contact = (v.contacts ?? []).find((q: any) => q.wa_id === m.from);
        jobs.push(
          persist({
            provider: "WHATSAPP_CLOUD",
            eventKey: `${c.id}:${String(m.id)}`,
            storeId: c.storeId,
            channelId: c.id,
            payload: {
              externalMessageId: String(m.id),
              customerExternalId: String(m.from),
              customerName: contact?.profile?.name,
              text: t,
              timestamp: new Date(
                Number(m.timestamp ?? Date.now() / 1000) * 1000,
              ).toISOString(),
              rawType: String(m.type ?? "text"),
            },
          }),
        );
      }
    }
  await Promise.all(jobs);
  res.status(200).send("EVENT_RECEIVED");
});
