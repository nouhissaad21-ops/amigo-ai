import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { decryptJson, encryptJson } from "../security.js";

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
  username?: string;
};

type InstagramCredentials = {
  accessToken?: string;
  instagramUserId?: string;
  oauthUserId?: string;
};

type SubscriptionResponse = InstagramErrorBody & {
  success?: boolean;
  data?: Array<{ id?: string; subscribed_fields?: string[] }>;
};

const requiredWebhookFields = ["messages", "messaging_postbacks"] as const;

function instagramCredentials() {
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET)
    throw new AppError(
      503,
      "INSTAGRAM_NOT_CONFIGURED",
      "Instagram App ID وInstagram App Secret غير مضبوطين",
    );
  return {
    appId: env.INSTAGRAM_APP_ID,
    appSecret: env.INSTAGRAM_APP_SECRET,
  };
}

function redirectUri() {
  return `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/integrations/instagram/callback`;
}

async function responseJson<T>(response: Response): Promise<T & InstagramErrorBody> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T & InstagramErrorBody;
  } catch {
    return { error_message: text.slice(0, 500) } as T & InstagramErrorBody;
  }
}

function instagramErrorMessage(data: InstagramErrorBody) {
  return data.error?.message ?? data.error_message ?? "Instagram رفضت الطلب";
}

async function exchangeLongLivedToken(
  shortToken: string,
  appSecret: string,
): Promise<string> {
  const params = {
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  };
  const endpoints = [
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/access_token`,
    "https://graph.instagram.com/access_token",
  ];
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    const postResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${shortToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
    const postData = await responseJson<InstagramTokenResponse>(postResponse);
    if (postResponse.ok && postData.access_token) return postData.access_token;
    failures.push(`POST ${instagramErrorMessage(postData)}`);

    const getUrl = new URL(endpoint);
    for (const [key, value] of Object.entries(params))
      getUrl.searchParams.set(key, value);
    const getResponse = await fetch(getUrl, {
      headers: { authorization: `Bearer ${shortToken}` },
    });
    const getData = await responseJson<InstagramTokenResponse>(getResponse);
    if (getResponse.ok && getData.access_token) return getData.access_token;
    failures.push(`GET ${instagramErrorMessage(getData)}`);
  }

  throw new AppError(
    400,
    "INSTAGRAM_LONG_TOKEN_FAILED",
    failures.find((message) => !message.includes("method type")) ??
      failures[0] ??
      "تعذر إنشاء رمز Instagram طويل المدة",
  );
}

async function instagramGraph<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`,
  );
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = await responseJson<T>(response);
  if (!response.ok || data.error)
    throw new AppError(
      502,
      "INSTAGRAM_API_ERROR",
      instagramErrorMessage(data),
    );
  return data;
}

