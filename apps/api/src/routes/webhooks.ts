import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Prisma, type Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { enqueueInbound } from "../queues.js";
import { decryptJson, verifyHmacSignature } from "../security.js";
import type { NormalizedInbound } from "../services/inbound.js";
import { audioAttachmentUrl } from "../services/media-intelligence.js";

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

async function persist(input: {
  eventKey: string;
  storeId: string;
  channelId: string;
  payload: NormalizedInbound;
}) {
  const provider = "META_MESSAGE";
  try {
    const event = await systemDb.webhookEvent.create({
      data: { ...input, provider },
    });
    await enqueueInbound(event.id);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const event = await systemDb.webhookEvent.findUnique({
        where: {
          provider_eventKey: { provider, eventKey: input.eventKey },
        },
      });
      if (
        event &&
        event.status !== "COMPLETED" &&
        event.status !== "IGNORED"
      )
        await enqueueInbound(event.id, true);
      return;
    }
    throw error;
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
  const events: any[] = [];
  if (Array.isArray(entry?.messaging)) events.push(...entry.messaging);
  if (Array.isArray(entry?.standby)) events.push(...entry.standby);
  for (const change of entry?.changes ?? []) {
    const value = change?.value;
    if (Array.isArray(value?.messaging)) events.push(...value.messaging);
    else if (Array.isArray(value?.messages)) events.push(...value.messages);
    else if (value?.message || value?.postback) events.push(value);
  }
  return events;
}

function accountIds(entry: any, event: any) {
  return uniqueIds([
    entry?.id,
    entry?.page_id,
    event?.recipient?.id,
    event?.message?.recipient?.id,
    event?.postback?.recipient?.id,
    event?.metadata?.recipient_id,
  ]);
}

type StoredCredentials = {
  instagramUserId?: string;
  oauthUserId?: string;
  pageId?: string;
};

function channelAliases(channel: Channel) {
  const aliases: Array<string | null | undefined> = [
    channel.externalAccountId,
    channel.externalBusinessId,
  ];
  try {
    const credentials = decryptJson<StoredCredentials>(
      channel.credentialsEncrypted,
    );
    aliases.push(
      credentials.instagramUserId,
      credentials.oauthUserId,
      credentials.pageId,
    );
  } catch (error) {
    logger.warn(
      { channelId: channel.id, err: error },
      "Could not read channel aliases",
    );
  }
  return uniqueIds(aliases);
}

async function connectedChannelByType(
  type: "FACEBOOK" | "INSTAGRAM",
  ids: string[],
) {
  if (ids.length) {
    const exact = await systemDb.channel.findFirst({
      where: {
        type,
        status: "CONNECTED",
        OR: [
          { externalAccountId: { in: ids } },
          { externalBusinessId: { in: ids } },
        ],
      },
    });
    if (exact) return exact;
  }

  const candidates = await systemDb.channel.findMany({
    where: { type, status: "CONNECTED" },
  });
  const aliasMatch = candidates.find((channel) =>
    channelAliases(channel).some((alias) => ids.includes(alias)),
  );
  if (aliasMatch) return aliasMatch;

  if (type === "INSTAGRAM" && candidates.length === 1) {
    logger.warn(
      { channelId: candidates[0]?.id, candidateAccountIds: ids },
      "Using the only Instagram channel for unmatched Meta webhook IDs",
    );
    return candidates[0] ?? null;
  }
  return null;
}

async function resolveMetaChannel(object: unknown, ids: string[]) {
  const preferred: "FACEBOOK" | "INSTAGRAM" =
    object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const first = await connectedChannelByType(preferred, ids);
  if (first) return first;

  const alternative = preferred === "FACEBOOK" ? "INSTAGRAM" : "FACEBOOK";
  return connectedChannelByType(alternative, ids);
}

function metaContent(event: any) {
  const message = event?.message ?? event;
  const postback = event?.postback;
  const directText = String(
    message?.text ??
      message?.message ??
      message?.quick_reply?.payload ??
      postback?.title ??
      postback?.payload ??
      "",
  ).trim();
  if (directText)
    return { text: directText, rawType: event?.postback ? "postback" : "text" };

  const mediaUrl = audioAttachmentUrl(event);
  if (mediaUrl)
    return {
      text: "[Customer sent a voice message]",
      rawType: "audio",
      mediaUrl,
    };

  if (message?.attachments?.length)
    return {
      text: "[The customer sent an attachment or image]",
      rawType: "attachment",
    };

  return { text: "", rawType: "text" };
}

