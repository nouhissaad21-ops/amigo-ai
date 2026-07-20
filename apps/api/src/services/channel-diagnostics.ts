import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { decryptJson, metaAppSecretProof } from "../security.js";
import { repairConnectedFacebookChannels } from "./facebook.js";
import {
  repairInstagramChannel,
  type InstagramStoredCredentials,
} from "./instagram.js";
import {
  pollInstagramChannelNow,
  probeInstagramChannel,
} from "./instagram-poller.js";

type MetaCredentials = InstagramStoredCredentials & {
  accessToken?: string;
};

export type DiagnosticState = "PASS" | "WARN" | "FAIL" | "INFO";

export type ChannelDiagnosticCheck = {
  key: string;
  label: string;
  state: DiagnosticState;
  summary: string;
  detail?: string;
};

export type ChannelDiagnostics = {
  channelId: string;
  channelType: Channel["type"];
  overall: "READY" | "DEGRADED" | "BLOCKED";
  checkedAt: string;
  checks: ChannelDiagnosticCheck[];
  activity: {
    lastWebhookAt: string | null;
    lastWebhookStatus: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastOutboundStatus: string | null;
    failedWebhookEvents: number;
    queuedOutboundMessages: number;
  };
  recommendations: string[];
};

type ApiError = {
  error?: { message?: string; code?: number; type?: string };
  data?: Array<{ subscribed_fields?: string[] }>;
  id?: string;
  username?: string;
};

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "فشل الطلب";
  return message.replace(/(?:IGAA|IGAG|EAA)[A-Za-z0-9_-]+/g, "[token]").slice(0, 700);
}

async function fetchJson(url: URL, token?: string) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(7_000),
  });
  const text = await response.text();
  let data: ApiError;
  try {
    data = JSON.parse(text) as ApiError;
  } catch {
    data = {};
  }
  if (!response.ok || data.error)
    throw new Error(
      data.error?.message ?? `HTTP ${response.status}: ${text.slice(0, 240)}`,
    );
  return data;
}

function classifyMetaError(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("oauth") ||
    normalized.includes("token") ||
    normalized.includes("session has expired") ||
    normalized.includes("code 190")
  )
    return "رمز الوصول منتهي أو غير صالح؛ أعد ربط الحساب.";
  if (
    normalized.includes("permission") ||
    normalized.includes("does not have") ||
    normalized.includes("not authorized") ||
    normalized.includes("(#10)") ||
    normalized.includes("(#200)")
  )
    return "صلاحية إدارة الرسائل غير متاحة لهذا التوكن أو تحتاج Advanced Access.";
  if (normalized.includes("unsupported request"))
    return "Meta رفضت مسار الحساب؛ غالباً نوع التوكن أو مستوى الوصول غير مطابق.";
  return message;
}

async function callbackCheck(): Promise<ChannelDiagnosticCheck> {
  const challenge = `amigo-${Date.now()}`;
  const url = new URL(
    "/api/webhooks/meta",
    env.API_PUBLIC_URL.replace(/\/$/, "") + "/",
  );
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", env.META_VERIFY_TOKEN);
  url.searchParams.set("hub.challenge", challenge);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7_000) });
    const text = await response.text();
    if (response.ok && text === challenge)
      return {
        key: "callback",
        label: "رابط Webhook العام",
        state: "PASS",
        summary: "Meta تستطيع الوصول إلى رابط الاستقبال والتحقق منه.",
      };
    return {
      key: "callback",
      label: "رابط Webhook العام",
      state: "FAIL",
      summary: `الرابط رجع HTTP ${response.status} ولم يُرجع challenge الصحيح.`,
    };
  } catch (error) {
    return {
      key: "callback",
      label: "رابط Webhook العام",
      state: "FAIL",
      summary: "الخادم لم يستطع الوصول إلى رابط Webhook العام.",
      detail: publicError(error),
    };
  }
}

