import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { csrfGuard } from "./auth.js";
import { env } from "./config.js";
import { systemDb } from "./db.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { logger } from "./logger.js";
import { cacheRedis } from "./queues.js";
import { redisRateLimit } from "./rate-limit.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { channelDiagnosticsRouter } from "./routes/channel-diagnostics.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { integrationsRouter } from "./routes/integrations.js";
import { metaWebhookRouter, whatsappWebhookRouter } from "./routes/webhooks.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: IncomingMessage) =>
        req.headers["x-request-id"]?.toString() ?? crypto.randomUUID(),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'none'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", "data:", "blob:"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(compression());
  app.get("/health/live", (_q, r) => r.json({ status: "ok" }));
  app.get("/health/ready", async (_q, r) => {
    try {
      await Promise.all([systemDb.$queryRaw`SELECT 1`, cacheRedis.ping()]);
      r.json({ status: "ready" });
    } catch {
      r.status(503).json({ status: "not-ready" });
    }
  });
  const raw = express.raw({ type: "application/json", limit: "2mb" });
  app.use("/api/webhooks/meta", raw, metaWebhookRouter);
  // Accept a dedicated Instagram callback too, so a merchant cannot break the
  // integration by selecting the Instagram-specific URL in Meta's dashboard.
  app.use("/api/webhooks/instagram", raw, metaWebhookRouter);
  app.use("/api/webhooks/whatsapp", raw, whatsappWebhookRouter);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(cookieParser());
  app.use(csrfGuard);
  app.use(redisRateLimit({ prefix: "api", windowMs: 60000, limit: 300 }));
  for (const prefix of ["/api", "/backend/api"]) {
    app.use(`${prefix}/auth`, authRouter);
    app.use(`${prefix}/admin`, adminRouter);
    app.use(`${prefix}/integrations`, integrationsRouter);
    app.use(`${prefix}/dashboard`, dashboardRouter);
    app.use(`${prefix}/channel-diagnostics`, channelDiagnosticsRouter);
  }
  if (env.SERVE_STATIC_WEB) {
    const staticDirectory = path.resolve(env.STATIC_WEB_DIR);
    app.use(
      express.static(staticDirectory, {
        index: "index.html",
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`))
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable",
            );
        },
      }),
    );
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