function subscriptionUrl(id: string, token: string) {
  const url = new URL(
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${id}/subscribed_apps`,
  );
  // Meta documents both Bearer authentication and access_token on this endpoint.
  // Sending both avoids regional/API-version inconsistencies without exposing it in logs.
  url.searchParams.set("access_token", token);
  return url;
}

async function readInstagramSubscription(id: string, token: string) {
  const response = await fetch(subscriptionUrl(id, token), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await responseJson<SubscriptionResponse>(response);
  if (!response.ok || data.error)
    throw new AppError(
      502,
      "INSTAGRAM_SUBSCRIPTION_CHECK_FAILED",
      instagramErrorMessage(data),
    );
  return new Set(
    (data.data ?? []).flatMap((item) => item.subscribed_fields ?? []),
  );
}

async function writeInstagramSubscription(id: string, token: string) {
  const url = subscriptionUrl(id, token);
  url.searchParams.set("subscribed_fields", requiredWebhookFields.join(","));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await responseJson<SubscriptionResponse>(response);
  if (!response.ok || data.error || data.success === false)
    throw new AppError(
      502,
      "INSTAGRAM_SUBSCRIBE_ERROR",
      instagramErrorMessage(data) || "فشل تفعيل Webhook الخاص بـInstagram",
    );
}

export async function ensureInstagramSubscription(id: string, token: string) {
  await writeInstagramSubscription(id, token);
  const fields = await readInstagramSubscription(id, token);
  const missing = requiredWebhookFields.filter((field) => !fields.has(field));
  if (missing.length)
    throw new AppError(
      502,
      "INSTAGRAM_SUBSCRIPTION_INCOMPLETE",
      `اشتراك Instagram ناقص: ${missing.join(", ")}`,
    );
  return [...fields];
}

async function saveInstagram(input: {
  storeId: string;
  externalAccountId: string;
  externalBusinessId: string;
  username?: string;
  accessToken: string;
}): Promise<Channel> {
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

  const data = {
    storeId: input.storeId,
    type: "INSTAGRAM" as const,
    externalAccountId: input.externalAccountId,
    externalBusinessId: input.externalBusinessId,
    name: input.username ? `@${input.username}` : "Instagram Business",
    credentialsEncrypted: encryptJson({
      accessToken: input.accessToken,
      instagramUserId: input.externalAccountId,
      oauthUserId: input.externalBusinessId,
    }),
    status: "CONNECTED" as const,
    lastConnectedAt: new Date(),
    lastError: null,
  };
  return old
    ? systemDb.channel.update({ where: { id: old.id }, data })
    : systemDb.channel.create({ data });
}

function channelInstagramIds(channel: Channel, credentials: InstagramCredentials) {
  return [
    channel.externalAccountId,
    credentials.instagramUserId,
    channel.externalBusinessId,
    credentials.oauthUserId,
  ].filter((value, index, all): value is string =>
    Boolean(value) && all.indexOf(value) === index,
  );
}

export async function repairInstagramChannel(channel: Channel) {
  if (channel.type !== "INSTAGRAM")
    throw new AppError(422, "NOT_INSTAGRAM_CHANNEL", "القناة ليست Instagram");
  const credentials = decryptJson<InstagramCredentials>(
    channel.credentialsEncrypted,
  );
  if (!credentials.accessToken)
    throw new AppError(500, "MISSING_TOKEN", "Instagram Token ناقص");

  const failures: string[] = [];
  for (const id of channelInstagramIds(channel, credentials)) {
    try {
      const fields = await ensureInstagramSubscription(id, credentials.accessToken);
      await systemDb.channel.update({
        where: { id: channel.id },
        data: {
          externalAccountId: id,
          webhookSubscribedAt: new Date(),
          status: "CONNECTED",
          lastError: null,
        },
      });
      return { id, fields };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "subscribe failed");
    }
  }

  const message = failures[0] ?? "فشل إصلاح اشتراك Instagram";
  await systemDb.channel.update({
    where: { id: channel.id },
    data: { status: "ERROR", lastError: message },
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
      logger.warn(
        { channelId: channel.id, err: error },
        "Instagram channel auto-repair failed",
      );
    }
  }
  return { checked: channels.length, repaired };
}

export function instagramOAuthUrl(state: string) {
  const credentials = instagramCredentials();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", credentials.appId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_manage_messages",
  );
  url.searchParams.set("state", state);
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  return url.toString();
}

export async function completeInstagramOAuth(storeId: string, code: string) {
  const credentials = instagramCredentials();
  const shortBody = new URLSearchParams({
    client_id: credentials.appId,
    client_secret: credentials.appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  const shortResponse = await fetch(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: shortBody,
    },
  );
  const shortData = await responseJson<InstagramTokenResponse>(shortResponse);
  if (!shortResponse.ok || !shortData.access_token || !shortData.user_id)
    throw new AppError(
      400,
      "INSTAGRAM_CODE_EXCHANGE_FAILED",
      instagramErrorMessage(shortData),
    );

  const accessToken = await exchangeLongLivedToken(
    shortData.access_token,
    credentials.appSecret,
  );
  const profile = await instagramGraph<InstagramProfile>(
    "me?fields=id,username",
    accessToken,
  );
  const oauthUserId = String(shortData.user_id);
  const accountId = profile.id ?? oauthUserId;
  if (!accountId)
    throw new AppError(
      422,
      "INSTAGRAM_ACCOUNT_NOT_FOUND",
      "لم نجد حساب Instagram الاحترافي",
    );

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
