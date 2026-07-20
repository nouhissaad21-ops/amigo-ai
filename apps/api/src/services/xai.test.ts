import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createOrderFromTool } = vi.hoisted(() => ({
  createOrderFromTool: vi.fn(),
}));
vi.mock("./orders.js", () => ({ createOrderFromTool }));

import { runMerchantAgent } from "./xai.js";

const context = {
  storeId: "00000000-0000-4000-8000-000000000010",
  channelId: "00000000-0000-4000-8000-000000000011",
  conversationId: "00000000-0000-4000-8000-000000000012",
  eventId: "00000000-0000-4000-8000-000000000013",
  systemPrompt: "system",
  history: [{ role: "user" as const, content: "شحال؟" }],
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function chatText(content: string, id = "chat-1") {
  return response({ id, choices: [{ message: { content } }] });
}

function chatTool(name: string, args: string, id = "call-1") {
  return response({
    id: "chat-1",
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id,
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  });
}

describe("multilingual Chat Completions merchant agent", () => {
  beforeEach(() => {
    createOrderFromTool.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a regular assistant response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatText("السعر 2000 دج"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMerchantAgent(context)).resolves.toEqual({
      text: "السعر 2000 دج",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "llama-3.3-70b-versatile",
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "شحال؟" },
    ]);
    expect(body.tools[0]).toHaveProperty("function.name", "create_order");
  });

  it("executes create_order and feeds its trusted result back to the model", async () => {
    createOrderFromTool.mockResolvedValue({
      id: "order-1",
      orderNumber: "AMG-001",
      totalAmount: "3000.00",
      subtotal: "2500.00",
      deliveryPrice: "500.00",
      currency: "DZD",
      status: "CAPTURED",
    });
    const args = {
      fullName: "أمين بن علي",
      phone: "0550123456",
      wilayaCode: 16,
      municipality: "باب الزوار",
      deliveryType: "HOME",
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000001",
          variantId: null,
          quantity: 1,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatTool("create_order", JSON.stringify(args)))
      .mockResolvedValueOnce(chatText("تسجلت طلبيتك AMG-001", "chat-2"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runMerchantAgent(context);
    expect(result.order?.orderNumber).toBe("AMG-001");
    expect(createOrderFromTool).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: context.eventId, input: args }),
    );
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    );
    expect(secondBody.tool_choice).toBe("none");
    const assistantCall = secondBody.messages.find(
      (item: { role?: string; tool_calls?: unknown[] }) =>
        item.role === "assistant" && Array.isArray(item.tool_calls),
    );
    expect(assistantCall.tool_calls[0]).toMatchObject({
      id: "call-1",
      function: { name: "create_order" },
    });
    const toolOutput = secondBody.messages.find(
      (item: { role?: string }) => item.role === "tool",
    );
    expect(JSON.parse(toolOutput.content)).toMatchObject({
      success: true,
      order: { orderNumber: "AMG-001" },
    });
  });

  it("does not call the database for malformed tool arguments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatTool("create_order", "not-json"))
      .mockResolvedValueOnce(chatText("صححلي المعلومات", "chat-2"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMerchantAgent(context)).resolves.toMatchObject({
      text: "صححلي المعلومات",
    });
    expect(createOrderFromTool).not.toHaveBeenCalled();
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    );
    const toolOutput = secondBody.messages.find(
      (item: { role?: string }) => item.role === "tool",
    );
    expect(JSON.parse(toolOutput.content)).toMatchObject({ success: false });
  });

  it("answers greetings instantly in the customer's language", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runMerchantAgent({
        ...context,
        history: [{ role: "user", content: "سلام" }],
      }),
    ).resolves.toEqual({
      text: "وعليكم السلام 😊 مرحبا بيك! قولّي برك واش حاب تعرف ونعاونك.",
    });
    await expect(
      runMerchantAgent({
        ...context,
        history: [{ role: "user", content: "Bonjour" }],
      }),
    ).resolves.toEqual({
      text: "Bonjour 😊 Bienvenue ! Dites-moi ce que vous cherchez et je vous aide.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
}