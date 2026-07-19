import { AppError } from "../errors.js";
import { env } from "../config.js";
import { createOrderTool, requestOrderDetailsTool } from "../prompt.js";
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

const tools = [createOrderTool, requestOrderDetailsTool];

function functionCall(response: Resp) {
  return response.output.find((item) => item.type === "function_call");
}

function orderDecisionNeeded(history: Array<{ role: "user" | "assistant"; content: string }>) {
  const userMessages = history
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const latest = userMessages.at(-1) ?? "";
  const all = userMessages.join(" \n ");
  const compact = all.replace(/[\s-]/g, "");
  const hasPhone = /(?:^|\D)0[567]\d{8}(?:\D|$)/.test(compact);
  const hasOrderIntent =
    /(طلبية|نطلب|نحب ندي|نحب نشري|دير(?:لي)? الطلب|سجل(?:لي)? الطلب|ثبت(?:لي)? الطلب|commande|commander|acheter|confirm(?:e|er)?)/i.test(
      all,
    );
  const latestIsConfirmation =
    /^(نعم|ايه|إيه|اه|oui|ok|موافق|أكد|نأكد|صح|ديرها|ثبتها|سجلها|تمام)(?:\s|[.!،])*$/i.test(
      latest,
    );
  return hasOrderIntent || (hasPhone && latestIsConfirmation);
}

function claimsOrderWasCreated(value: string) {
  return /(تسج[ّ]?لت.*طلبي|تم.*(?:تسجيل|تأكيد).*طلبي|رقم الطلب(?:ية)?|order\s*(?:number|#)|commande.*(?:enregistr|confirm))/i.test(
    value,
  );
}

function missingDetailsQuestion(fc: Out) {
  if (fc.name !== "request_order_details" || !fc.arguments) return undefined;
  try {
    const parsed = JSON.parse(fc.arguments) as {
      missing?: unknown;
      question?: unknown;
    };
    if (
      Array.isArray(parsed.missing) &&
      parsed.missing.length > 0 &&
      typeof parsed.question === "string" &&
      parsed.question.trim().length >= 2
    )
      return parsed.question.trim().slice(0, 300);
  } catch {
    // The caller will fall back to a safe clarification question.
  }
  return "باش نثبت الطلبية، زيدلي المعلومة الناقصة من فضلك.";
}

async function orderToolResult(
  fc: Out,
  c: {
    storeId: string;
    channelId: string;
    conversationId: string;
    eventId: string;
  },
) {
  if (fc.name === "request_order_details")
    return {
      question: missingDetailsQuestion(fc),
      tool: { success: false, needsMoreInformation: true },
    };

  let order: CreatedOrder | undefined;
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
    return { order, tool: { success: true, order } };
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : "بيانات الطلب غير صالحة";
    logger.warn(
      {
        eventId: c.eventId,
        storeId: c.storeId,
        channelId: c.channelId,
        toolName: fc.name,
        error: message,
      },
      "Order tool failed",
    );
    return {
      error: message,
      tool: { success: false, error: message },
    };
  }
}

export async function runMerchantAgent(c: {
  storeId: string;
  channelId: string;
  conversationId: string;
  eventId: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ text: string; order?: CreatedOrder; orderError?: string }> {
  const p = provider();
  const input: Msg[] = [{ role: "system", content: c.systemPrompt }, ...c.history];
  const first = await call({
    model: p.model,
    input,
    tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
    ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
    temperature: 0.25,
    max_output_tokens: 700,
  });

  let source = first;
  let fc = functionCall(first);
  if (!fc && orderDecisionNeeded(c.history)) {
    source = await call({
      model: p.model,
      input: [
        ...input,
        {
          role: "system",
          content:
            "تحقق الآن من الطلب فقط: إذا كل البيانات موجودة والزبون وافق صراحة استدع create_order. وإلا استدع request_order_details وحدد سؤالاً واحداً عن أهم معلومة ناقصة. ممنوع الرد النصي وممنوع التخمين.",
        },
      ],
      tools,
      tool_choice: "required",
      parallel_tool_calls: false,
      ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
      temperature: 0.1,
      max_output_tokens: 450,
    });
    fc = functionCall(source);
  }

  if (!fc) {
    const answer = text(first);
    if (!answer) throw new AppError(502, "AI_EMPTY_RESPONSE", "رد فارغ");
    if (claimsOrderWasCreated(answer)) {
      logger.warn(
        { eventId: c.eventId, storeId: c.storeId, channelId: c.channelId },
        "Blocked an order confirmation without a successful order tool call",
      );
      return {
        text: "باش نثبت الطلبية فعلاً، أكدلي المعلومات الأخيرة وما نقولك تم حتى يخرج رقم الطلب من النظام.",
        orderError: "ORDER_CONFIRMATION_WITHOUT_TOOL",
      };
    }
    return { text: answer };
  }

  const result = await orderToolResult(fc, c);
  if (result.question)
    return { text: result.question, orderError: "ORDER_DETAILS_MISSING" };
  if (!fc.call_id)
    return {
      text: result.order
        ? `يعطيك الصحة! تسجّلت طلبيتك ${result.order.orderNumber} والمجموع ${result.order.totalAmount} دج.`
        : `ما قدرتش نثبت الطلب: ${result.error ?? "بيانات ناقصة"}.`,
      order: result.order,
      orderError: result.error,
    };

  const output = {
    type: "function_call_output",
    call_id: fc.call_id,
    output: JSON.stringify(result.tool),
  };
  const second = await call({
    model: p.model,
    input: p.storeResponses ? [output] : [...input, ...source.output, output],
    ...(p.storeResponses ? { previous_response_id: source.id } : {}),
    tools,
    tool_choice: "none",
    ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
    temperature: 0.2,
    max_output_tokens: 400,
  });
  const finalText =
    text(second) ||
    (result.order
      ? `يعطيك الصحة! تسجّلت طلبيتك ${result.order.orderNumber} والمجموع ${result.order.totalAmount} دج.`
      : `ما قدرتش نثبت الطلب: ${result.error ?? "صححلي المعلومة الناقصة"}.`);
  return {
    text:
      !result.order && claimsOrderWasCreated(finalText)
        ? `ما قدرتش نثبت الطلب: ${result.error ?? "صححلي المعلومة الناقصة"}.`
        : finalText,
    order: result.order,
    orderError: result.error,
  };
}
