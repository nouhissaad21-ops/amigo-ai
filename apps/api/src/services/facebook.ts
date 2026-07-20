import "./instagram-poller-runtime.js";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { logger } from "../logger.js";
import {
  decryptJson,
  encryptJson,
  metaAppSecretProof,
} from "../security.js";

type FacebookCredentials = { accessToken?: string };
type InstagramCredentials = {
  accessToken?: string;
  instagramAccessToken?: string;
  facebookPageAccessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
  pageId?: string;
  graphHost?: "instagram" | "facebook";
};
type LinkedInstagram = { id?: string; username?: string };
type PageDetails = {
  id?: string;
  name?: string;
  instagram_business_account?: LinkedInstagram;
  connected_instagram_account?: LinkedInstagram;
};
type MetaErrorBody = {
  success?: boolean;
  error?: { message?: string; code?: number; type?: string };
};

const subscribedFields = "messages,messaging_postbacks,message_echoes";

async function pageDetails(pageId: string, token: string) {
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${pageId}`,
  );
  url.searchParams.set(
    "fields",
    "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}",
  );
  url.searchParams.set("appsecret_proof", metaAppSecretProof(token));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(7_000),
  });
  const data = (await response.json().catch(() => ({}))) as PageDetails &
    MetaErrorBody;
  if (!response.ok || data.error)
    throw new Error(data.error?.message ?? "تعذر قراءة صفحة Facebook");
  return data;
}

async function upsertLinkedInstagram(input: {
  storeId: string;
  pageId: string;
  pageToken: string;
  account: LinkedInstagram;
}) {
  if (!input.account.id) return false;
  const accountId = String(input.account.id);
  const old = await systemDb.channel.findFirst({
    where: {
      type: "INSTAGRAM",
      OR: [
        { externalAccountId: accountId },
        { externalBusinessId: input.pageId },
      ],
    },
  });
  if (old && old.storeId !== input.storeId) {
    logger.warn(
      { channelId: old.id, accountId, pageId: input.pageId },
      "Linked Instagram account belongs to another store",
    );
    return false;
  }

  let previous: InstagramCredentials = {};
  if (old) {
    try {
      previous = decryptJson<InstagramCredentials>(old.credentialsEncrypted);
    } catch {
      previous = {};
    }
  }
  const credentials: InstagramCredentials = {
    ...previous,
    accessToken: previous.accessToken ?? input.pageToken,
    instagramAccessToken:
      previous.instagramAccessToken ??
      (previous.graphHost !== "facebook" ? previous.accessToken : undefined),
    facebookPageAccessToken: input.pageToken,
    instagramUserId: accountId,
    pageId: input.pageId,
    graphHost: previous.graphHost ?? "facebook",
  };
  const data = {
    storeId: input.storeId,
    type: "INSTAGRAM" as const,
    externalAccountId: accountId,
    externalBusinessId: input.pageId,
    name: input.account.username
      ? `@${input.account.username}`
      : "Instagram Business",
    credentialsEncrypted: encryptJson(credentials),
    status: "CONNECTED" as const,
    webhookSubscribedAt: new Date(),
    lastConnectedAt: new Date(),
    lastError: null,
  };
  if (old) await systemDb.channel.update({ where: { id: old.id }, data });
  else await systemDb.channel.create({ data });
  return true;
}

async function repairFacebookChannel(channel: {
  id: string;
  storeId: string;
  externalAccountId: string;
  credentialsEncrypted: string;
}) {
  const credentials = decryptJson<FacebookCredentials>(
    channel.credentialsEncrypted,
  );
  if (!credentials.accessToken) throw new Error("Facebook page token ناقص");

  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${channel.externalAccountId}/subscribed_apps`,
  );
  url.searchParams.set("subscribed_fields", subscribedFields);
  url.searchParams.set(
    "appsecret_proof",
    metaAppSecretProof(credentials.accessToken),
  );
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${credentials.accessToken}` },
    signal: AbortSignal.timeout(7_000),
  });
  const data = (await response.json().catch(() => ({}))) as MetaErrorBody;
  if (!response.ok || data.error || data.success === false)
    throw new Error(data.error?.message ?? "فشل تفعيل Facebook Webhook");

  let instagramLinked = false;
  try {
    const details = await pageDetails(
      channel.externalAccountId,
      credentials.accessToken,
    );
    const account =
      details.instagram_business_account ?? details.connected_instagram_account;
    if (account?.id)
      instagramLinked = await upsertLinkedInstagram({
        storeId: channel.storeId,
        pageId: channel.externalAccountId,
        pageToken: credentials.accessToken,
        account,
      });
  } catch (error) {
    logger.warn(
      { err: error, channelId: channel.id },
      "Could not auto-discover linked Instagram account",
    );
  }

  await systemDb.channel.update({
    where: { id: channel.id },
    data: {
      status: "CONNECTED",
      webhookSubscribedAt: new Date(),
      lastError: null,
    },
  });
  return { instagramLinked };
}

export async function repairConnectedFacebookChannels() {
  const channels = await systemDb.channel.findMany({
    where: { type: "FACEBOOK", status: { in: ["CONNECTED", "ERROR"] } },
    select: {
      id: true,
      storeId: true,
      externalAccountId: true,
      credentialsEncrypted: true,
    },
  });

  let repaired = 0;
  let instagramLinked = 0;
  for (const channel of channels) {
    try {
      const result = await repairFacebookChannel(channel);
      repaired++;
      if (result.instagramLinked) instagramLinked++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Facebook repair failed";
      await systemDb.channel
        .update({
          where: { id: channel.id },
          data: { status: "CONNECTED", lastError: message.slice(0, 1000) },
        })
        .catch(() => {});
      logger.warn(
        { err: error, channelId: channel.id },
        "Facebook channel auto-repair failed",
      );
    }
  }

  return { checked: channels.length, repaired, instagramLinked };
}