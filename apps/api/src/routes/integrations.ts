import { Router, type Request, type Response } from "express";
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
import {
  completeInstagramOAuth,
  instagramOAuthUrl,
} from "../services/instagram.js";
import { completeMetaOAuth, metaOAuthUrl } from "../services/meta.js";

export const integrationsRouter = Router();

function queryText(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function providerError(query: Record<string, unknown>) {
  return [
    queryText(query.error),
    queryText(query.error_code),
    queryText(query.error_reason),
    queryText(query.error_description),
  ].find(Boolean);
}

function oauthRedirect(
  res: Response,
  provider: "meta" | "instagram",
  status: "connected" | "error",
  params: Record<string, string> = {},
) {
  const redirect = new URL("/dashboard/channels", env.WEB_ORIGIN);
  redirect.searchParams.set(provider, status);
  for (const [key, value] of Object.entries(params))
    redirect.searchParams.set(key, value);
  res.redirect(303, redirect.toString());
}

async function authorizeState(stateToken: string, namespace: string) {
  const state = await verifyOAuthState(stateToken);
  const nonce = await cacheRedis.getdel(`oauth:${namespace}:${state.nonce}`);
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
  )
    throw new AppError(403, "OAUTH_FORBIDDEN", "صلاحية ربط القناة ملغاة");
  return state;
}

async function newState(req: Request, namespace: string) {
  const auth = req.auth!;
  const nonce = randomToken(20);
  const state = await signOAuthState({
    userId: auth.userId,
    storeId: auth.storeId,
    nonce,
  });
  await cacheRedis.set(
    `oauth:${namespace}:${nonce}`,
    `${auth.userId}:${auth.storeId}`,
    "EX",
    600,
    "NX",
  );
  return state;
}

integrationsRouter.get("/meta/status", authenticate, (_req, res) => {
  const configured = Boolean(env.META_APP_ID && env.META_APP_SECRET);
  res.json({
    configured,
    instagramEnabled: env.META_ENABLE_INSTAGRAM && configured,
  });
});

integrationsRouter.get(
  "/meta/start",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    const state = await newState(req, "meta");
    res.json({ url: metaOAuthUrl(state) });
  },
);

integrationsRouter.get("/meta/callback", async (req, res) => {
  const code = queryText(req.query.code);
  const stateToken = queryText(req.query.state);
  const error = providerError(req.query as Record<string, unknown>);

  if (!stateToken) {
    oauthRedirect(res, "meta", "error", {
      reason: error ? "META_OAUTH_DENIED" : "MISSING_OAUTH_STATE",
    });
    return;
  }

  const state = await authorizeState(stateToken, "meta");
  if (error || !code) {
    oauthRedirect(res, "meta", "error", { reason: "META_OAUTH_DENIED" });
    return;
  }

  try {
    const result = await completeMetaOAuth(state.storeId, code);
    oauthRedirect(res, "meta", "connected", {
      facebook: String(result.facebook),
      instagram: "0",
    });
  } catch (reason) {
    oauthRedirect(res, "meta", "error", {
      reason: reason instanceof AppError ? reason.code : "UNKNOWN",
    });
  }
});

integrationsRouter.get(
  "/instagram/start",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    if (!env.META_ENABLE_INSTAGRAM)
      throw new AppError(
        503,
        "INSTAGRAM_NOT_CONFIGURED",
        "Instagram غير مفعّل في إعدادات المنصة",
      );
    const state = await newState(req, "instagram");
    res.json({ url: instagramOAuthUrl(state) });
  },
);

integrationsRouter.get("/instagram/callback", async (req, res) => {
  const code = queryText(req.query.code);
  const stateToken = queryText(req.query.state);
  const error = providerError(req.query as Record<string, unknown>);

  if (!stateToken) {
    oauthRedirect(res, "instagram", "error", {
      reason: error ? "INSTAGRAM_OAUTH_DENIED" : "MISSING_OAUTH_STATE",
    });
    return;
  }

  const state = await authorizeState(stateToken, "instagram");
  if (error || !code) {
    oauthRedirect(res, "instagram", "error", {
      reason: "INSTAGRAM_OAUTH_DENIED",
    });
    return;
  }

  try {
    const result = await completeInstagramOAuth(state.storeId, code);
    oauthRedirect(res, "instagram", "connected", {
      count: String(result.instagram),
    });
  } catch (reason) {
    oauthRedirect(res, "instagram", "error", {
      reason: reason instanceof AppError ? reason.code : "UNKNOWN",
    });
  }
});
