import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptJson,
  encryptJson,
  sha256,
  verifyHmacSignature,
} from "./security.js";

describe("credential encryption", () => {
  it("round-trips structured credentials", () => {
    const value = { accessToken: "secret-token", nested: { id: 12 } };
    expect(decryptJson(encryptJson(value))).toEqual(value);
  });

  it("uses a fresh nonce for every envelope", () => {
    expect(encryptJson({ token: "same" })).not.toBe(
      encryptJson({ token: "same" }),
    );
  });

  it("rejects an authenticated envelope after tampering", () => {
    const envelope = encryptJson({ token: "secret" });
    const tail = envelope.at(-1) === "A" ? "B" : "A";
    expect(() => decryptJson(`${envelope.slice(0, -1)}${tail}`)).toThrow();
  });
});

describe("signatures and hashes", () => {
  it("accepts only the exact Meta HMAC", () => {
    const body = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyHmacSignature(body, signature, "app-secret")).toBe(true);
    expect(
      verifyHmacSignature(Buffer.from("changed"), signature, "app-secret"),
    ).toBe(false);
    expect(verifyHmacSignature(body, "sha256=00", "app-secret")).toBe(false);
  });

  it("produces deterministic SHA-256 token hashes", () => {
    expect(sha256("refresh-token")).toHaveLength(64);
    expect(sha256("refresh-token")).toBe(sha256("refresh-token"));
  });
});
