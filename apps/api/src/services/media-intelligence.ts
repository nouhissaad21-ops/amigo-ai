import type { Channel } from "@prisma/client";
import { env } from "../config.js";
import { logger } from "../logger.js";
import { decryptJson } from "../security.js";

type MediaCredentials = {
  accessToken?: string;
  instagramAccessToken?: string;
  facebookPageAccessToken?: string;
};

type TranscriptionResponse = {
  text?: string;
  error?: { message?: string };
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function channelToken(channel: Channel) {
  try {
    const credentials = decryptJson<MediaCredentials>(channel.credentialsEncrypted);
    return (
      credentials.instagramAccessToken ??
      credentials.facebookPageAccessToken ??
      credentials.accessToken
    );
  } catch {
    return undefined;
  }
}

function audioFilename(contentType: string) {
  if (contentType.includes("mpeg")) return "voice.mp3";
  if (contentType.includes("mp4")) return "voice.m4a";
  if (contentType.includes("wav")) return "voice.wav";
  if (contentType.includes("webm")) return "voice.webm";
  if (contentType.includes("flac")) return "voice.flac";
  return "voice.ogg";
}

export function audioAttachmentUrl(event: any) {
  const message = event?.message ?? event;
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];
  const audio = attachments.find((attachment: any) =>
    ["audio", "voice"].includes(String(attachment?.type ?? "").toLowerCase()),
  );
  const url = audio?.payload?.url ?? audio?.url;
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : undefined;
}

export async function transcribeMetaVoice(
  channel: Channel,
  url: string,
): Promise<string | undefined> {
  if (!env.GROQ_API_KEY) return undefined;

  try {
    const token = channelToken(channel);
    const mediaResponse = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!mediaResponse.ok)
      throw new Error(`media HTTP ${mediaResponse.status}`);

    const contentLength = Number(mediaResponse.headers.get("content-length") ?? 0);
    if (contentLength > MAX_AUDIO_BYTES)
      throw new Error("voice note exceeds 25 MB");

    const bytes = await mediaResponse.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES)
      throw new Error("voice note size is invalid");

    const contentType =
      mediaResponse.headers.get("content-type")?.split(";")[0] ?? "audio/ogg";
    const form = new FormData();
    form.set(
      "file",
      new Blob([bytes], { type: contentType }),
      audioFilename(contentType),
    );
    form.set("model", env.GROQ_TRANSCRIPTION_MODEL);
    form.set("response_format", "json");
    form.set("temperature", "0");
    form.set(
      "prompt",
      "محادثة متجر إلكتروني بالدارجة الجزائرية أو العربية أو الفرنسية. اكتب الكلام كما قيل مع أسماء المنتجات والأرقام بدقة.",
    );

    const response = await fetch(
      `${env.GROQ_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(25_000),
      },
    );
    const data = (await response.json().catch(() => ({}))) as TranscriptionResponse;
    if (!response.ok)
      throw new Error(data.error?.message ?? `transcription HTTP ${response.status}`);

    const text = String(data.text ?? "").replace(/\s+/g, " ").trim();
    return text || undefined;
  } catch (error) {
    logger.warn(
      {
        err: error,
        channelId: channel.id,
        channelType: channel.type,
      },
      "Customer voice transcription failed",
    );
    return undefined;
  }
}
