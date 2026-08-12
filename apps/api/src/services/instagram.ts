import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { decryptJson, encryptJson, metaAppSecretProof } from "../security.js";

type InstagramErrorBody = {
  error?: { message?: string; code?: number; type?: string };
  error_message?: string;
};

type InstagramTokenResponse = InstagramErrorBody & {
  access_token?: string;
  user_id?: string | number;
  permissions?: string[];
  token_type?: string;
  expires_in?: number;
};

type InstagramProfile = InstagramErrorBody & {
  id?: string;
  user_id?: string | number;
  username?: string;
};

type SubscriptionResponse = InstagramErrorBody & {
  success?: boolean;
  data?: Array<{ id?: string; subscribed_fields?: string[] }>;
};

export type InstagramStoredCredentials = {
  accessToken?: string;
  instagramAccessToken?: string;
  facebookPageAccessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
  pageId?: string;
  graphHost?: "instagram" | "facebook";
};

const requiredWebhookFields = ["messages", "messaging_postbacks"] as const;
const pageWebhookFields = ["messages", "messaging_postbacks", "message_echoes"] as const;

function credentials() {
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET)
    throw new AppError(
      503,
      "INSTAGRAM_NOT_CONFIGURED",
      "Instagram Business Login غير مضبوط في إعدادات المنصة",
    );
  return { appId: env.INSTAGRAM_APP_ID, appSecret: env.INSTAGRAM_APP_SECRET };
}

function redirectUri() {
  return `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/integrations/instagram/callback`;
}

async function json<T>(response: Response): Promise<T & InstagramErrorBody> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T & InstagramErrorBody;
  } catch {
    return { error_message: text.slice(0, 500) } as T & InstagramErrorBody;
  }
}

function errorMessage(data: InstagramErrorBody) {
  return data.error?.message ?? data.error_message ?? "Instagram رفضت الطلب";
}

async function exchangeLongLivedToken(shortToken: string, appSecret: string) {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });
  const failures: string[] = [];

  // Meta deployments have historically accepted GET for this endpoint; some
  // newer configurations report that POST is required. Try both safely.
  for (const method of ["GET", "POST"] as const) {
    const url = new URL(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/access_token`,
    );
    let response: Response;
    if (method === "GET") {
      for (const [key, value] of params) url.searchParams.set(key, value);
      response = await fetch(url, {
        headers: { authorization: `Bearer ${shortToken}` },
        signal: AbortSignal.timeout(12_000),
      });
    } else {
      response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${shortToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
        signal: AbortSignal.timeout(12_000),
      });
    }
    const data = await json<InstagramTokenResponse>(response);
    if (response.ok && data.access_token) return data;
    failures.push(`${method}: ${errorMessage(data)}`);
  }

  throw new AppError(
    400,
    "INSTAGRAM_LONG_TOKEN_FAILED",
    failures.join(" | ").slice(0, 900),
  );
}

async function instagramGraph<T>(path: string, token: string, init?: RequestInit) {
  const url = new URL(`https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`);
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
  const data = await json<T>(response);
  if (!response.ok || data.error)
    throw new AppError(502, "INSTAGRAM_API_ERROR", errorMessage(data));
  return data;
}

function subscriptionUrl(id: string, token: string) {
  const url = new URL(
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${id}/subscribed_apps`,
  );
  url.searchParams.set("access_token", token);
  return url;
}

async function ensureInstagramSubscription(id: string, token: string) {
  const url = subscriptionUrl(id, token);
  url.searchParams.set("subscribed_fields", requiredWebhookFields.join(","));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await json<SubscriptionResponse>(response);
  if (!response.ok || data.error || data.success === false)
    throw new AppError(502, "INSTAGRAM_SUBSCRIBE_ERROR", errorMessage(data));

  return [...requiredWebhookFields];
}

