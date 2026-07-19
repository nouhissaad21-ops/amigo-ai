import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "../errors.js";
import { whatsappOutboundQueue } from "../queues.js";
import { decryptJson, metaAppSecretProof } from "../security.js";

type Cred = { accessToken?: string; phoneNumberId?: string; wabaId?: string };

async function body(r: Response) {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t.slice(0, 500) };
  }
}

async function facebook(c: Channel, to: string, text: string) {
  const x = decryptJson<Cred>(c.credentialsEncrypted);
  if (!x.accessToken) throw new AppError(500, "MISSING_TOKEN", "Token ناقص");
  const u = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${c.externalAccountId}/messages`,
  );
  u.searchParams.set("appsecret_proof", metaAppSecretProof(x.accessToken));
  const r = await fetch(u, {
      method: "POST",
      headers: {
        authorization: `Bearer ${x.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: to },
        messaging_type: "RESPONSE",
        message: { text: text.slice(0, 1900) },
      }),
    }),
    b = await body(r);
  if (!r.ok)
    throw new AppError(
      502,
      "META_SEND_FAILED",
      b.error?.message ?? "فشل الإرسال",
    );
  return b.message_id ?? crypto.randomUUID();
}

async function instagram(c: Channel, to: string, text: string) {
  const x = decryptJson<Cred>(c.credentialsEncrypted);
  if (!x.accessToken) throw new AppError(500, "MISSING_TOKEN", "Token ناقص");
  const r = await fetch(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${c.externalAccountId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${x.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: to },
          message: { text: text.slice(0, 1900) },
        }),
      },
    ),
    b = await body(r);
  if (!r.ok)
    throw new AppError(
      502,
      "INSTAGRAM_SEND_FAILED",
      b.error?.message ?? "فشل إرسال رسالة Instagram",
    );
  return b.message_id ?? crypto.randomUUID();
}

async function cloud(c: Channel, to: string, text: string) {
  const x = decryptJson<Cred>(c.credentialsEncrypted);
  if (!x.accessToken || !x.phoneNumberId)
    throw new AppError(500, "MISSING_TOKEN", "إعداد WhatsApp ناقص");
  const r = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${x.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${x.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text.slice(0, 4000) },
        }),
      },
    ),
    b = await body(r);
  if (!r.ok)
    throw new AppError(
      502,
      "WHATSAPP_SEND_FAILED",
      b.error?.message ?? "فشل الإرسال",
    );
  return b.messages?.[0]?.id ?? crypto.randomUUID();
}

export async function dispatchOutbound(
  c: Channel,
  to: string,
  text: string,
  messageId: string,
) {
  if (c.type === "FACEBOOK")
    return { externalMessageId: await facebook(c, to, text), queued: false };
  if (c.type === "INSTAGRAM")
    return { externalMessageId: await instagram(c, to, text), queued: false };
  if (c.type === "WHATSAPP_CLOUD")
    return { externalMessageId: await cloud(c, to, text), queued: false };
  if (c.type === "WHATSAPP_BAILEYS") {
    await whatsappOutboundQueue.add(
      "send",
      { messageId, channelId: c.id, jid: to, text },
      { jobId: messageId },
    );
    return { queued: true };
  }
  throw new AppError(422, "UNSUPPORTED_CHANNEL", "قناة غير مدعومة");
}
