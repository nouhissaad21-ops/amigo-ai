import { Router } from "express";
import {
  authenticate,
  requireRole,
  signOAuthState,
  verifyOAuthState,
} from "../auth.js";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { cacheRedis } from "../queues.js";
import { randomToken } from "../security.js";
import { completeMetaOAuth, metaOAuthUrl } from "../services/meta.js";

export const integrationsRouter = Router();

integrationsRouter.get("/meta/status", authenticate, (_req, res) => {
  res.json({
    configured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
    instagramEnabled: env.META_ENABLE_INSTAGRAM,
  });
});

integrationsRouter.get(
  "/meta/start",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    const auth = req.auth!;
    const nonce = randomToken(20);
    const state = await signOAuthState({
      userId: auth.userId,
      storeId: auth.storeId,
      nonce,
    });
    await cacheRedis.set(
      `oauth:meta:${nonce}`,
      `${auth.userId}:${auth.storeId}`,
      "EX",
      600,
      "NX",
    );
    res.json({ url: metaOAuthUrl(state) });
  },
);

integrationsRouter.get("/meta/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const stateToken =
    typeof req.query.state === "string" ? req.query.state : undefined;
  const providerError =
    typeof req.query.error === "string" ? req.query.error : undefined;

  if (!stateToken)
    throw new AppError(400, "MISSING_OAUTH_STATE", "بيانات الربط ناقصة");

  const state = await verifyOAuthState(stateToken);
  const nonce = await cacheRedis.getdel(`oauth:meta:${state.nonce}`);
  if (nonce !== `${state.userId}:${state.storeId}`)
    throw new AppError(401, "OAUTH_REPLAYED", "الرابط منتهي");

  const membership = await systemDb.storeMembership.findUnique({
    where: {
      storeId_userId: { storeId: state.storeId, userId: state.userId },
    },
    include: { store: { select: { isActive: true, deletedAt: true } } },
  });
  if (
    !membership ||
    !["OWNER", "ADMIN"].includes(membership.role) ||
    !membership.store.isActive ||
    membership.store.deletedAt
  ) {
    throw new AppError(403, "OAUTH_FORBIDDEN", "صلاحية ربط القناة ملغاة");
  }

  const redirect = new URL("/dashboard/channels", env.WEB_ORIGIN);
  if (providerError || !code) {
    redirect.searchParams.set("meta", "error");
    redirect.searchParams.set("reason", "META_OAUTH_DENIED");
    res.redirect(303, redirect.toString());
    return;
  }

  try {
    const result = await completeMetaOAuth(state.storeId, code);
    redirect.searchParams.set("meta", "connected");
    redirect.searchParams.set("facebook", String(result.facebook));
    redirect.searchParams.set("instagram", String(result.instagram));
  } catch (error) {
    redirect.searchParams.set("meta", "error");
    redirect.searchParams.set(
      "reason",
      error instanceof AppError ? error.code : "UNKNOWN",
    );
  }
  res.redirect(303, redirect.toString());
});
