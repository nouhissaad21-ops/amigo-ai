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
type GraphError = { error?: { message?: string; code?: number; type?: string } };

type GraphCandidate = {
  key: string;
  host: "instagram" | "facebook";
  accountId: string;
  token: string;
  platformParam: boolean;
};

type ConversationSource = {
  candidate: GraphCandidate;
  conversations: Conversation[];
};

export type InstagramProbeResult = {
  reachable: boolean;
  conversationCount: number;
  sources: Array<{
    key: string;
    host: "instagram" | "facebook";
    accountId: string;
    conversationCount: number;
  }>;
  failures: string[];
};

// Meta's list endpoint should return lightweight message records. Full content
// is fetched separately from the message-details endpoint.
export const INSTAGRAM_CONVERSATION_MESSAGE_FIELDS =
  "messages.limit(20){id,created_time,is_unsupported}";
export const INSTAGRAM_MESSAGE_DETAIL_FIELDS =
  "id,created_time,from,to,message";

const INITIAL_CATCHUP_MS = 24 * 60 * 60_000;
const OVERLAP_MS = 2 * 60_000;
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
    signal: AbortSignal.timeout(9_000),
  });
  const raw = await response.text();
  let data: T & GraphError;
  try {
    data = JSON.parse(raw) as T & GraphError;
  } catch {
    throw new Error(`Instagram returned HTTP ${response.status}`);
  }
  if (!response.ok || data.error)
    throw new Error(
      data.error?.message ?? `Instagram returned HTTP ${response.status}`,
    );
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
    credentials.instagramAccessToken ??
    (credentials.graphHost !== "facebook" ? defaultToken : undefined);
  const pageToken =
    credentials.facebookPageAccessToken ??
    (credentials.graphHost === "facebook" || credentials.pageId
      ? defaultToken
      : undefined);
  const instagramId = credentials.instagramUserId ?? channel.externalAccountId;
  const pageId = credentials.pageId ?? channel.externalBusinessId;
  const candidates: GraphCandidate[] = [];

  const add = (
    key: string,
    host: GraphCandidate["host"],
    accountId?: string | null,
    token?: string,
    platformParam = false,
  ) => {
    if (!accountId || !token) return;
    if (
      candidates.some(
        (item) =>
          item.host === host &&
          item.accountId === accountId &&
          item.token === token &&
          item.platformParam === platformParam,
      )
    )
      return;
    candidates.push({ key, host, accountId, token, platformParam });
  };

  // Instagram Login: use the professional-account ID first, then /me.
  add("instagram-user", "instagram", instagramId, instagramToken, true);
  add("instagram-me", "instagram", "me", instagramToken, true);

  // Some Graph versions accept the same endpoints without platform=instagram.
  // Keep these as compatibility fallbacks, after the documented candidates.
  add("instagram-user-direct", "instagram", instagramId, instagramToken, false);
  add("instagram-me-direct", "instagram", "me", instagramToken, false);

  // Facebook Login/Page-linked mode uses a Page token and platform=instagram.
  add("facebook-page", "facebook", pageId, pageToken, true);
  add("facebook-instagram-user", "facebook", instagramId, pageToken, true);

  return candidates;
}

