import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "../errors.js";
import { whatsappOutboundQueue } from "../queues.js";
import { decryptJson, metaAppSecretProof } from "../security.js";

type Cred = {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  instagramAccessToken?: string;
  facebookPageAccessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
  pageId?: string;
  graphHost?: "instagram" | "facebook";
};

type ApiBody = {
  message_id?: string;
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
  raw?: string;
};

async function body(response: Response): Promise<ApiBody> {
  const text = await response.text();
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function facebook(channel: Channel, to: string, text: string) {
  const credentials = decryptJson<Cred>(channel.credentialsEncrypted);
  if (!credentials.accessToken)
    throw new AppError(500, "MISSING_TOKEN", "Token ناقص");
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${channel.externalAccountId}/messages`,
  );
  url.searchParams.set(
    "appsecret_proof",
    metaAppSecretProof(credentials.accessToken),
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: to },
      messaging_type: "RESPONSE",
      message: { text: text.slice(0, 1900) },
    }),
    signal: AbortSignal.timeout(7_000),
  });
  const data = await body(response);
  if (!response.ok)
    throw new AppError(
      502,
      "META_SEND_FAILED",
      data.error?.message ?? "فشل الإرسال",
    );
  return data.message_id ?? crypto.randomUUID();
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

async function instagram(channel: Channel, to: string, text: string) {
  const credentials = decryptJson<Cred>(channel.credentialsEncrypted);
  const defaultToken = credentials.accessToken;
  const tokenCandidates: Array<{
    host: "instagram" | "facebook";
    token?: string;
  }> = [
    {
      host: credentials.graphHost ?? (credentials.pageId ? "facebook" : "instagram"),
      token:
        credentials.graphHost === "facebook"
          ? credentials.facebookPageAccessToken ?? defaultToken
          : credentials.instagramAccessToken ?? defaultToken,
    },
    {
      host: "instagram",
      token: credentials.instagramAccessToken ?? (!credentials.pageId ? defaultToken : undefined),
    },
    {
      host: "facebook",
      token: credentials.facebookPageAccessToken ?? (credentials.pageId ? defaultToken : undefined),
    },
  ];
  const connections = tokenCandidates.filter(
    (item, index, all): item is { host: "instagram" | "facebook"; token: string } =>
      Boolean(item.token) &&
      all.findIndex(
        (other) => other.host === item.host && other.token === item.token,
      ) === index,
  );
  if (!connections.length)
    throw new AppError(500, "MISSING_TOKEN", "Instagram token ناقص");

  const failures: string[] = [];

  for (const connection of connections) {
    // Instagram Login sends through the professional IG user ID. Facebook
    // Login/Page-linked mode sends through the Page ID, which was previously
    // missing from the candidate list and caused every outbound attempt to fail.
    const accountIds =
      connection.host === "facebook"
        ? unique([
            credentials.pageId,
            channel.externalBusinessId,
            credentials.instagramUserId,
            channel.externalAccountId,
            credentials.oauthUserId,
          ])
        : unique([
            credentials.instagramUserId,
            channel.externalAccountId,
            credentials.oauthUserId,
            "me",
          ]);

    for (const accountId of accountIds) {
      const url = new URL(
        `https://graph.${connection.host}.com/${env.META_GRAPH_VERSION}/${accountId}/messages`,
      );
      if (
        connection.host === "facebook" &&
        (connection.token === credentials.facebookPageAccessToken || credentials.pageId)
      )
        url.searchParams.set(
          "appsecret_proof",
          metaAppSecretProof(connection.token),
        );
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            recipient: { id: to },
            ...(connection.host === "facebook"
              ? { messaging_type: "RESPONSE" }
              : {}),
            message: { text: text.slice(0, 1900) },
          }),
          signal: AbortSignal.timeout(7_000),
        });
        const data = await body(response);
        if (response.ok)
          return data.message_id ?? data.messages?.[0]?.id ?? crypto.randomUUID();
        failures.push(
          `${connection.host}:${accountId}: ${
            data.error?.message ?? data.raw ?? `HTTP ${response.status}`
          }`,
        );
      } catch (error) {
        failures.push(
          `${connection.host}:${accountId}: ${
            error instanceof Error ? error.message : "send failed"
          }`,
        );
      }
    }
  }

  throw new AppError(
    502,
    "INSTAGRAM_SEND_FAILED",
    failures.slice(0, 4).join(" | ") || "فشل إرسال رسالة Instagram",
  );
}

async function cloud(channel: Channel, to: string, text: string) {
  const credentials = decryptJson<Cred>(channel.credentialsEncrypted);
  if (!credentials.accessToken || !credentials.phoneNumberId)
    throw new AppError(500, "MISSING_TOKEN", "إعداد WhatsApp ناقص");
  const response = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${credentials.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(0, 4000) },
      }),
      signal: AbortSignal.timeout(7_000),
    },
  );
  const data = await body(response);
  if (!response.ok)
    throw new AppError(
      502,
      "WHATSAPP_SEND_FAILED",
      data.error?.message ?? "فشل الإرسال",
    );
  return data.messages?.[0]?.id ?? crypto.randomUUID();
}

export async function dispatchOutbound(
  channel: Channel,
  to: string,
  text: string,
  messageId: string,
) {
  if (channel.type === "FACEBOOK")
    return {
      externalMessageId: await facebook(channel, to, text),
      queued: false,
    };
  if (channel.type === "INSTAGRAM")
    return {
      externalMessageId: await instagram(channel, to, text),
      queued: false,
    };
  if (channel.type === "WHATSAPP_CLOUD")
    return {
      externalMessageId: await cloud(channel, to, text),
      queued: false,
    };
  if (channel.type === "WHATSAPP_BAILEYS") {
    await whatsappOutboundQueue.add(
      "send",
      { messageId, channelId: channel.id, jid: to, text },
      { jobId: messageId },
    );
    return { queued: true };
  }
  throw new AppError(422, "UNSUPPORTED_CHANNEL", "قناة غير مدعومة");
}
