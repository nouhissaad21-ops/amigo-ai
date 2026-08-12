import { env } from "../config.js";
import { logger } from "../logger.js";

const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;

export async function understandProductImage(
  imageDataUrl: string,
): Promise<string | undefined> {
  if (!env.GROQ_API_KEY || !imageDataUrl.startsWith("data:image/")) return undefined;
  if (Buffer.byteLength(imageDataUrl, "utf8") > MAX_DATA_URL_BYTES * 1.4) return undefined;

  try {
    const response = await fetch(
      `${env.GROQ_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.GROQ_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: env.GROQ_VISION_MODEL,
          temperature: 0.1,
          max_tokens: 350,
          messages: [
            {
              role: "system",
              content:
                "أنت محلل صور لمتجر إلكتروني جزائري. حلل الصورة بدقة وباختصار. استخرج اسم المنتج إن ظهر، اللون، المقاس، الكمية، السعر المكتوب، النصوص المهمة وأي تفاصيل تساعد موظف المبيعات. لا تخترع معلومات غير ظاهرة. أجب بالعربية الواضحة.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "حلل هذه الصورة كأن الزبون أرسلها لمتجر. إذا كانت صورة منتج، صف المنتج والتفاصيل القابلة للاستخدام في البيع. إذا كانت لقطة شاشة أو وثيقة، استخرج المعلومات المهمة.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageDataUrl },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(Math.min(env.AI_TIMEOUT_MS, 12_000)),
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(data.error?.message ?? `vision HTTP ${response.status}`);

    const text = String(data.choices?.[0]?.message?.content ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return text || undefined;
  } catch (error) {
    logger.warn({ err: error }, "Product image understanding failed");
    return undefined;
  }
}
