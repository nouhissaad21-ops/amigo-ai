import { AppError } from "../errors.js";
import { env } from "../config.js";
import { createOrderTool } from "../prompt.js";
import { orderToolSchema } from "../schemas.js";
import { createOrderFromTool, type CreatedOrder } from "./orders.js";
import { logger } from "../logger.js";
type Msg = { role: "system" | "user" | "assistant"; content: string };
type Out = {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type: string; text?: string }>;
  [k: string]: unknown;
};
type Resp = { id: string; output: Out[]; status: string; error?: unknown };
const provider = () =>
  env.AI_PROVIDER === "groq"
    ? {
        name: "Groq",
        apiKey: env.GROQ_API_KEY!,
        baseUrl: env.GROQ_BASE_URL.replace(/\/$/, ""),
        model: env.GROQ_MODEL,
        storeResponses: false,
      }
    : {
        name: "xAI",
        apiKey: env.XAI_API_KEY!,
        baseUrl: env.XAI_BASE_URL.replace(/\/$/, ""),
        model: env.XAI_MODEL,
        storeResponses: env.XAI_STORE_RESPONSES,
      };
const text = (r: Resp) =>
  r.output
    .filter((x) => x.type === "message")
    .flatMap((x) => x.content ?? [])
    .filter((x) => x.type === "output_text")
    .map((x) => x.text ?? "")
    .join("\n")
    .trim();
async function call(body: Record<string, unknown>): Promise<Resp> {
  const p = provider();
  const r = await fetch(`${p.baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${p.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
  });
  if (!r.ok) {
    logger.warn(
      {
        provider: p.name,
        status: r.status,
        detail: (await r.text()).slice(0, 1000),
      },
      "AI provider rejected",
    );
    throw new AppError(
      502,
      "AI_PROVIDER_ERROR",
      "خدمة الذكاء الاصطناعي غير متاحة",
    );
  }
  const result = (await r.json()) as Resp;
  if (result.status !== "completed" || result.error)
    throw new AppError(502, "AI_INCOMPLETE", "لم يكتمل الرد");
  return result;
}
export async function runMerchantAgent(c: {
  storeId: string;
  channelId: string;
  conversationId: string;
  eventId: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ text: string; order?: CreatedOrder }> {
  const p = provider(),
    input: Msg[] = [{ role: "system", content: c.systemPrompt }, ...c.history],
    first = await call({
      model: p.model,
      input,
      tools: [createOrderTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
      temperature: 0.35,
      max_output_tokens: 700,
    }),
    fc = first.output.find((x) => x.type === "function_call");
  if (!fc) {
    const t = text(first);
    if (!t) throw new AppError(502, "AI_EMPTY_RESPONSE", "رد فارغ");
    return { text: t };
  }
  let order: CreatedOrder | undefined, tool: Record<string, unknown>;
  try {
    if (fc.name !== "create_order" || !fc.arguments) throw new Error();
    const parsed = orderToolSchema.parse(JSON.parse(fc.arguments));
    order = await createOrderFromTool({
      storeId: c.storeId,
      channelId: c.channelId,
      conversationId: c.conversationId,
      idempotencyKey: c.eventId,
      input: parsed,
    });
    tool = { success: true, order };
  } catch (e) {
    tool = {
      success: false,
      error: e instanceof AppError ? e.message : "بيانات الطلب غير صالحة",
    };
  }
  const output = {
      type: "function_call_output",
      call_id: fc.call_id,
      output: JSON.stringify(tool),
    },
    second = await call({
      model: p.model,
      input: p.storeResponses ? [output] : [...input, ...first.output, output],
      ...(p.storeResponses ? { previous_response_id: first.id } : {}),
      tools: [createOrderTool],
      tool_choice: "none",
      ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
      temperature: 0.25,
      max_output_tokens: 400,
    });
  return {
    text:
      text(second) ||
      (order
        ? `يعطيك الصحة! تسجّلت طلبيتك ${order.orderNumber} والمجموع ${order.totalAmount} دج.`
        : "ما قدرتش نثبت الطلب، صححلي المعلومة."),
    order,
  };
}
