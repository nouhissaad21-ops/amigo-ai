import "./instagram-poller-runtime.js";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { logger } from "../logger.js";
import { decryptJson, metaAppSecretProof } from "../security.js";

type FacebookCredentials = { accessToken?: string };
type MetaErrorBody = {
  success?: boolean;
  error?: { message?: string; code?: number; type?: string };
};

const subscribedFields = "messages,messaging_postbacks,message_echoes";

async function repairFacebookChannel(channel: {
  id: string;
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
    signal: AbortSignal.timeout(8_000),
  });
  const data = (await response.json().catch(() => ({}))) as MetaErrorBody;
  if (!response.ok || data.error || data.success === false)
    throw new Error(data.error?.message ?? "فشل تفعيل Facebook Webhook");

  await systemDb.channel.update({
    where: { id: channel.id },
    data: {
      status: "CONNECTED",
      webhookSubscribedAt: new Date(),
      lastError: null,
    },
  });
}

export async function repairConnectedFacebookChannels() {
  const channels = await systemDb.channel.findMany({
    where: { type: "FACEBOOK", status: { in: ["CONNECTED", "ERROR"] } },
    select: {
      id: true,
      externalAccountId: true,
      credentialsEncrypted: true,
    },
  });

  let repaired = 0;
  for (const channel of channels) {
    try {
      await repairFacebookChannel(channel);
      repaired++;
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

  return { checked: channels.length, repaired };
}
