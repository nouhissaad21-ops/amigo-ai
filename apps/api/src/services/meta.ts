import type { Channel, ChannelType } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { encryptJson, metaAppSecretProof } from "../security.js";
type Page = {
  id: string;
  name: string;
  access_token: string;
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
  const u = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,
  );
  if (token) u.searchParams.set("appsecret_proof", metaAppSecretProof(token));
  const r = await fetch(u, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    d = (await r.json()) as T & { error?: { message?: string } };
  if (!r.ok || d.error)
    throw new AppError(
      502,
      "META_API_ERROR",
      d.error?.message ?? "Meta رفضت الطلب",
    );
  return d;
}
async function subscribe(id: string, token: string, fields: string) {
  const u = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${id}/subscribed_apps`,
  );
  u.searchParams.set("subscribed_fields", fields);
  u.searchParams.set("appsecret_proof", metaAppSecretProof(token));
  const r = await fetch(u, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok)
    throw new AppError(502, "META_SUBSCRIBE_ERROR", "فشل Webhook subscription");
}
async function save(x: {
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
        type: x.type,
        externalAccountId: x.externalAccountId,
      },
    },
  });
  if (old && old.storeId !== x.storeId)
    throw new AppError(409, "CHANNEL_ALREADY_LINKED", "الحساب مربوط بمتجر آخر");
  const data = {
    storeId: x.storeId,
    type: x.type,
    externalAccountId: x.externalAccountId,
    externalBusinessId: x.externalBusinessId ?? null,
    name: x.name,
    credentialsEncrypted: encryptJson({ accessToken: x.accessToken }),
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
  const u = new URL(
    `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`,
  );
  u.searchParams.set("client_id", credentials.appId);
  u.searchParams.set("redirect_uri", env.META_OAUTH_REDIRECT_URI);
  u.searchParams.set("state", state);
  u.searchParams.set(
    "scope",
    [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_messaging",
    ].join(","),
  );
  return u.toString();
}
export async function completeMetaOAuth(storeId: string, code: string) {
  const credentials = metaCredentials();
  const a = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/oauth/access_token`,
  );
  a.searchParams.set("client_id", credentials.appId);
  a.searchParams.set("client_secret", credentials.appSecret);
  a.searchParams.set("redirect_uri", env.META_OAUTH_REDIRECT_URI);
  a.searchParams.set("code", code);
  const ar = await fetch(a),
    ad = (await ar.json()) as { access_token?: string };
  if (!ar.ok || !ad.access_token)
    throw new AppError(400, "META_CODE_EXCHANGE_FAILED", "فشل تبديل code");
  const l = new URL(a);
  l.searchParams.delete("redirect_uri");
  l.searchParams.delete("code");
  l.searchParams.set("grant_type", "fb_exchange_token");
  l.searchParams.set("fb_exchange_token", ad.access_token);
  const lr = await fetch(l),
    ld = (await lr.json()) as { access_token?: string };
  if (!lr.ok || !ld.access_token)
    throw new AppError(400, "META_LONG_TOKEN_FAILED", "فشل Long-lived token");
  const pages = await graph<{ data: Page[] }>(
    `me/accounts?fields=${encodeURIComponent("id,name,access_token")}&limit=100`,
    ld.access_token,
  );
  let facebook = 0,
    instagram = 0;
  for (const p of pages.data) {
    const ch = await save({
      storeId,
      type: "FACEBOOK",
      externalAccountId: p.id,
      name: p.name,
      accessToken: p.access_token,
    });
    try {
      await subscribe(
        p.id,
        p.access_token,
        "messages,messaging_postbacks,message_echoes",
      );
      await systemDb.channel.update({
        where: { id: ch.id },
        data: { webhookSubscribedAt: new Date() },
      });
    } catch (e) {
      await systemDb.channel.update({
        where: { id: ch.id },
        data: { status: "ERROR", lastError: (e as Error).message },
      });
    }
    facebook++;
  }
  return { facebook, instagram };
}