function eventMessageId(event: any, accountId: string, text: string) {
  const supplied =
    event?.message?.mid ??
    event?.message?.id ??
    event?.postback?.mid ??
    event?.mid ??
    event?.message_id ??
    event?.id;
  if (supplied) return String(supplied);
  return `synthetic-${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        accountId,
        sender: event?.sender?.id ?? event?.from?.id,
        timestamp: event?.timestamp,
        text,
      }),
    )
    .digest("hex")}`;
}

function customerParticipant(event: any, businessAliases: string[]) {
  const candidates = uniqueIds([
    event?.sender?.id,
    event?.from?.id,
    event?.message?.from?.id,
    event?.recipient?.id,
    event?.to?.id,
    ...(event?.to?.data ?? []).map((item: any) => item?.id),
  ]);
  return candidates.find((id) => !businessAliases.includes(id)) ?? "";
}

metaWebhookRouter.post("/", async (req, res) => {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw))
    throw new AppError(400, "INVALID_WEBHOOK_BODY", "Webhook body غير صالح");

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

  let body: any;
  try {
    body = JSON.parse(raw.toString());
  } catch {
    throw new AppError(400, "INVALID_WEBHOOK_JSON", "Webhook JSON غير صالح");
  }

  const jobs: Promise<void>[] = [];
  let received = 0;
  let routed = 0;

  for (const entry of body.entry ?? []) {
    for (const event of messagingEvents(entry)) {
      received++;
      const ids = accountIds(entry, event);
      const channel = await resolveMetaChannel(body.object, ids);
      if (!channel) {
        logger.warn(
          {
            webhookObject: body.object,
            candidateAccountIds: ids,
            senderId: event?.sender?.id ?? event?.from?.id,
          },
          "Meta webhook could not be matched to a connected channel",
        );
        continue;
      }

      const message = event?.message ?? event;
      if (message?.is_echo || event?.is_echo) continue;
      const businessAliases = channelAliases(channel);
      const customerId = customerParticipant(event, businessAliases);
      if (!customerId) continue;

      const content = metaContent(event);
      if (!content.text) continue;
      const externalMessageId = eventMessageId(
        event,
        ids[0] ?? channel.externalAccountId,
        content.text,
      );
      routed++;
      jobs.push(
        persist({
          eventKey: `${channel.id}:${externalMessageId}`,
          storeId: channel.storeId,
          channelId: channel.id,
          payload: {
            externalMessageId,
            customerExternalId: customerId,
            text: content.text,
            timestamp: new Date(
              Number(event?.timestamp ?? entry?.time ?? Date.now()),
            ).toISOString(),
            rawType: content.rawType,
            mediaUrl: content.mediaUrl,
          },
        }),
      );
    }
  }

  await Promise.all(jobs);
  logger.info(
    { webhookObject: body.object, received, routed },
    "Meta webhook processed",
  );
  res.status(200).send("EVENT_RECEIVED");
});

const waText = (message: any) =>
  String(
    message.type === "text"
      ? message.text?.body
      : message.type === "button"
        ? (message.button?.text ?? message.button?.payload)
        : message.type === "interactive"
          ? (message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title)
          : message.type === "image"
            ? (message.image?.caption ?? "[The customer sent an image]")
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

  const body = JSON.parse(raw.toString()) as any;
  const jobs: Promise<void>[] = [];
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const id = String(value.metadata?.phone_number_id ?? "");
      if (!id) continue;
      const channel = await systemDb.channel.findUnique({
        where: {
          type_externalAccountId: {
            type: "WHATSAPP_CLOUD",
            externalAccountId: id,
          },
        },
      });
      if (!channel || channel.status !== "CONNECTED") continue;
      for (const message of value.messages ?? []) {
        const text = waText(message);
        if (!message.id || !text) continue;
        const contact = (value.contacts ?? []).find(
          (item: any) => item.wa_id === message.from,
        );
        jobs.push(
          persist({
            eventKey: `${channel.id}:${String(message.id)}`,
            storeId: channel.storeId,
            channelId: channel.id,
            payload: {
              externalMessageId: String(message.id),
              customerExternalId: String(message.from),
              customerName: contact?.profile?.name,
              text,
              timestamp: new Date(
                Number(message.timestamp ?? Date.now() / 1000) * 1000,
              ).toISOString(),
              rawType: String(message.type ?? "text"),
            },
          }),
        );
      }
    }
  await Promise.all(jobs);
  res.status(200).send("EVENT_RECEIVED");
});
