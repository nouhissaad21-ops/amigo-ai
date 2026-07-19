import type { Channel, ChannelType } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { encryptJson, metaAppSecretProof } from "../security.js";

type InstagramBusinessAccount = {
  id: string;
  username?: string;
};

type Page = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: InstagramBusinessAccount;
};

type MetaErrorBody = {
  error?: { message?: string; code?: number; type?: string };
};

function metaCredentials() {
  if (!env.META_APP_ID || !env.META_APP_SECRET)
    throw new AppError(
      503,
      "META_NOT_CONFIGURED",
      "ربط Meta مازال ما تفعّلش في إعدادات المنصة",
    );
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET };
}

async function graph<T>(path: string, token?: string): Promise<T> {
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,
  );
  if (token) url.searchParams.set("appsecret_proof", metaAppSecretProof(token));

  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const data = (await response.json()) as T & MetaErrorBody;
  if (!response.ok || data.error)
    throw new AppError(
      502,
      "META_API_ERROR",
      data.error?.message ?? "Meta رفضت الطلب",
    );
  return data;
}

async function subscribe(id: string, token: string, fields: string) {
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${id}/subscribed_apps`,
  );
  url.searchParams.set("subscribed_fields", fields);
  url.searchParams.set("appsecret_proof", metaAppSecretProof(token));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new AppError(502, "META_SUBSCRIBE_ERROR", "فشل Webhook subscription");
}

async function save(input: {
  storeId: string;
  type: ChannelType;
  externalAccountId: string;
  externalBusinessId?: string;
  name: string;
  accessToken: string;
}): Promise<Channel> {
  const old = await systemDb.channel.findUnique({
    where: {
      type_externalAccountId: {
        type: input.type,
        externalAccountId: input.externalAccountId,
      },
    },
  });
  if (old && old.storeId !== input.storeId)
    throw new AppError(409, "CHANNEL_ALREADY_LINKED", "الحساب مربوط بمتجر آخر");

  const data = {
    storeId: input.storeId,
    type: input.type,
    externalAccountId: input.externalAccountId,
    externalBusinessId: input.externalBusinessId ?? null,
    name: input.name,
    credentialsEncrypted: encryptJson({ accessToken: input.accessToken }),
    status: "CONNECTED" as const,
    lastConnectedAt: new Date(),
    lastError: null,
  };
  return old
    ? systemDb.channel.update({ where: { id: old.id }, data })
    : systemDb.channel.create({ data });
}

export function metaOAuthUrl(state: string) {
  const credentials = metaCredentials();
  const url = new URL(
    `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`,
  );
  const scopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
    "pages_messaging",
  ];
  if (env.META_ENABLE_INSTAGRAM) {
    scopes.push("instagram_basic", "instagram_manage_messages");
  }

  url.searchParams.set("client_id", credentials.appId);
  url.searchParams.set("redirect_uri", env.META_OAUTH_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("auth_type", "rerequest");
  return url.toString();
}

export async function completeMetaOAuth(storeId: string, code: string) {
  const credentials = metaCredentials();
  const exchangeUrl = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/oauth/access_token`,
  );
  exchangeUrl.searchParams.set("client_id", credentials.appId);
  exchangeUrl.searchParams.set("client_secret", credentials.appSecret);
  exchangeUrl.searchParams.set("redirect_uri", env.META_OAUTH_REDIRECT_URI);
  exchangeUrl.searchParams.set("code", code);

  const exchangeResponse = await fetch(exchangeUrl);
  const exchangeData = (await exchangeResponse.json()) as {
    access_token?: string;
  } & MetaErrorBody;
  if (!exchangeResponse.ok || !exchangeData.access_token)
    throw new AppError(
      400,
      "META_CODE_EXCHANGE_FAILED",
      exchangeData.error?.message ?? "فشل تبديل code",
    );

  const longTokenUrl = new URL(exchangeUrl);
  longTokenUrl.searchParams.delete("redirect_uri");
  longTokenUrl.searchParams.delete("code");
  longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
  longTokenUrl.searchParams.set("fb_exchange_token", exchangeData.access_token);
  const longTokenResponse = await fetch(longTokenUrl);
  const longTokenData = (await longTokenResponse.json()) as {
    access_token?: string;
  } & MetaErrorBody;
  if (!longTokenResponse.ok || !longTokenData.access_token)
    throw new AppError(
      400,
      "META_LONG_TOKEN_FAILED",
      longTokenData.error?.message ?? "فشل Long-lived token",
    );

  const fields = ["id", "name", "access_token"];
  if (env.META_ENABLE_INSTAGRAM)
    fields.push("instagram_business_account{id,username}");
  const pages = await graph<{ data: Page[] }>(
    `me/accounts?fields=${encodeURIComponent(fields.join(","))}&limit=100`,
    longTokenData.access_token,
  );
  if (!pages.data.length)
    throw new AppError(
      422,
      "META_NO_PAGES",
      "Meta لم تعرض أي صفحة لهذا الحساب. عيّن الصفحة للحساب داخل Business Portfolio، ثم احذف AmiGo AI من عمليات دمج الأعمال وأعد الربط.",
    );

  let facebook = 0;
  let instagram = 0;
  let failed = 0;
  for (const page of pages.data) {
    const pageChannel = await save({
      storeId,
      type: "FACEBOOK",
      externalAccountId: page.id,
      name: page.name,
      accessToken: page.access_token,
    });

    let subscribedAt: Date | null = null;
    let subscribeError: string | null = null;
    try {
      await subscribe(
        page.id,
        page.access_token,
        "messages,messaging_postbacks,message_echoes",
      );
      subscribedAt = new Date();
      await systemDb.channel.update({
        where: { id: pageChannel.id },
        data: { webhookSubscribedAt: subscribedAt },
      });
      facebook++;
    } catch (error) {
      subscribeError =
        error instanceof Error ? error.message : "subscribe failed";
      await systemDb.channel.update({
        where: { id: pageChannel.id },
        data: { status: "ERROR", lastError: subscribeError },
      });
      failed++;
    }

    const account = page.instagram_business_account;
    if (env.META_ENABLE_INSTAGRAM && account) {
      const instagramChannel = await save({
        storeId,
        type: "INSTAGRAM",
        externalAccountId: account.id,
        externalBusinessId: page.id,
        name: account.username
          ? `@${account.username}`
          : `${page.name} Instagram`,
        accessToken: page.access_token,
      });
      await systemDb.channel.update({
        where: { id: instagramChannel.id },
        data: subscribedAt
          ? { webhookSubscribedAt: subscribedAt }
          : { status: "ERROR", lastError: subscribeError },
      });
      if (subscribedAt) instagram++;
      else failed++;
    }
  }

  if (!facebook && !instagram && failed)
    throw new AppError(
      502,
      "META_SUBSCRIBE_ERROR",
      "تم العثور على الصفحة لكن تعذر تفعيل Webhook عليها",
    );

  return { facebook, instagram };
}
