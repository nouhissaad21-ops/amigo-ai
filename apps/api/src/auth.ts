import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { StoreRole } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { env, isProduction } from "./config.js";
import { systemDb } from "./db.js";
import { AppError } from "./errors.js";
const jwtKey = new TextEncoder().encode(env.JWT_SECRET),
  oauthKey = new TextEncoder().encode(env.OAUTH_STATE_SECRET);
export async function signAccessToken(c: {
  userId: string;
  storeId: string;
  role: StoreRole;
}) {
  return new SignJWT({ storeId: c.storeId, role: c.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(c.userId)
    .setIssuer("amigo-ai")
    .setAudience("amigo-dashboard")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtKey);
}
export async function signOAuthState(c: {
  userId: string;
  storeId: string;
  nonce: string;
}) {
  return new SignJWT({ storeId: c.storeId, nonce: c.nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.userId)
    .setIssuer("amigo-ai")
    .setAudience("meta-oauth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(oauthKey);
}
export async function verifyOAuthState(token: string) {
  const { payload } = await jwtVerify(token, oauthKey, {
    issuer: "amigo-ai",
    audience: "meta-oauth",
  });
  if (
    !payload.sub ||
    typeof payload.storeId !== "string" ||
    typeof payload.nonce !== "string"
  )
    throw new AppError(401, "INVALID_OAUTH_STATE", "انتهت أو فسدت جلسة الربط");
  return {
    userId: payload.sub,
    storeId: payload.storeId,
    nonce: payload.nonce,
  };
}
function token(req: Request) {
  const b = req.headers.authorization;
  return b?.startsWith("Bearer ")
    ? b.slice(7)
    : (req.cookies?.amigo_access as string | undefined);
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const t = token(req);
    if (!t) throw new AppError(401, "UNAUTHENTICATED", "سجّل الدخول أولاً");
    const { payload } = await jwtVerify(t, jwtKey, {
      issuer: "amigo-ai",
      audience: "amigo-dashboard",
    });
    if (!payload.sub || typeof payload.storeId !== "string") throw new Error();
    const m = await systemDb.storeMembership.findUnique({
      where: {
        storeId_userId: { storeId: payload.storeId, userId: payload.sub },
      },
      include: {
        store: { include: { subscription: true } },
        user: { select: { status: true } },
      },
    });
    if (
      !m ||
      !m.store.isActive ||
      m.store.deletedAt ||
      m.user.status !== "ACTIVE"
    )
      throw new AppError(403, "ACCOUNT_DISABLED", "الحساب أو المتجر غير مفعّل");
    const s = m.store.subscription;
    if (
      !s ||
      !(s.status === "ACTIVE" || s.status === "TRIALING") ||
      s.currentPeriodEnd <= new Date()
    )
      throw new AppError(
        402,
        "SUBSCRIPTION_REQUIRED",
        "الاشتراك منتهي؛ جدده لمواصلة استعمال المنصة",
      );
    req.auth = { userId: payload.sub, storeId: payload.storeId, role: m.role };
    next();
  } catch (e) {
    next(
      e instanceof AppError
        ? e
        : new AppError(401, "INVALID_TOKEN", "انتهت جلسة الدخول"),
    );
  }
};
const rank: Record<StoreRole, number> = {
  VIEWER: 0,
  AGENT: 1,
  ADMIN: 2,
  OWNER: 3,
};
export const requireRole =
  (min: StoreRole): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || rank[req.auth.role] < rank[min])
      return next(
        new AppError(403, "FORBIDDEN", "ما عندكش الصلاحية لهذه العملية"),
      );
    next();
  };
const cookie = {
  httpOnly: true,
  secure: isProduction || env.COOKIE_SECURE,
  sameSite: "strict" as const,
  path: "/",
};
export function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie("amigo_access", access, { ...cookie, maxAge: 900000 });
  res.cookie("amigo_refresh", refresh, { ...cookie, maxAge: 2592000000 });
}
export function clearAuthCookies(res: Response) {
  res.clearCookie("amigo_access", cookie);
  res.clearCookie("amigo_refresh", cookie);
}
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path.startsWith("/api/webhooks/") ||
    req.headers.authorization?.startsWith("Bearer ")
  )
    return next();
  if (req.headers.origin !== env.WEB_ORIGIN)
    return next(new AppError(403, "CSRF_REJECTED", "مصدر الطلب غير موثوق"));
  next();
}