async function ensureFacebookPageSubscription(pageId: string, token: string) {
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${pageId}/subscribed_apps`,
  );
  url.searchParams.set("subscribed_fields", pageWebhookFields.join(","));
  url.searchParams.set("appsecret_proof", metaAppSecretProof(token));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await json<SubscriptionResponse>(response);
  if (!response.ok || data.error || data.success === false)
    throw new AppError(502, "INSTAGRAM_PAGE_SUBSCRIBE_ERROR", errorMessage(data));
  return [...pageWebhookFields];
}

async function saveInstagram(input: {
  storeId: string;
  externalAccountId: string;
  externalBusinessId: string;
  username?: string;
  accessToken: string;
}) {
  const old = await systemDb.channel.findFirst({
    where: {
      type: "INSTAGRAM",
      OR: [
        { externalAccountId: input.externalAccountId },
        { externalBusinessId: input.externalBusinessId },
      ],
    },
  });
  if (old && old.storeId !== input.storeId)
    throw new AppError(409, "CHANNEL_ALREADY_LINKED", "الحساب مربوط بمتجر آخر");

  let previous: InstagramStoredCredentials = {};
  if (old) {
    try {
      previous = decryptJson<InstagramStoredCredentials>(old.credentialsEncrypted);
    } catch {
      previous = {};
    }
  }
  const data = {
    storeId: input.storeId,
    type: "INSTAGRAM" as const,
    externalAccountId: input.externalAccountId,
    externalBusinessId: input.externalBusinessId,
    name: input.username ? `@${input.username}` : "Instagram Business",
    credentialsEncrypted: encryptJson({
      ...previous,
      accessToken: input.accessToken,
      instagramAccessToken: input.accessToken,
      instagramUserId: input.externalAccountId,
      oauthUserId: input.externalBusinessId,
      graphHost: "instagram" as const,
    }),
    status: "CONNECTED" as const,
    lastConnectedAt: new Date(),
    lastError: null,
  };
  return old
    ? systemDb.channel.update({ where: { id: old.id }, data })
    : systemDb.channel.create({ data });
}

function ids(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

export async function repairInstagramChannel(channel: Channel) {
  if (channel.type !== "INSTAGRAM")
    throw new AppError(422, "NOT_INSTAGRAM_CHANNEL", "القناة ليست Instagram");
  const stored = decryptJson<InstagramStoredCredentials>(channel.credentialsEncrypted);
  const instagramToken =
    stored.instagramAccessToken ??
    (stored.graphHost !== "facebook" ? stored.accessToken : undefined);
  const pageToken =
    stored.facebookPageAccessToken ??
    (stored.pageId ? stored.accessToken : undefined);
  const instagramIds = ids([
    stored.instagramUserId,
    channel.externalAccountId,
    stored.oauthUserId,
  ]);
  const pageIds = ids([stored.pageId, channel.externalBusinessId]);
  const failures: string[] = [];

  if (instagramToken) {
    for (const id of instagramIds) {
      try {
        const fields = await ensureInstagramSubscription(id, instagramToken);
        await systemDb.channel.update({
          where: { id: channel.id },
          data: { webhookSubscribedAt: new Date(), status: "CONNECTED", lastError: null },
        });
        return { mode: "instagram" as const, id, fields };
      } catch (error) {
        failures.push(`Instagram Login (${id}): ${error instanceof Error ? error.message : "subscribe failed"}`);
      }
    }
  }

  if (pageToken) {
    for (const pageId of pageIds) {
      try {
        const fields = await ensureFacebookPageSubscription(pageId, pageToken);
        await systemDb.channel.update({
          where: { id: channel.id },
          data: { webhookSubscribedAt: new Date(), status: "CONNECTED", lastError: null },
        });
        return { mode: "facebook-page" as const, id: pageId, fields };
      } catch (error) {
        failures.push(`Facebook Page (${pageId}): ${error instanceof Error ? error.message : "subscribe failed"}`);
      }
    }
  }

  const message = failures[0] ?? "Instagram token أو Page token ناقص";
  await systemDb.channel.update({
    where: { id: channel.id },
    data: { status: "CONNECTED", lastError: message.slice(0, 1000) },
  });
  throw new AppError(502, "INSTAGRAM_REPAIR_FAILED", message);
}

export async function repairConnectedInstagramChannels() {
  const channels = await systemDb.channel.findMany({
    where: { type: "INSTAGRAM", status: { in: ["CONNECTED", "ERROR"] } },
  });
  let repaired = 0;
  for (const channel of channels) {
    try {
      await repairInstagramChannel(channel);
      repaired++;
    } catch (error) {
      logger.warn({ channelId: channel.id, err: error }, "Instagram channel auto-repair failed");
    }
  }
  return { checked: channels.length, repaired };
}

export function instagramOAuthUrl(state: string) {
  const { appId } = credentials();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_manage_messages",
  );
  url.searchParams.set("state", state);
  url.searchParams.set("force_authentication", "1");
  return url.toString();
}

export async function completeInstagramOAuth(storeId: string, code: string) {
  const { appId, appSecret } = credentials();
  const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const shortData = await json<InstagramTokenResponse>(shortResponse);
  if (!shortResponse.ok || !shortData.access_token || !shortData.user_id)
    throw new AppError(400, "INSTAGRAM_CODE_EXCHANGE_FAILED", errorMessage(shortData));

  const longData = await exchangeLongLivedToken(shortData.access_token, appSecret);
  const accessToken = longData.access_token!;
  const profile = await instagramGraph<InstagramProfile>("me?fields=id,user_id,username", accessToken);
  const oauthUserId = String(profile.user_id ?? shortData.user_id);
  const accountId = String(profile.id ?? profile.user_id ?? oauthUserId);
  if (!accountId)
    throw new AppError(422, "INSTAGRAM_ACCOUNT_NOT_FOUND", "لم نجد حساب Instagram الاحترافي");

  const channel = await saveInstagram({
    storeId,
    externalAccountId: accountId,
    externalBusinessId: oauthUserId,
    username: profile.username,
    accessToken,
  });
  await repairInstagramChannel(channel);
  return { instagram: 1 };
}
