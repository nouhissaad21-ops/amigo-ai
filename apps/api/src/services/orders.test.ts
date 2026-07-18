import { describe, expect, it } from "vitest";
import { canTransitionOrder } from "./orders.js";

describe("order state machine", () => {
  it("allows the normal fulfilment path", () => {
    expect(canTransitionOrder("CAPTURED", "CONFIRMED")).toBe(true);
    expect(canTransitionOrder("CONFIRMED", "PACKING")).toBe(true);
    expect(canTransitionOrder("PACKING", "SHIPPED")).toBe(true);
    expect(canTransitionOrder("SHIPPED", "DELIVERED")).toBe(true);
  });

  it("allows cancellation only before shipping", () => {
    expect(canTransitionOrder("CAPTURED", "CANCELED")).toBe(true);
    expect(canTransitionOrder("PACKING", "CANCELED")).toBe(true);
    expect(canTransitionOrder("SHIPPED", "CANCELED")).toBe(false);
  });

  it("does not reopen terminal states", () => {
    expect(canTransitionOrder("CANCELED", "CAPTURED")).toBe(false);
    expect(canTransitionOrder("RETURNED", "CONFIRMED")).toBe(false);
  });

  it("treats an identical transition as idempotent", () => {
    expect(canTransitionOrder("DELIVERED", "DELIVERED")).toBe(true);
  });
});
