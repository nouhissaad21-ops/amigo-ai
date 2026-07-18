import { describe, expect, it } from "vitest";
import { normalizeClientIp } from "./ip.js";

describe("client IP normalization", () => {
  it("maps IPv4-mapped IPv6 spellings to the same bucket", () => {
    expect(normalizeClientIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeClientIp("0:0:0:0:0:ffff:7f00:1")).toBe("127.0.0.1");
    expect(normalizeClientIp("127.0.0.1")).toBe("127.0.0.1");
  });

  it("canonicalizes regular IPv6 addresses", () => {
    expect(normalizeClientIp("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
  });

  it("collapses invalid values into a shared safe bucket", () => {
    expect(normalizeClientIp("attacker-controlled-value")).toBe("unknown");
    expect(normalizeClientIp(undefined)).toBe("unknown");
  });
});
