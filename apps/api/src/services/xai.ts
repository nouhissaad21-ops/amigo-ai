import { AppError } from "../errors.js";
import { env } from "../config.js";
import { createOrderTool, requestOrderDetailsTool } from "../prompt.js";
import { orderToolSchema } from "../schemas.js";
import { createOrderFromTool, type CreatedOrder } from "./orders.js";
import { logger } from "../logger.js";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatResponse = {
  id?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string; failed_generation?: unknown };
};

type ToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type AgentContext = {
  storeId: string;
  channelId: string;
  conversationId: string;
  eventId: string;
  systemPrompt: string;
  history: HistoryMessage[];
};

type AgentResult = {
  text: string;
  order?: CreatedOrder;
  orderError?: string;
};

const localTools = [createOrderTool, requestOrderDetailsTool];

function provider() {
  if (env.AI_PROVIDER === "groq")
    return {
      name: "Groq",
      apiKey: env.GROQ_API_KEY!,
      baseUrl: env.GROQ_BASE_URL.replace(/\/$/, ""),
      model: env.GROQ_MODEL,
    };
  return {
    name: "xAI",
    apiKey: env.XAI_API_KEY!,
    baseUrl: env.XAI_BASE_URL.replace(/\/$/, ""),
    model: env.XAI_MODEL,
  };
}

function toolsForApi() {
  return localTools.map((tool: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChat(input: {
  messages: ChatMessage[];
  toolChoice: "auto" | "required" | "none";
  temperature: number;
  maxTokens: number;
}): Promise<{ text: string; toolCall?: ToolCall; assistant: ChatMessage }> {
  const p = provider();
  const requestBody: Record<string, unknown> = {
    model: p.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    tool_choice: input.toolChoice,
    parallel_tool_calls: false,
  };
  if (input.toolChoice !== "none") requestBody.tools = toolsForApi();

  let lastError = "AI request failed";
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
        signal: AbortSignal.timeout(
          Math.min(env.AI_TIMEOUT_MS, attempt === 1 ? 7_000 : 4_000),
        ),
      });
      const raw = await response.text();
      lastStatus = response.status;
      if (!response.ok) {
        lastError = raw.slice(0, 1000);
        logger.warn(
          {
            provider: p.name,
            status: response.status,
            attempt,
            detail: lastError,
          },
          "AI provider rejected merchant request",
        );
        if (attempt === 1 && (response.status === 429 || response.status >= 500)) {
          await sleep(180);
          continue;
        }
        break;
      }

      const data = JSON.parse(raw) as ChatResponse;
      const message = data.choices?.[0]?.message;
      if (!message) {
        lastError = "empty choices";
        break;
      }
      const rawCall = message.tool_calls?.[0];
      const toolCall =
        rawCall?.id && rawCall.function?.name
          ? {
              id: rawCall.id,
              type: "function" as const,
              function: {
                name: rawCall.function.name,
                arguments: rawCall.function.arguments ?? "{}",
              },
            }
          : undefined;
      const assistant: ChatMessage = {
        role: "assistant",
        content: message.content ?? null,
        ...(toolCall ? { tool_calls: [toolCall] } : {}),
      };
      const text = String(message.content ?? "").trim();
      if (!text && !toolCall) {
        lastError = "empty response";
        break;
      }
      return { text, toolCall, assistant };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
      logger.warn(
        { provider: p.name, attempt, detail: lastError },
        "AI merchant request failed",
      );
      if (attempt === 1) {
        await sleep(120);
        continue;
      }
    }
  }

  throw new AppError(
    502,
    lastStatus === 400 ? "AI_TOOL_CALL_REJECTED" : "AI_PROVIDER_ERROR",
    lastError,
  );
}

