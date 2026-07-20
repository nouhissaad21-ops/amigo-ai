import crypto from "node:crypto";
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
type ToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
type GroqResponse = {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryBodies(body: Record<string, unknown>) {
  const attempts = [body];
  if (env.AI_PROVIDER !== "groq") return attempts;

  if (body.tool_choice === "required")
    attempts.push({
      ...body,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.05,
    });
  else if (body.tool_choice === "none") {
    const withoutTools = { ...body };
    delete withoutTools.tools;
    delete withoutTools.tool_choice;
    attempts.push(withoutTools);
  }

  return attempts;
}

function toChatMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const messages: ChatMessage[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const role = value.role;
    if (
      (role === "system" || role === "user" || role === "assistant") &&
      typeof value.content === "string"
    ) {
      messages.push({ role, content: value.content });
      continue;
    }
    if (
      value.type === "function_call" &&
      typeof value.name === "string" &&
      typeof value.call_id === "string"
    ) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: value.call_id,
            type: "function",
            function: {
              name: value.name,
              arguments:
                typeof value.arguments === "string" ? value.arguments : "{}",
            },
          },
        ],
      });
      continue;
    }
    if (
      value.type === "function_call_output" &&
      typeof value.call_id === "string"
    ) {
      messages.push({
        role: "tool",
        tool_call_id: value.call_id,
        content: typeof value.output === "string" ? value.output : "{}",
      });
    }
  }

  return messages;
}

function toChatTools(input: unknown) {
  if (!Array.isArray(input)) return undefined;
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tool = item as ToolDef;
    if (
      tool.type !== "function" ||
      typeof tool.name !== "string" ||
      typeof tool.description !== "string"
    )
      return [];
    return [
      {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      },
    ];
  });
}

function normalizeGroq(data: GroqResponse): Resp {
  const message = data.choices?.[0]?.message;
  const output: Out[] = [];
  const content = message?.content?.trim();
  if (content)
    output.push({
      type: "message",
      content: [{ type: "output_text", text: content }],
    });
  for (const call of message?.tool_calls ?? []) {
    if (!call.id || !call.function?.name) continue;
    output.push({
      type: "function_call",
      name: call.function.name,
      arguments: call.function.arguments ?? "{}",
      call_id: call.id,
    });
  }
  return {
    id: data.id ?? crypto.randomUUID(),
    output,
    status: "completed",
    error: data.error,
  };
}

async function callGroq(body: Record<string, unknown>): Promise<Resp> {
  const p = provider();
  const requestBody: Record<string, unknown> = {
    model: p.model,
    messages: toChatMessages(body.input),
    temperature: body.temperature,
    max_tokens: body.max_output_tokens,
  };
  const tools = toChatTools(body.tools);
  if (tools?.length) requestBody.tools = tools;
  if (body.tool_choice !== undefined)
    requestBody.tool_choice = body.tool_choice;
  if (body.parallel_tool_calls !== undefined)
    requestBody.parallel_tool_calls = body.parallel_tool_calls;

  let lastStatus = 502;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${p.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(Math.min(env.AI_TIMEOUT_MS, 12_000)),
      });
      const raw = await response.text();
      lastStatus = response.status;
      if (!response.ok) {
        logger.warn(
          {
            provider: p.name,
            status: response.status,
            attempt,
            detail: raw.slice(0, 1000),
          },
          "AI provider rejected",
        );
        if (attempt === 1 && (response.status === 429 || response.status >= 500)) {
          await sleep(250);
          continue;
        }
        break;
      }
      const data = JSON.parse(raw) as GroqResponse;
      const normalized = normalizeGroq(data);
      if (normalized.output.length) return normalized;
      logger.warn({ provider: p.name, attempt }, "AI returned empty choices");
      break;
    } catch (error) {
      logger.warn(
        {
          provider: p.name,
          attempt,
          detail: error instanceof Error ? error.message : "request failed",
        },
        "AI provider request failed",
      );
      break;
    }
  }

  throw new AppError(
    502,
    lastStatus === 400 ? "AI_TOOL_CALL_REJECTED" : "AI_PROVIDER_ERROR",
    "خدمة الذكاء الاصطناعي غير متاحة",
  );
}

