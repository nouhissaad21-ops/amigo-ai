import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
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

const metaText = (m: any) =>
  String(
    m.text ??
      m.quick_reply?.payload ??
      (m.attachments?.length ? "[الزبون بعث مرفق أو صورة]" : ""),
  );

metaWebhookRouter.post("/", async (req, res) => {
  const raw = req.body as Buffer;
  const body = JSON.parse(raw.toString()) as any;
  const secrets = [env.META_APP_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (!secrets.length)
    throw new AppError(503, "META_NOT_CONFIGURED", "Meta App Secret غير مضبوط");
  if (
    !secrets.some((secret) =>
      verifyHmacSignature(raw, req.get("x-hub-signature-256"), secret),
    )
  )
    throw new AppError(401, "INVALID_META_SIGNATURE", "توقيع غير صالح");

  const type = body.object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const jobs: Promise<void>[] = [];
  for (const entry of body.entry ?? []) {
    const c = await systemDb.channel.findUnique({
      where: {
        type_externalAccountId: { type, externalAccountId: String(entry.id) },
      },
    });
    if (!c || c.status !== "CONNECTED") continue;
    for (const x of entry.messaging ?? []) {
      const m = x.message;
      if (!m?.mid || m.is_echo) continue;
      const t = metaText(m);
      if (t)
        jobs.push(
          persist({
            provider: `META_${type}`,
            eventKey: `${c.id}:${String(m.mid)}`,
            storeId: c.storeId,
            channelId: c.id,
            payload: {
              externalMessageId: String(m.mid),
              customerExternalId: String(x.sender?.id ?? ""),
              text: t,
              timestamp: new Date(
                Number(x.timestamp ?? Date.now()),
              ).toISOString(),
              rawType: m.attachments ? "attachment" : "text",
            },
          }),
        );
    }
  }
  await Promise.all(jobs);
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