function userMessages(history: HistoryMessage[]) {
  return history
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function latestUserMessage(history: HistoryMessage[]) {
  return userMessages(history).at(-1) ?? "";
}

function normalizedShortText(value: string) {
  return value
    .toLowerCase()
    .replace(/[.!؟?،,;:ـ_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quickReply(history: HistoryMessage[]) {
  const clean = normalizedShortText(latestUserMessage(history));
  if (!clean || clean.split(" ").length > 4) return undefined;

  if (/^(السلام عليكم|سلام عليكم|سلام|salam|salem)$/.test(clean))
    return "وعليكم السلام 😊 مرحبا بيك! قولّي برك واش حاب تعرف ونعاونك.";
  if (/^(bonjour|bonsoir|salut|coucou)$/.test(clean))
    return "Bonjour 😊 Bienvenue ! Dites-moi ce que vous cherchez et je vous aide.";
  if (/^(hello|hi|hey|good morning|good evening)$/.test(clean))
    return "Hi 😊 Welcome! Tell me what you're looking for and I'll help.";
  if (/^(hola|buenos días|buenas tardes)$/.test(clean))
    return "¡Hola! 😊 Dime qué estás buscando y te ayudo.";
  if (/^(hallo|guten tag|guten morgen)$/.test(clean))
    return "Hallo 😊 Sag mir einfach, wonach du suchst, und ich helfe dir.";
  if (/^(ciao|buongiorno|buonasera)$/.test(clean))
    return "Ciao 😊 Dimmi cosa stai cercando e ti aiuto.";
  if (/^(merhaba|selam|günaydın)$/.test(clean))
    return "Merhaba 😊 Ne aradığınızı söyleyin, hemen yardımcı olayım.";

  if (/^(شكرا|شكراً|بارك الله فيك)$/.test(clean))
    return "العفو، مرحبا بيك في أي وقت 😊";
  if (/^(merci|merci beaucoup)$/.test(clean))
    return "Avec plaisir 😊";
  if (/^(thanks|thank you|thx)$/.test(clean)) return "You're welcome 😊";
  if (/^(gracias|muchas gracias)$/.test(clean)) return "¡Con gusto! 😊";
  if (/^(danke|vielen dank)$/.test(clean)) return "Gern geschehen 😊";
  if (/^(grazie|grazie mille)$/.test(clean)) return "Con piacere 😊";
  if (/^(teşekkürler|teşekkür ederim)$/.test(clean)) return "Rica ederim 😊";
  return undefined;
}

function detectLanguage(value: string) {
  const lower = value.toLowerCase();
  if (/[\u0600-\u06ff]/.test(value)) return "ar";
  if (/\b(bonjour|bonsoir|salut|prix|combien|livraison|commande|produit|merci)\b/.test(lower))
    return "fr";
  if (/\b(hola|precio|envío|pedido|producto|gracias)\b/.test(lower)) return "es";
  if (/\b(hallo|preis|lieferung|bestellung|produkt|danke)\b/.test(lower)) return "de";
  if (/\b(ciao|prezzo|spedizione|ordine|prodotto|grazie)\b/.test(lower)) return "it";
  if (/\b(merhaba|fiyat|teslimat|sipariş|ürün|teşekkür)\b/.test(lower)) return "tr";
  return "en";
}

function orderIntent(value: string) {
  return /(طلبية|نطلب|نحب ندي|نحب نشري|دير(?:لي)? الطلب|سجل(?:لي)? الطلب|ثبت(?:لي)? الطلب|commande|commander|acheter|je le prends|je confirme|order it|place (?:the )?order|i(?:'|’)ll take it|buy it|pedido|comprar|bestellung|bestellen|ordine|ordinare|sipariş)/i.test(
    value,
  );
}

function confirmation(value: string) {
  return /^(نعم|ايه|إيه|اه|oui|ok|okay|موافق|أكد|نأكد|صح|ديرها|ثبتها|سجلها|تمام|yes|confirm|confirmed|vale|sí|si|ja|bestätigen|confermo|evet|onayla)(?:\s|[.!،])*$/i.test(
    value.trim(),
  );
}

function orderDecisionNeeded(history: HistoryMessage[]) {
  const latest = latestUserMessage(history);
  if (!latest) return false;
  if (orderIntent(latest)) return true;

  const recent = history.slice(-8);
  const assistantContext = recent
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join(" ");
  const userContext = recent
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ");
  const assistantWasCollectingOrder =
    /(الاسم|الهاتف|الولاية|البلدية|التوصيل|أكد|confirmation|nom|téléphone|wilaya|commune|livraison|name|phone|address|delivery|confirm|pedido|bestellung|ordine|sipariş)/i.test(
      assistantContext,
    );
  const latestHasOrderData =
    /(?:^|\D)0[567]\d{8}(?:\D|$)/.test(latest.replace(/[\s-]/g, "")) ||
    /(home|desk|domicile|bureau|المنزل|المكتب|البلدية|ولاية|wilaya|commune)/i.test(
      latest,
    );
  return (
    (confirmation(latest) && (assistantWasCollectingOrder || orderIntent(userContext))) ||
    (latestHasOrderData && assistantWasCollectingOrder)
  );
}

function fallbackReply(history: HistoryMessage[]) {
  const latest = latestUserMessage(history);
  const wantsOrder = orderDecisionNeeded(history);
  switch (detectLanguage(latest)) {
    case "ar":
      return wantsOrder
        ? "نكمل معاك الطلبية. ابعثلي المعلومة الناقصة فقط ونثبتها مباشرة."
        : "قولّي واش حاب تعرف بالضبط، ونمدّلك المعلومة مباشرة.";
    case "fr":
      return wantsOrder
        ? "On continue la commande. Envoyez-moi seulement l’information manquante et je la confirme."
        : "Dites-moi précisément ce que vous cherchez et je vous réponds directement.";
    case "es":
      return wantsOrder
        ? "Seguimos con el pedido. Envíame solo el dato que falta y lo confirmo."
        : "Dime exactamente qué buscas y te respondo directamente.";
    case "de":
      return wantsOrder
        ? "Wir setzen die Bestellung fort. Schick mir nur die fehlende Angabe."
        : "Sag mir bitte genau, was du suchst, dann helfe ich direkt.";
    case "it":
      return wantsOrder
        ? "Continuiamo con l’ordine. Inviami solo il dato mancante."
        : "Dimmi esattamente cosa cerchi e ti rispondo subito.";
    case "tr":
      return wantsOrder
        ? "Siparişe devam edelim. Sadece eksik bilgiyi gönderin."
        : "Tam olarak ne aradığınızı söyleyin, doğrudan yardımcı olayım.";
    default:
      return wantsOrder
        ? "Let's continue the order. Send only the missing detail and I'll confirm it."
        : "Tell me exactly what you're looking for and I'll help directly.";
  }
}

function claimsOrderWasCreated(value: string) {
  return /(تسج[ّ]?لت.*طلبي|تم.*(?:تسجيل|تأكيد).*طلبي|رقم الطلب(?:ية)?|order\s*(?:number|#)|order.*(?:placed|confirmed)|commande.*(?:enregistr|confirm)|pedido.*confirm|bestellung.*bestät|ordine.*conferm|sipariş.*onay)/i.test(
    value,
  );
}

function missingDetailsQuestion(call: ToolCall) {
  if (call.function.name !== "request_order_details") return undefined;
  try {
    const parsed = JSON.parse(call.function.arguments) as {
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
    // Use a language-aware fallback below.
  }
  return undefined;
}

async function executeTool(call: ToolCall, context: AgentContext) {
  if (call.function.name === "request_order_details")
    return {
      question: missingDetailsQuestion(call),
      payload: { success: false, needsMoreInformation: true },
    };

  try {
    if (call.function.name !== "create_order") throw new Error("Unknown tool");
    const parsed = orderToolSchema.parse(JSON.parse(call.function.arguments));
    const order = await createOrderFromTool({
      storeId: context.storeId,
      channelId: context.channelId,
      conversationId: context.conversationId,
      idempotencyKey: context.eventId,
      input: parsed,
    });
    return { order, payload: { success: true, order } };
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : "Invalid order information";
    logger.warn(
      {
        eventId: context.eventId,
        storeId: context.storeId,
        channelId: context.channelId,
        toolName: call.function.name,
        error: message,
      },
      "Order tool failed",
    );
    return { error: message, payload: { success: false, error: message } };
  }
}

function deterministicOrderReply(
  history: HistoryMessage[],
  result: { order?: CreatedOrder; error?: string },
) {
  const language = detectLanguage(latestUserMessage(history));
  if (result.order) {
    const number = result.order.orderNumber;
    const total = result.order.totalAmount;
    if (language === "fr")
      return `C’est confirmé ✅ Commande ${number}, total ${total} DZD.`;
    if (language === "es")
      return `Pedido confirmado ✅ Número ${number}, total ${total} DZD.`;
    if (language === "de")
      return `Bestellung bestätigt ✅ Nummer ${number}, Gesamtbetrag ${total} DZD.`;
    if (language === "it")
      return `Ordine confermato ✅ Numero ${number}, totale ${total} DZD.`;
    if (language === "tr")
      return `Sipariş onaylandı ✅ Numara ${number}, toplam ${total} DZD.`;
    if (language === "en")
      return `Order confirmed ✅ Number ${number}, total ${total} DZD.`;
    return `تم تأكيد الطلبية ✅ رقمها ${number} والمجموع ${total} دج.`;
  }
  if (language === "fr") return "Je n’ai pas pu confirmer la commande. Corrigez-moi l’information manquante.";
  if (language === "es") return "No pude confirmar el pedido. Corrige el dato que falta.";
  if (language === "de") return "Ich konnte die Bestellung nicht bestätigen. Bitte korrigiere die fehlende Angabe.";
  if (language === "it") return "Non sono riuscito a confermare l’ordine. Correggi il dato mancante.";
  if (language === "tr") return "Siparişi onaylayamadım. Lütfen eksik bilgiyi düzeltin.";
  if (language === "en") return "I couldn't confirm the order. Please correct the missing detail.";
  return "ما قدرتش نثبت الطلبية. صححلي المعلومة الناقصة فقط.";
}

export async function runMerchantAgent(context: AgentContext): Promise<AgentResult> {
  const instant = quickReply(context.history);
  if (instant) return { text: instant };

  const messages: ChatMessage[] = [
    { role: "system", content: context.systemPrompt },
    ...context.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  let first: Awaited<ReturnType<typeof callChat>>;
  try {
    first = await callChat({
      messages,
      toolChoice: "auto",
      temperature: 0.38,
      maxTokens: 420,
    });
  } catch (error) {
    logger.warn(
      { err: error, eventId: context.eventId },
      "Using language-aware merchant fallback",
    );
    return {
      text: fallbackReply(context.history),
      orderError: "AI_TEMPORARY_FALLBACK",
    };
  }

  let response = first;
  if (!response.toolCall && orderDecisionNeeded(context.history)) {
    try {
      response = await callChat({
        messages: [
          ...messages,
          {
            role: "system",
            content:
              "Order decision only: use create_order if every required field and explicit confirmation are present. Otherwise use request_order_details and ask exactly one natural question in the customer's current language. Do not answer with plain text and do not guess.",
          },
        ],
        toolChoice: "required",
        temperature: 0.05,
        maxTokens: 260,
      });
    } catch (error) {
      logger.warn(
        { err: error, eventId: context.eventId },
        "Order decision pass failed",
      );
      return {
        text: fallbackReply(context.history),
        orderError: "ORDER_DECISION_AI_FAILED",
      };
    }
  }

  if (!response.toolCall) {
    const answer = response.text.trim();
    if (!answer)
      return {
        text: fallbackReply(context.history),
        orderError: "AI_EMPTY_RESPONSE",
      };
    if (claimsOrderWasCreated(answer)) {
      logger.warn(
        {
          eventId: context.eventId,
          storeId: context.storeId,
          channelId: context.channelId,
        },
        "Blocked order confirmation without a successful tool call",
      );
      return {
        text: deterministicOrderReply(context.history, {}),
        orderError: "ORDER_CONFIRMATION_WITHOUT_TOOL",
      };
    }
    return { text: answer };
  }

  const toolResult = await executeTool(response.toolCall, context);
  if (toolResult.question)
    return {
      text: toolResult.question,
      orderError: "ORDER_DETAILS_MISSING",
    };

  const toolMessage: ChatMessage = {
    role: "tool",
    name: response.toolCall.function.name,
    tool_call_id: response.toolCall.id,
    content: JSON.stringify(toolResult.payload),
  };
  let finalText = "";
  try {
    const final = await callChat({
      messages: [...messages, response.assistant, toolMessage],
      toolChoice: "none",
      temperature: 0.25,
      maxTokens: 220,
    });
    finalText = final.text;
  } catch (error) {
    logger.warn(
      { err: error, eventId: context.eventId },
      "Final order wording failed; using deterministic wording",
    );
  }

  finalText ||= deterministicOrderReply(context.history, toolResult);
  if (!toolResult.order && claimsOrderWasCreated(finalText))
    finalText = deterministicOrderReply(context.history, toolResult);

  return {
    text: finalText,
    order: toolResult.order,
    orderError: toolResult.error,
  };
}