async function callResponses(body: Record<string, unknown>): Promise<Resp> {
  const p = provider();
  const response = await fetch(`${p.baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${p.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    logger.warn(
      { provider: p.name, status: response.status, detail },
      "AI provider rejected",
    );
    throw new AppError(
      502,
      "AI_PROVIDER_ERROR",
      "خدمة الذكاء الاصطناعي غير متاحة",
    );
  }
  const result = (await response.json()) as Resp;
  if (result.status !== "completed" || result.error)
    throw new AppError(502, "AI_INCOMPLETE", "لم يكتمل الرد");
  return result;
}

async function call(body: Record<string, unknown>): Promise<Resp> {
  let lastError: unknown;
  for (const candidate of retryBodies(body)) {
    try {
      return env.AI_PROVIDER === "groq"
        ? await callGroq(candidate)
        : await callResponses(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AppError(
        502,
        "AI_PROVIDER_ERROR",
        "خدمة الذكاء الاصطناعي غير متاحة",
      );
}

const tools = [createOrderTool, requestOrderDetailsTool];

function functionCall(response: Resp) {
  return response.output.find((item) => item.type === "function_call");
}

function userMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return history
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function quickReply(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const latest = userMessages(history).at(-1)?.toLowerCase() ?? "";
  const clean = latest
    .replace(/[.!؟?،,;:ـ_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(سلام|السلام عليكم|سلام عليكم|salam|salem|bonjour|bonsoir|hello|hi)$/.test(
      clean,
    )
  )
    return "وعليكم السلام 😊 مرحبا بيك، واش حاب تعرف على منتجاتنا؟";
  if (/^(شكرا|شكراً|merci|thanks|thank you)$/.test(clean))
    return "العفو، مرحبا بيك دايماً 😊";
  return undefined;
}

function orderDecisionNeeded(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const messages = userMessages(history);
  const latest = messages.at(-1) ?? "";
  const all = messages.join(" \n ");
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

function safeProviderFallback(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (orderDecisionNeeded(history))
    return "نكمّل معاك الطلبية، ابعثلي في رسالة وحدة الاسم، الهاتف، الولاية، البلدية، المنتج والكمية ونوع التوصيل.";
  return "مرحبا بيك 😊 قولّي اسم المنتج أو واش حاب تعرف، ونعاونك مباشرة.";
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
    // Fall through to a safe clarification question.
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
  const instant = quickReply(c.history);
  if (instant) return { text: instant };

  const p = provider();
  const input: Msg[] = [{ role: "system", content: c.systemPrompt }, ...c.history];
  let first: Resp;
  try {
    first = await call({
      model: p.model,
      input,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
      temperature: 0.2,
      max_output_tokens: 450,
    });
  } catch (error) {
    logger.warn(
      { err: error, eventId: c.eventId, provider: p.name },
      "Using fast merchant fallback after AI failure",
    );
    return {
      text: safeProviderFallback(c.history),
      orderError: "AI_TEMPORARY_FALLBACK",
    };
  }

  let source = first;
  let fc = functionCall(first);
  const needsOrderDecision = !fc && orderDecisionNeeded(c.history);
  if (needsOrderDecision) {
    try {
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
        temperature: 0.05,
        max_output_tokens: 300,
      });
      fc = functionCall(source);
    } catch (error) {
      logger.warn(
        { err: error, eventId: c.eventId },
        "Order decision pass failed",
      );
      return {
        text: safeProviderFallback(c.history),
        orderError: "ORDER_DECISION_AI_FAILED",
      };
    }
  }

  if (!fc) {
    const answer = text(source) || text(first);
    if (needsOrderDecision) {
      if (answer && !claimsOrderWasCreated(answer)) return { text: answer };
      return {
        text: "باش نثبت الطلبية فعلاً، زيدلي أو أكدلي المعلومة الناقصة وما نقولك تم حتى يخرج رقم الطلب من النظام.",
        orderError: "ORDER_DECISION_WITHOUT_TOOL",
      };
    }
    if (!answer)
      return {
        text: safeProviderFallback(c.history),
        orderError: "AI_EMPTY_RESPONSE",
      };
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
  let finalText = "";
  try {
    const second = await call({
      model: p.model,
      input: p.storeResponses ? [output] : [...input, ...source.output, output],
      ...(p.storeResponses ? { previous_response_id: source.id } : {}),
      tools,
      tool_choice: "none",
      ...(env.AI_PROVIDER === "xai" ? { store: p.storeResponses } : {}),
      temperature: 0.15,
      max_output_tokens: 250,
    });
    finalText = text(second);
  } catch (error) {
    logger.warn(
      { err: error, eventId: c.eventId },
      "Final order wording failed; using deterministic response",
    );
  }

  finalText ||=
    result.order
      ? `يعطيك الصحة! تسجّلت طلبيتك ${result.order.orderNumber} والمجموع ${result.order.totalAmount} دج.`
      : `ما قدرتش نثبت الطلب: ${result.error ?? "صححلي المعلومة الناقصة"}.`;
  return {
    text:
      !result.order && claimsOrderWasCreated(finalText)
        ? `ما قدرتش نثبت الطلب: ${result.error ?? "صححلي المعلومة الناقصة"}.`
        : finalText,
    order: result.order,
    orderError: result.error,
  };
}
