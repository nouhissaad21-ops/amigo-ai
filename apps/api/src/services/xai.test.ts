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

describe("AI Responses agent", () => {
  beforeEach(() => {
    createOrderFromTool.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a regular assistant response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "السعر 2000 دج" }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMerchantAgent(context)).resolves.toEqual({
      text: "السعر 2000 دج",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/responses");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "llama-3.3-70b-versatile",
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("store");
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
      .mockResolvedValueOnce(
        response({
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "create_order",
              call_id: "call-1",
              arguments: JSON.stringify(args),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: "resp-2",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "تسجلت طلبيتك AMG-001" }],
            },
          ],
        }),
      );
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
    const toolOutput = secondBody.input.find(
      (item: { type?: string }) => item.type === "function_call_output",
    );
    expect(JSON.parse(toolOutput.output)).toMatchObject({
      success: true,
      order: { orderNumber: "AMG-001" },
    });
  });

  it("does not call the database for malformed tool arguments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "create_order",
              call_id: "call-1",
              arguments: "not-json",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: "resp-2",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "صححلي المعلومات" }],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMerchantAgent(context)).resolves.toMatchObject({
      text: "صححلي المعلومات",
    });
    expect(createOrderFromTool).not.toHaveBeenCalled();
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    );
    const toolOutput = secondBody.input.find(
      (item: { type?: string }) => item.type === "function_call_output",
    );
    expect(JSON.parse(toolOutput.output)).toMatchObject({ success: false });
  });
});
