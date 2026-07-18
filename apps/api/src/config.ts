import "dotenv/config";
import { z } from "zod";

// Render exposes its public URL only at runtime. Derive all same-origin URLs
// before validation so a Blueprint deployment does not need hard-coded hosts.
if (process.env.RENDER_EXTERNAL_URL) {
  const publicUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  process.env.WEB_ORIGIN ??= publicUrl;
  process.env.API_PUBLIC_URL ??= publicUrl;
  process.env.META_OAUTH_REDIRECT_URI ??= `${publicUrl}/api/integrations/meta/callback`;
}

// Neon gives us an owner URL. A separate limited SQL role is used by all
// tenant-scoped queries; bootstrap-db.ts creates/rotates this role.
if (
  !process.env.DATABASE_TENANT_URL &&
  process.env.DATABASE_URL &&
  process.env.AMIGO_TENANT_PASSWORD
) {
  try {
    const tenantUrl = new URL(process.env.DATABASE_URL);
    tenantUrl.username = "amigo_app";
    tenantUrl.password = process.env.AMIGO_TENANT_PASSWORD;
    process.env.DATABASE_TENANT_URL = tenantUrl.toString();
  } catch {
    // The schema below emits the useful validation error.
  }
}

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    API_PUBLIC_URL: z.url().default("http://localhost:4000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().min(1),
    DATABASE_TENANT_URL: z.string().min(1),
    AMIGO_TENANT_PASSWORD: z.string().min(32).optional(),
    REDIS_URL: z.string().min(1),
    CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    OAUTH_STATE_SECRET: z.string().min(32),
    COOKIE_SECURE: bool,
    RUN_INBOUND_WORKER: bool,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(12),
    SERVE_STATIC_WEB: bool,
    STATIC_WEB_DIR: z.string().default("apps/web/out"),
    ENABLE_BAILEYS: bool.default(true),
    AI_PROVIDER: z.enum(["groq", "xai"]).default("groq"),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(45000),
    GROQ_API_KEY: z.string().min(1).optional(),
    GROQ_BASE_URL: z.url().default("https://api.groq.com/openai/v1"),
    GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
    XAI_API_KEY: z.string().min(1).optional(),
    XAI_BASE_URL: z.url().default("https://api.x.ai/v1"),
    XAI_MODEL: z.string().default("grok-4.5"),
    XAI_STORE_RESPONSES: bool,
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),
    META_VERIFY_TOKEN: z.string().min(16),
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v25.0"),
    META_OAUTH_REDIRECT_URI: z
      .url()
      .default("http://localhost:4000/api/integrations/meta/callback"),
  })
  .superRefine((value, ctx) => {
    const key =
      value.AI_PROVIDER === "groq" ? value.GROQ_API_KEY : value.XAI_API_KEY;
    if (!key)
      ctx.addIssue({
        code: "custom",
        path: [value.AI_PROVIDER === "groq" ? "GROQ_API_KEY" : "XAI_API_KEY"],
        message: `is required when AI_PROVIDER=${value.AI_PROVIDER}`,
      });
    if (value.DATABASE_URL === value.DATABASE_TENANT_URL)
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_TENANT_URL"],
        message: "must use the limited amigo_app role, not the system role",
      });
    if (Boolean(value.META_APP_ID) !== Boolean(value.META_APP_SECRET))
      ctx.addIssue({
        code: "custom",
        path: [value.META_APP_ID ? "META_APP_SECRET" : "META_APP_ID"],
        message: "META_APP_ID and META_APP_SECRET must be configured together",
      });
  });
const parsed = schema.safeParse(process.env);
if (!parsed.success)
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
  );
export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
