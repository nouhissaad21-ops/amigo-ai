import { Router } from "express";
import argon2 from "argon2";
import {
  authenticate,
  clearAuthCookies,
  setAuthCookies,
  signAccessToken,
} from "../auth.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import {
  ensureInitialPlatformAdmin,
  initialPlatformRole,
} from "../platform-admin.js";
import { loginSchema, registerSchema } from "../schemas.js";
import { redisRateLimit } from "../rate-limit.js";
import { randomToken, sha256 } from "../security.js";
export const authRouter = Router();
const limiter = redisRateLimit({
  prefix: "auth",
  windowMs: 900000,
  limit: 20,
  failClosed: true,
});
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
const slug = (v: string) =>
  `${
    v
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "store"
  }-${crypto.randomUUID().slice(0, 6)}`;
async function session(userId: string, storeId: string, req: any) {
  const t = randomToken();
  await systemDb.refreshSession.create({
    data: {
      userId,
      storeId,
      tokenHash: sha256(t),
      expiresAt: new Date(Date.now() + 2592000000),
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    },
  });
  return t;
}
authRouter.post("/register", limiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await argon2.hash(input.password, passwordOptions);
  const result = await systemDb.$transaction(async (tx) => {
    const platformRole = await initialPlatformRole(tx);
    const user = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        platformRole,
      },
    });
    const store = await tx.store.create({
      data: { name: input.storeName, slug: slug(input.storeName) },
    });
    const membership = await tx.storeMembership.create({
      data: { storeId: store.id, userId: user.id, role: "OWNER" },
    });
    await tx.subscription.create({
      data: {
        storeId: store.id,
        currentPeriodEnd: new Date(Date.now() + 1209600000),
      },
    });
    await tx.merchantRules.create({
      data: { storeId: store.id, generalRules: "" },
    });
    return { user, store, membership };
  });

  const [access, refresh] = await Promise.all([
    signAccessToken({
      userId: result.user.id,
      storeId: result.store.id,
      role: result.membership.role,
    }),
    session(result.user.id, result.store.id, req),
  ]);
  setAuthCookies(res, access, refresh);
  res.status(201).json({
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      platformRole: result.user.platformRole,
    },
    store: result.store,
  });
});
authRouter.post("/login", limiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await systemDb.user.findUnique({
    where: { email: input.email },
    include: {
      memberships: {
        include: { store: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const passwordValid = user
    ? await argon2.verify(user.passwordHash, input.password)
    : await argon2.hash(input.password, passwordOptions).then(() => false);
  if (!user || user.status !== "ACTIVE" || !passwordValid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "البريد أو كلمة السر غير صحيحة",
    );

  const membership = user.memberships.find(
    (item) => item.store.isActive && !item.store.deletedAt,
  );
  if (!membership)
    throw new AppError(403, "NO_ACTIVE_STORE", "ما كاش متجر مفعّل");

  const platformRole = await ensureInitialPlatformAdmin(user.id);
  const [access, refresh] = await Promise.all([
    signAccessToken({
      userId: user.id,
      storeId: membership.storeId,
      role: membership.role,
    }),
    session(user.id, membership.storeId, req),
  ]);
  setAuthCookies(res, access, refresh);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      platformRole,
    },
    store: membership.store,
  });
});
authRouter.post("/refresh", limiter, async (req, res) => {
  const t = req.cookies?.amigo_refresh as string | undefined;
  if (!t) throw new AppError(401, "NO_REFRESH_TOKEN", "الجلسة منتهية");
  const old = await systemDb.refreshSession.findUnique({
    where: { tokenHash: sha256(t) },
    include: { user: true },
  });
  if (
    !old ||
    old.revokedAt ||
    old.expiresAt <= new Date() ||
    old.user.status !== "ACTIVE"
  ) {
    clearAuthCookies(res);
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "الجلسة منتهية");
  }
  const m = await systemDb.storeMembership.findUnique({
    where: { storeId_userId: { storeId: old.storeId, userId: old.userId } },
  });
  if (!m) throw new AppError(403, "MEMBERSHIP_REVOKED", "الصلاحية ملغاة");
  const next = randomToken();
  await systemDb.$transaction([
    systemDb.refreshSession.update({
      where: { id: old.id },
      data: { revokedAt: new Date() },
    }),
    systemDb.refreshSession.create({
      data: {
        userId: old.userId,
        storeId: old.storeId,
        tokenHash: sha256(next),
        expiresAt: new Date(Date.now() + 2592000000),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      },
    }),
  ]);
  setAuthCookies(
    res,
    await signAccessToken({
      userId: old.userId,
      storeId: old.storeId,
      role: m.role,
    }),
    next,
  );
  res.json({ ok: true });
});
authRouter.post("/logout", async (req, res) => {
  const t = req.cookies?.amigo_refresh as string | undefined;
  if (t)
    await systemDb.refreshSession.updateMany({
      where: { tokenHash: sha256(t), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  clearAuthCookies(res);
  res.status(204).end();
});
authRouter.get("/me", authenticate, async (req, res) => {
  const a = req.auth!,
    [user, store, subscription] = await Promise.all([
      systemDb.user.findUniqueOrThrow({
        where: { id: a.userId },
        select: { id: true, email: true, fullName: true, platformRole: true },
      }),
      systemDb.store.findUniqueOrThrow({ where: { id: a.storeId } }),
      systemDb.subscription.findUnique({ where: { storeId: a.storeId } }),
    ]);
  res.json({ user, store, subscription, role: a.role });
});
