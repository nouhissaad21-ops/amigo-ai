import { Prisma, type Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { logger } from "../logger.js";
import { enqueueInbound } from "../queues.js";
import { decryptJson } from "../security.js";
import type { NormalizedInbound } from "./inbound.js";

type InstagramCredentials = {
  accessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
};

type Conversation = { id?: string; updated_time?: string };
type MessageParticipant = { id?: string; username?: string };
type InstagramMessage = {
  id?: string;
  created_time?: string;
  from?: MessageParticipant;
  to?: { data?: MessageParticipant[] };
  message?: string;
  is_unsupported?: boolean;
};
type ConversationDetails = {
  messages?: { data?: InstagramMessage[] };
};
type GraphError = { error?: { message?: string } };

const lastSuccessfulPoll = new Map<string, number>();
let polling = false;

async function graphJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  const raw = await response.text();
  let data: T & GraphError;
  try {
    data = JSON.parse(raw) as T & GraphError;
  } catch {
    throw new Error(`Instagram returned HTTP ${response.status}`);
  }
  if (!response.ok || data.error)
    throw new Error(data.error?.message ?? `Instagram HTTP ${response.status}`);
  return data;
}

function graphUrl(path: string) {
  return new URL(
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`,
  );
}

function accountAliases(channel: Channel, credentials: InstagramCredentials) {
  return new Set(
    [
      channel.externalAccountId,
      channel.externalBusinessId,
      credentials.instagramUserId,
      credentials.oauthUserId,
    ].filter((value): value is string => Boolean(value)),
  );
}

async function messageDetails(
  message: InstagramMessage,
  token: string,
): Promise<InstagramMessage> {
  if (message.message || !message.id) return message;
  const url = graphUrl(message.id);
  url.searchParams.set("fields", "id,created_time,from,to,message");
  return graphJson<InstagramMessage>(url, token);
}

async function persistPolledMessage(
  channel: Channel,
  message: InstagramMessage,
) {
  const externalMessageId = String(message.id ?? "").trim();
  const customerExternalId = String(message.from?.id ?? "").trim();
  const text = String(message.message ?? "").trim();
  if (!externalMessageId || !customerExternalId || !text) return false;

  const payload: NormalizedInbound = {
    externalMessageId,
    customerExternalId,
    customerName: message.from?.username,
    text,
    timestamp: new Date(message.created_time ?? Date.now()).toISOString(),
    rawType: "text",
  };

  try {
    const event = await systemDb.webhookEvent.create({
      data: {
        provider: "INSTAGRAM_POLL",
        eventKey: `${channel.id}:${externalMessageId}`,
        storeId: channel.storeId,
        channelId: channel.id,
        payload,
      },
    });
    await enqueueInbound(event.id);
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return false;
    throw error;
  }
}

async function pollChannel(channel: Channel) {
  const credentials = decryptJson<InstagramCredentials>(
    channel.credentialsEncrypted,
  );
  if (!credentials.accessToken) throw new Error("Instagram token ناقص");
  const accountId = credentials.instagramUserId ?? channel.externalAccountId;
  if (!accountId) throw new Error("Instagram account ID ناقص");

  const since =
    lastSuccessfulPoll.get(channel.id) ?? Date.now() - 2 * 60_000;
  const conversationsUrl = graphUrl(`${accountId}/conversations`);
  conversationsUrl.searchParams.set("platform", "instagram");
  conversationsUrl.searchParams.set("fields", "id,updated_time");
  conversationsUrl.searchParams.set("limit", "10");
  const conversations = await graphJson<{ data?: Conversation[] }>(
    conversationsUrl,
    credentials.accessToken,
  );

  const aliases = accountAliases(channel, credentials);
  let captured = 0;
  for (const conversation of conversations.data ?? []) {
    if (!conversation.id) continue;
    const updatedAt = Date.parse(conversation.updated_time ?? "");
    if (Number.isFinite(updatedAt) && updatedAt < since - 30_000) continue;

    const detailsUrl = graphUrl(conversation.id);
    detailsUrl.searchParams.set(
      "fields",
      "messages.limit(6){id,created_time,from,to,message,is_unsupported}",
    );
    const details = await graphJson<ConversationDetails>(
      detailsUrl,
      credentials.accessToken,
    );
    const messages = [...(details.messages?.data ?? [])].sort(
      (a, b) =>
        Date.parse(a.created_time ?? "") - Date.parse(b.created_time ?? ""),
    );

    for (const compact of messages) {
      if (compact.is_unsupported) continue;
      const createdAt = Date.parse(compact.created_time ?? "");
      if (Number.isFinite(createdAt) && createdAt < since - 30_000) continue;
      const message = await messageDetails(compact, credentials.accessToken);
      const senderId = String(message.from?.id ?? "");
      if (!senderId || aliases.has(senderId)) continue;
      if (await persistPolledMessage(channel, message)) captured++;
    }
  }

  lastSuccessfulPoll.set(channel.id, Date.now() - 5_000);
  if (channel.lastError)
    await systemDb.channel
      .update({ where: { id: channel.id }, data: { lastError: null } })
      .catch(() => {});
  return captured;
}

export async function pollConnectedInstagramChannels() {
  if (polling) return { checked: 0, captured: 0, skipped: true };
  polling = true;
  try {
    const channels = await systemDb.channel.findMany({
      where: { type: "INSTAGRAM", status: "CONNECTED" },
      take: 25,
    });
    let captured = 0;
    for (const channel of channels) {
      try {
        captured += await pollChannel(channel);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Instagram poll failed";
        await systemDb.channel
          .update({
            where: { id: channel.id },
            data: { lastError: `Poll: ${message}`.slice(0, 1000) },
          })
          .catch(() => {});
        logger.warn(
          { err: error, channelId: channel.id },
          "Instagram polling fallback failed",
        );
      }
    }
    if (captured)
      logger.info(
        { checked: channels.length, captured },
        "Instagram polling captured messages",
      );
    return { checked: channels.length, captured, skipped: false };
  } finally {
    polling = false;
  }
}