async function fetchConversationSources(
  channel: Channel,
  credentials: InstagramCredentials,
) {
  const candidates = graphCandidates(channel, credentials);
  if (!candidates.length) throw new Error("Instagram access token is missing");

  const sources: ConversationSource[] = [];
  const failures: string[] = [];
  for (const candidate of candidates) {
    const url = graphUrl(candidate.host, `${candidate.accountId}/conversations`);
    if (candidate.platformParam) url.searchParams.set("platform", "instagram");
    url.searchParams.set("fields", "id,updated_time");
    url.searchParams.set("limit", "50");
    try {
      const result = await graphJson<{ data?: Conversation[] }>(
        url,
        candidate.token,
      );
      sources.push({ candidate, conversations: result.data ?? [] });
    } catch (error) {
      failures.push(
        `${candidate.key}: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }

  if (!sources.length)
    throw new Error(
      failures[0] ?? "Instagram Conversations API is unavailable",
    );

  // Do not stop on a successful-but-empty alias. Another supported endpoint can
  // contain the real inbox for the same account.
  sources.sort((a, b) => b.conversations.length - a.conversations.length);
  return { sources, failures };
}

export async function probeInstagramChannel(
  channel: Channel,
): Promise<InstagramProbeResult> {
  const credentials = decryptJson<InstagramCredentials>(
    channel.credentialsEncrypted,
  );
  try {
    const { sources, failures } = await fetchConversationSources(
      channel,
      credentials,
    );
    return {
      reachable: true,
      conversationCount: Math.max(
        0,
        ...sources.map((source) => source.conversations.length),
      ),
      sources: sources.map((source) => ({
        key: source.candidate.key,
        host: source.candidate.host,
        accountId: source.candidate.accountId,
        conversationCount: source.conversations.length,
      })),
      failures,
    };
  } catch (error) {
    return {
      reachable: false,
      conversationCount: 0,
      sources: [],
      failures: [error instanceof Error ? error.message : "Instagram probe failed"],
    };
  }
}

async function messageDetails(
  message: InstagramMessage,
  candidate: GraphCandidate,
): Promise<InstagramMessage> {
  if (message.message && message.from?.id) return message;
  if (!message.id) return message;
  const url = graphUrl(candidate.host, message.id);
  url.searchParams.set("fields", INSTAGRAM_MESSAGE_DETAIL_FIELDS);
  return graphJson<InstagramMessage>(url, candidate.token);
}

function inboundCustomer(
  message: InstagramMessage,
  aliases: Set<string>,
): MessageParticipant | undefined {
  // The sender is authoritative. Inspecting recipients can turn our own sent
  // replies into inbound messages and create loops.
  const sender = message.from;
  if (!sender?.id || aliases.has(String(sender.id))) return undefined;
  return sender;
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

async function pollWindowStart(channelId: string) {
  const memory = lastSuccessfulPoll.get(channelId);
  if (memory) return memory;

  const floor = Date.now() - INITIAL_CATCHUP_MS;
  const latest = await systemDb.webhookEvent.findFirst({
    where: { channelId, provider: "META_MESSAGE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return Math.max(floor, (latest?.createdAt.getTime() ?? floor) - OVERLAP_MS);
}

export async function pollInstagramChannelNow(channel: Channel) {
  const credentials = decryptJson<InstagramCredentials>(
    channel.credentialsEncrypted,
  );
  const { sources, failures } = await fetchConversationSources(
    channel,
    credentials,
  );
  const aliases = accountAliases(channel, credentials);
  const since = await pollWindowStart(channel.id);
  const seenMessages = new Set<string>();
  let captured = 0;

  for (const source of sources) {
    for (const conversation of source.conversations) {
      if (!conversation.id) continue;
      const updatedAt = Date.parse(conversation.updated_time ?? "");
      if (Number.isFinite(updatedAt) && updatedAt < since - OVERLAP_MS) continue;

      const detailsUrl = graphUrl(source.candidate.host, conversation.id);
      detailsUrl.searchParams.set(
        "fields",
        INSTAGRAM_CONVERSATION_MESSAGE_FIELDS,
      );
      let details: ConversationDetails;
      try {
        details = await graphJson<ConversationDetails>(
          detailsUrl,
          source.candidate.token,
        );
      } catch (error) {
        logger.debug(
          {
            err: error,
            channelId: channel.id,
            source: source.candidate.key,
            conversationId: conversation.id,
          },
          "Instagram conversation message list failed",
        );
        continue;
      }

      const messages = [...(details.messages?.data ?? [])].sort(
        (a, b) =>
          Date.parse(a.created_time ?? "") - Date.parse(b.created_time ?? ""),
      );
      for (const compact of messages) {
        if (compact.is_unsupported || !compact.id) continue;
        if (seenMessages.has(compact.id)) continue;
        seenMessages.add(compact.id);

        const createdAt = Date.parse(compact.created_time ?? "");
        if (Number.isFinite(createdAt) && createdAt < since - OVERLAP_MS)
          continue;

        let message: InstagramMessage;
        try {
          message = await messageDetails(compact, source.candidate);
        } catch (error) {
          logger.debug(
            { err: error, channelId: channel.id, messageId: compact.id },
            "Instagram message detail failed",
          );
          continue;
        }
        const customer = inboundCustomer(message, aliases);
        if (!customer) continue;
        if (await persistPolledMessage(channel, message, customer)) captured++;
      }
    }
  }

  lastSuccessfulPoll.set(channel.id, Date.now() - 30_000);
  await systemDb.channel
    .update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        lastError:
          failures.length && !sources.some((source) => source.conversations.length)
            ? `Some Instagram API paths failed: ${failures.join(" | ").slice(0, 850)}`
            : null,
      },
    })
    .catch(() => {});
  return { captured, failures, sources: sources.length };
}

export async function pollConnectedInstagramChannels() {
  if (polling) return { checked: 0, captured: 0, skipped: true };
  polling = true;
  try {
    const channels = await systemDb.channel.findMany({
      where: { type: "INSTAGRAM", status: { in: ["CONNECTED", "ERROR"] } },
      take: 50,
    });
    let captured = 0;
    for (const channel of channels) {
      try {
        captured += (await pollInstagramChannelNow(channel)).captured;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Instagram poll failed";
        await systemDb.channel
          .update({
            where: { id: channel.id },
            data: {
              status: "CONNECTED",
              lastError: `Instagram inbox: ${message}`.slice(0, 1000),
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
        "Instagram polling captured inbound messages",
      );
    return { checked: channels.length, captured, skipped: false };
  } finally {
    polling = false;
  }
}
