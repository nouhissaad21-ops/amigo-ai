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
integrationsRouter.get(
  "/meta/start",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    const a = req.auth!,
      nonce = randomToken(20),
      state = await signOAuthState({
        userId: a.userId,
        storeId: a.storeId,
        nonce,
      });
    await cacheRedis.set(
      `oauth:meta:${nonce}`,
      `${a.userId}:${a.storeId}`,
      "EX",
      600,
      "NX",
    );
    res.json({ url: metaOAuthUrl(state) });
  },
);
integrationsRouter.get("/meta/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined,
    t = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!code || !t)
    throw new AppError(400, "MISSING_OAUTH_PARAMS", "بيانات الربط ناقصة");
  const s = await verifyOAuthState(t),
    nonce = await cacheRedis.getdel(`oauth:meta:${s.nonce}`);
  if (nonce !== `${s.userId}:${s.storeId}`)
    throw new AppError(401, "OAUTH_REPLAYED", "الرابط منتهي");
  const membership = await systemDb.storeMembership.findUnique({
    where: { storeId_userId: { storeId: s.storeId, userId: s.userId } },
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
  const u = new URL("/dashboard/channels", env.WEB_ORIGIN);
  try {
    const r = await completeMetaOAuth(s.storeId, code);
    u.searchParams.set("meta", "connected");
    u.searchParams.set("facebook", String(r.facebook));
    u.searchParams.set("instagram", String(r.instagram));
  } catch (e) {
    u.searchParams.set("meta", "error");
    u.searchParams.set("reason", e instanceof AppError ? e.code : "UNKNOWN");
  }
  res.redirect(303, u.toString());
});
