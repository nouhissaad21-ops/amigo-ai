import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./config.js";
function key() {
  const k = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "base64");
  if (k.length !== 32)
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  return k;
}
export function encryptJson(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv),
    data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decryptJson<T>(envelope: string): T {
  const [v, iv, tag, data] = envelope.split(".");
  if (v !== "v1" || !iv || !tag || !data)
    throw new Error("Invalid credential envelope");
  const d = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(data, "base64url")),
      d.final(),
    ]).toString("utf8"),
  ) as T;
}
export const sha256 = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) =>
  randomBytes(bytes).toString("base64url");
export function verifyHmacSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature?.startsWith("sha256=")) return false;
  const got = Buffer.from(signature.slice(7), "hex"),
    expected = createHmac("sha256", secret).update(body).digest();
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const metaAppSecretProof = (token: string) =>
  createHmac(
    "sha256",
    env.META_APP_SECRET ??
      (() => {
        throw new Error("META_APP_SECRET is not configured");
      })(),
  )
    .update(token)
    .digest("hex");