function instagramTokens(channel: Channel, credentials: MetaCredentials) {
  const instagramToken =
    credentials.instagramAccessToken ??
    (credentials.graphHost !== "facebook" ? credentials.accessToken : undefined);
  const pageToken =
    credentials.facebookPageAccessToken ??
    (credentials.pageId ? credentials.accessToken : undefined);
  return {
    instagramToken,
    pageToken,
    instagramId: credentials.instagramUserId ?? channel.externalAccountId,
    pageId: credentials.pageId ?? channel.externalBusinessId,
  };
}

async function instagramIdentityCheck(
  channel: Channel,
  credentials: MetaCredentials,
): Promise<ChannelDiagnosticCheck> {
  const { instagramToken, pageToken, instagramId } = instagramTokens(
    channel,
    credentials,
  );
  const failures: string[] = [];

  if (instagramToken) {
    const url = new URL(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/me`,
    );
    url.searchParams.set("fields", "id,username");
    try {
      const data = await fetchJson(url, instagramToken);
      return {
        key: "identity",
        label: "هوية حساب Instagram",
        state: "PASS",
        summary: data.username
          ? `التوكن يقرأ الحساب @${data.username}.`
          : `التوكن يقرأ الحساب ${data.id ?? instagramId}.`,
      };
    } catch (error) {
      failures.push(`Instagram Login: ${publicError(error)}`);
    }
  }

  if (pageToken && instagramId) {
    const url = new URL(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${instagramId}`,
    );
    url.searchParams.set("fields", "id,username");
    if (env.META_APP_SECRET)
      url.searchParams.set("appsecret_proof", metaAppSecretProof(pageToken));
    try {
      const data = await fetchJson(url, pageToken);
      return {
        key: "identity",
        label: "هوية حساب Instagram",
        state: "PASS",
        summary: data.username
          ? `Page token يقرأ الحساب @${data.username}.`
          : `Page token يقرأ حساب Instagram ${data.id ?? instagramId}.`,
      };
    } catch (error) {
      failures.push(`Facebook Page: ${publicError(error)}`);
    }
  }

  const detail = failures.join(" | ") || "لا يوجد Instagram token أو Page token محفوظ.";
  return {
    key: "identity",
    label: "هوية حساب Instagram",
    state: "FAIL",
    summary: classifyMetaError(detail),
    detail,
  };
}

async function instagramSubscriptionCheck(
  channel: Channel,
  credentials: MetaCredentials,
): Promise<ChannelDiagnosticCheck> {
  const { instagramToken, pageToken, instagramId, pageId } = instagramTokens(
    channel,
    credentials,
  );
  const successes: string[] = [];
  const failures: string[] = [];

  if (instagramToken && instagramId) {
    const url = new URL(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${instagramId}/subscribed_apps`,
    );
    try {
      const data = await fetchJson(url, instagramToken);
      const fields = (data.data ?? []).flatMap(
        (item) => item.subscribed_fields ?? [],
      );
      successes.push(
        fields.length
          ? `Instagram Login: ${fields.join(", ")}`
          : "Instagram Login: endpoint reachable",
      );
    } catch (error) {
      failures.push(`Instagram Login: ${publicError(error)}`);
    }
  }

  if (pageToken && pageId) {
    const url = new URL(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${pageId}/subscribed_apps`,
    );
    if (env.META_APP_SECRET)
      url.searchParams.set("appsecret_proof", metaAppSecretProof(pageToken));
    try {
      const data = await fetchJson(url, pageToken);
      const fields = (data.data ?? []).flatMap(
        (item) => item.subscribed_fields ?? [],
      );
      successes.push(
        fields.length
          ? `Facebook Page: ${fields.join(", ")}`
          : "Facebook Page: endpoint reachable",
      );
    } catch (error) {
      failures.push(`Facebook Page: ${publicError(error)}`);
    }
  }

  if (successes.length)
    return {
      key: "subscription",
      label: "اشتراك أحداث الرسائل",
      state: "PASS",
      summary: "يوجد مسار اشتراك Webhook قابل للقراءة.",
      detail: successes.join(" | "),
    };

  const detail = failures.join(" | ") || "لم نجد مسار اشتراك صالحاً.";
  return {
    key: "subscription",
    label: "اشتراك أحداث الرسائل",
    state: "FAIL",
    summary: classifyMetaError(detail),
    detail,
  };
}

