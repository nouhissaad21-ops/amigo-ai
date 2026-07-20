import { Prisma, type Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { logger } from "../logger.js";
import { enqueueInbound } from "../queues.js";
import { decryptJson } from "../security.js";
import type { NormalizedInbound } from "./inbound.js";

type InstagramCredentials = {
  accessToken?: string;
  instagramAccessToken?: string;
  facebookPageAccessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
  pageId?: string;
  graphHost?: "instagram" | "facebook";
};

type Conversation = { id?: string; updated_time?: string };
type MessageParticipant = { id?: string; username?: string; name?: string };
type InstagramMessage = {
  id?: string;
  created_time?: string;
  from?: MessageParticipant;
  to?: { data?: MessageParticipant[] };
  message?: string;
  text?: string;
  is_unsupported?: boolean;
};
type ConversationDetails = {
  messages?: { data?: InstagramMessage[] };
};
type GraphError = { error?: { message?: string; code?: number } };

type GraphCandidate = {
  host: "instagram" | "facebook";
  accountId: string;
  token: string;
};

const lastSuccessfulPoll = new Map<string, number>();
let polling = false;

function graphUrl(host: "instagram" | "facebook", path: string) {
  return new URL(
    `https://graph.${host}.com/${env.META_GRAPH_VERSION}/${path}`,
  );
}

async function graphJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(7_000),
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

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function accountAliases(channel: Channel, credentials: InstagramCredentials) {
  return new Set(
    unique([
      channel.externalAccountId,
      channel.externalBusinessId,
      credentials.instagramUserId,
      credentials.oauthUserId,
      credentials.pageId,
    ]),
  );
}

function graphCandidates(channel: Channel, credentials: InstagramCredentials) {
  const defaultToken = credentials.accessToken;
  const instagramToken =
    credentials.instagramAccessToken ?? (!credentials.pageId ? defaultToken : undefined);
  const pageToken =
    credentials.facebookPageAccessToken ?? (credentials.pageId ? defaultToken : undefined);
  const instagramId = credentials.instagramUserId ?? channel.externalAccountId;
  const candidates: GraphCandidate[] = [];
  const add = (
    host: GraphCandidate["host"],
    accountId?: string | null,
    token?: string,
  ) => {
    if (!accountId || !token) return;
    if (
      !candidates.some(
        (item) =>
          item.host === host &&
          item.accountId === accountId &&
          item.token === token,
      )
    )
      candidates.push({ host, accountId, token });
  };

  if (credentials.graphHost === "facebook")
    add("facebook", credentials.pageId ?? instagramId, pageToken);
  else add("instagram", instagramId, instagramToken);
  add("instagram", instagramId, instagramToken);
  add("instagram", "me", instagramToken);
  add("facebook", credentials.pageId, pageToken);
  add("facebook", instagramId, pageToken);
  return candidates;
}

async function listConversations(
  channel: Channel,
  credentials: InstagramCredentials,
) {
  const failures: string[] = [];
  for (const candidate of graphCandidates(channel, credentials)) {
    const url = graphUrl(candidate.host, `${candidate.accountId}/conversations`);
    url.searchParams.set("platform", "instagram");
    url.searchParams.set("fields", "id,updated_time");
    url.searchParams.set("limit", "15");
    try {
      const result = await graphJson<{ data?: Conversation[] }>(
        url,
        candidate.token,
      );
      return { candidate, conversations: result.data ?? [] };
    } catch (error) {
      failures.push(
        `${candidate.host}:${candidate.accountId}: ${
          error instanceof Error ? error.message : "failed"
        }`,
      );
    }
  }
  throw new Error(failures[0] ?? "Instagram conversations are unavailable");
}

async function messageDetails(
  message: InstagramMessage,
  candidate: GraphCandidate,
): Promise<InstagramMessage> {
  if (message.message || message.text || !message.id) return message;
  const url = graphUrl(candidate.host, message.id);
  url.searchParams.set("fields", "id,created_time,from,to,message,text");
  return graphJson<InstagramMessage>(url, candidate.token);
}

function customerParticipant(
  message: InstagramMessage,
  aliases: Set<string>,
) {
  const participants = [message.from, ...(message.to?.data ?? [])].filter(
    (participant): participant is MessageParticipant => Boolean(participant?.id),
  );
  return participants.find((participant) => !aliases.has(String(participant.id)));
}

async function persistPolledMessage(
  channel: Channel,
  message: InstagramMessage,
  customer: MessageParticipant,
) {
  const externalMessageId = String(message.id ?? "").trim();
  const customerExternalId = String(customer.id ?? "").trim();
  const text = String(message.message ?? message.text ?? "").trim();
  if (!externalMessageId || !customerExternalId || !text) return false;

  const payload: NormalizedInbound = {
    externalMessageId,
    customerExternalId,
    customerName: customer.username ?? customer.name,
    text,
    timestamp: new Date(message.created_time ?? Date.now()).toISOString(),
    rawType: "text",
  };

  try {
    const event = await systemDb.webhookEvent.create({
      data: {
        provider: "META_MESSAGE",
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
  if (!graphCandidates(channel, credentials).length)
    throw new Error("Instagram token is missing");

  const since =
    lastSuccessfulPoll.get(channel.id) ?? Date.now() - 3 * 60_000;
  const { candidate, conversations } = await listConversations(
    channel,
    credentials,
  );
  const aliases = accountAliases(channel, credentials);
  let captured = 0;

  for (const conversation of conversations) {
    if (!conversation.id) continue;
    const updatedAt = Date.parse(conversation.updated_time ?? "");
    if (Number.isFinite(updatedAt) && updatedAt < since - 45_000) continue;

    const detailsUrl = graphUrl(candidate.host, conversation.id);
    detailsUrl.searchParams.set(
      "fields",
      "messages.limit(10){id,created_time,from,to,message,text,is_unsupported}",
    );
    const details = await graphJson<ConversationDetails>(
      detailsUrl,
      candidate.token,
    );
    const messages = [...(details.messages?.data ?? [])].sort(
      (a, b) =>
        Date.parse(a.created_time ?? "") - Date.parse(b.created_time ?? ""),
    );

    for (const compact of messages) {
      if (compact.is_unsupported) continue;
      const createdAt = Date.parse(compact.created_time ?? "");
      if (Number.isFinite(createdAt) && createdAt < since - 45_000) continue;
      const message = await messageDetails(compact, candidate);
      const customer = customerParticipant(message, aliases);
      if (!customer) continue;
      if (await persistPolledMessage(channel, message, customer)) captured++;
    }
  }

  lastSuccessfulPoll.set(channel.id, Date.now() - 8_000);
  await systemDb.channel
    .update({
      where: { id: channel.id },
      data: { status: "CONNECTED", lastError: null },
    })
    .catch(() => {});
  return captured;
}

export async function pollConnectedInstagramChannels() {
  if (polling) return { checked: 0, captured: 0, skipped: true };
  polling = true;
  try {
    const channels = await systemDb.channel.findMany({
      where: { type: "INSTAGRAM", status: { in: ["CONNECTED", "ERROR"] } },
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
            data: {
              status: "CONNECTED",
              lastError: `Poll: ${message}`.slice(0, 1000),
            },
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