async function localActivity(channel: Channel) {
  const [lastWebhook, lastInbound, lastOutbound, failedWebhookEvents, queued] =
    await Promise.all([
      systemDb.webhookEvent.findFirst({
        where: { channelId: channel.id },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, status: true, lastError: true },
      }),
      systemDb.message.findFirst({
        where: { channelId: channel.id, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      systemDb.message.findFirst({
        where: { channelId: channel.id, direction: "OUTBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true, error: true },
      }),
      systemDb.webhookEvent.count({
        where: { channelId: channel.id, status: "FAILED" },
      }),
      systemDb.message.count({
        where: {
          channelId: channel.id,
          direction: "OUTBOUND",
          status: { in: ["QUEUED", "PROCESSING", "FAILED"] },
        },
      }),
    ]);

  return {
    activity: {
      lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
      lastWebhookStatus: lastWebhook?.status ?? null,
      lastInboundAt: lastInbound?.createdAt.toISOString() ?? null,
      lastOutboundAt: lastOutbound?.createdAt.toISOString() ?? null,
      lastOutboundStatus: lastOutbound?.status ?? null,
      failedWebhookEvents,
      queuedOutboundMessages: queued,
    },
    lastWebhookError: lastWebhook?.lastError ?? null,
    lastOutboundError: lastOutbound?.error ?? null,
  };
}

export async function diagnoseChannel(
  storeId: string,
  channelId: string,
): Promise<ChannelDiagnostics> {
  const channel = await systemDb.channel.findFirst({
    where: { id: channelId, storeId },
  });
  if (!channel)
    throw new AppError(404, "CHANNEL_NOT_FOUND", "القناة غير موجودة");

  const checks: ChannelDiagnosticCheck[] = [];
  const recommendations: string[] = [];
  const local = await localActivity(channel);

  checks.push(await callbackCheck());
  if (channel.type === "INSTAGRAM") {
    let credentials: MetaCredentials;
    try {
      credentials = decryptJson<MetaCredentials>(channel.credentialsEncrypted);
      checks.push({
        key: "credentials",
        label: "بيانات الربط المشفرة",
        state:
          credentials.accessToken ||
          credentials.instagramAccessToken ||
          credentials.facebookPageAccessToken
            ? "PASS"
            : "FAIL",
        summary:
          credentials.accessToken ||
          credentials.instagramAccessToken ||
          credentials.facebookPageAccessToken
            ? "يوجد توكن محفوظ ومشفر للقناة."
            : "لا يوجد توكن قابل للاستعمال.",
      });
    } catch (error) {
      credentials = {};
      checks.push({
        key: "credentials",
        label: "بيانات الربط المشفرة",
        state: "FAIL",
        summary: "تعذر فك بيانات القناة؛ يجب إعادة الربط.",
        detail: publicError(error),
      });
    }

    checks.push(await instagramIdentityCheck(channel, credentials));
    checks.push(await instagramSubscriptionCheck(channel, credentials));

    const probe = await probeInstagramChannel(channel);
    checks.push({
      key: "conversations",
      label: "قراءة صندوق Instagram",
      state: probe.reachable ? "PASS" : "FAIL",
      summary: probe.reachable
        ? probe.conversationCount
          ? `تم الوصول إلى ${probe.conversationCount} محادثة على الأقل.`
          : "Conversations API متاحة لكن القائمة فارغة حالياً."
        : "تعذر الوصول إلى Conversations API بكل التوكنات والمسارات.",
      detail: [
        ...probe.sources.map(
          (source) =>
            `${source.key}: ${source.conversationCount} conversation(s)`,
        ),
        ...probe.failures,
      ]
        .join(" | ")
        .slice(0, 1000),
    });

    checks.push({
      key: "production-access",
      label: "الوصول الإنتاجي لدى Meta",
      state: "INFO",
      summary:
        "AmiGo لا يستطيع قراءة حالة Advanced Access آلياً. قبل استقبال أي زبون، يجب أن يكون التطبيق Live وأن تكون instagram_business_manage_messages في Advanced Access.",
    });

    if (!local.activity.lastInboundAt) {
      recommendations.push(
        "لم تصل أي رسالة Instagram إلى قاعدة البيانات حتى الآن. اختبر من حساب له دور في التطبيق؛ وللزبائن العاديين أكمل App Review وAdvanced Access.",
      );
    }
    if (!probe.reachable)
      recommendations.push("أعد ربط Instagram لأن التوكن أو صلاحية الرسائل مرفوضة.");
  } else {
    checks.push({
      key: "channel-type",
      label: "نوع القناة",
      state: "INFO",
      summary: "التشخيص العميق الحالي مخصص لـInstagram؛ نشاط القناة المحلي مفحوص.",
    });
  }

  checks.push({
    key: "inbound-activity",
    label: "آخر رسالة داخلة",
    state: local.activity.lastInboundAt ? "PASS" : "WARN",
    summary: local.activity.lastInboundAt
      ? `آخر رسالة دخلت AmiGo: ${local.activity.lastInboundAt}`
      : "لم تُسجل أي رسالة داخلة لهذه القناة.",
    detail: local.lastWebhookError ?? undefined,
  });
  checks.push({
    key: "outbound-activity",
    label: "حالة الإرسال",
    state:
      local.activity.queuedOutboundMessages > 0 || local.lastOutboundError
        ? "WARN"
        : "PASS",
    summary:
      local.activity.queuedOutboundMessages > 0
        ? `توجد ${local.activity.queuedOutboundMessages} رسالة خارجة معلقة أو فاشلة.`
        : local.activity.lastOutboundAt
          ? `آخر إرسال: ${local.activity.lastOutboundStatus ?? "UNKNOWN"}.`
          : "لا توجد محاولة إرسال بعد.",
    detail: local.lastOutboundError ?? undefined,
  });

  if (local.activity.failedWebhookEvents)
    recommendations.push(
      `توجد ${local.activity.failedWebhookEvents} أحداث Webhook فاشلة؛ زر الإصلاح سيعيد فحص الرسائل المعلقة.`,
    );
  if (local.lastOutboundError)
    recommendations.push(`آخر خطأ إرسال: ${local.lastOutboundError}`);

  const hasFailure = checks.some((check) => check.state === "FAIL");
  const hasWarning = checks.some((check) => check.state === "WARN");
  return {
    channelId: channel.id,
    channelType: channel.type,
    overall: hasFailure ? "BLOCKED" : hasWarning ? "DEGRADED" : "READY",
    checkedAt: new Date().toISOString(),
    checks,
    activity: local.activity,
    recommendations: [...new Set(recommendations)],
  };
}

export async function repairAndDiagnoseChannel(
  storeId: string,
  channelId: string,
) {
  const channel = await systemDb.channel.findFirst({
    where: { id: channelId, storeId },
  });
  if (!channel)
    throw new AppError(404, "CHANNEL_NOT_FOUND", "القناة غير موجودة");

  const repairs: string[] = [];
  if (channel.type === "INSTAGRAM") {
    try {
      const result = await repairInstagramChannel(channel);
      repairs.push(`Webhook subscription repaired via ${result.mode}.`);
    } catch (error) {
      repairs.push(`Subscription repair: ${publicError(error)}`);
    }
    try {
      const result = await pollInstagramChannelNow(channel);
      repairs.push(`Inbox poll captured ${result.captured} new message(s).`);
    } catch (error) {
      repairs.push(`Inbox poll: ${publicError(error)}`);
    }
  } else if (channel.type === "FACEBOOK") {
    const result = await repairConnectedFacebookChannels();
    repairs.push(`Facebook repair checked ${result.checked} channel(s).`);
  }

  return {
    repairs,
    diagnostics: await diagnoseChannel(storeId, channelId),
  };
}
