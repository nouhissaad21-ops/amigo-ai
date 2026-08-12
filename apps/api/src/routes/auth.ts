import crypto from "node:crypto";
import { Router } from "express";
import argon2 from "argon2";
import {
  authenticate,
  clearAuthCookies,
  setAuthCookies,
  signAccessToken,
} from "../auth.js";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import {
  ensureInitialPlatformAdmin,
  initialPlatformRole,
} from "../platform-admin.js";
import { loginSchema, registerSchema } from "../schemas.js";
import { redisRateLimit } from "../rate-limit.js";
import { randomToken, sha256 } from "../security.js";
import { logger } from "../logger.js";

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

function prismaCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function mapRegistrationFailure(error: unknown): never {
  if (error instanceof AppError) throw error;

  const code = prismaCode(error);

  if (code === "P2002")
    throw new AppError(
      409,
      "EMAIL_ALREADY_REGISTERED",
      "هذا البريد الإلكتروني مسجل من قبل. استعمل تسجيل الدخول.",
    );

  if (["P1000", "P1001", "P1002", "P2021", "P2022"].includes(code))
    throw new AppError(
      503,
      "REGISTRATION_UNAVAILABLE",
      "قاعدة البيانات غير جاهزة حالياً. أعد المحاولة بعد لحظات.",
    );

  if (["P2024", "P2034"].includes(code))
    throw new AppError(
      503,
      "REGISTRATION_BUSY",
      "الخادم مشغول حالياً بتهيئة البيانات. أعد المحاولة بعد لحظات.",
    );

  logger.error({ err: error }, "Registration transaction failed");
  throw new AppError(
    500,
    "REGISTRATION_FAILED",
    "تعذر إنشاء الحساب حالياً. حاول مرة أخرى.",
  );
}

authRouter.post("/register", limiter, async (req, res) => {
  const input = registerSchema.parse(req.body);

  // Keep database failures from leaking as a generic 500. This check is
  // intentionally outside the transaction because it gives the customer a
  // deterministic "use login" response before doing expensive Argon2 work.
  try {
    const existing = await systemDb.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing)
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "هذا البريد الإلكتروني مسجل من قبل. استعمل تسجيل الدخول.",
      );
  } catch (error) {
    mapRegistrationFailure(error);
  }

  let passwordHash: string;
  try {
    passwordHash = await argon2.hash(input.password, passwordOptions);
  } catch (error) {
    logger.error({ err: error }, "Password hashing failed during registration");
    throw new AppError(
      503,
      "REGISTRATION_BUSY",
      "الخادم مشغول حالياً. أعد المحاولة بعد لحظات.",
    );
  }

  let result;
  try {
    result = await systemDb.$transaction(
      async (tx) => {
        const platformRole = await initialPlatformRole(tx, input.email);
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
      },
      { maxWait: 30000, timeout: 60000 },
    );
  } catch (error) {
    mapRegistrationFailure(error);
  }

  try {
    const access = await signAccessToken({
      userId: result.user.id,
      storeId: result.store.id,
      role: result.membership.role,
    });

    // Refresh-session creation is retried once because managed/free Postgres
    // instances can briefly wake from an idle state. The account itself is
    // already committed atomically at this point.
    let refresh: string | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2 && !refresh; attempt += 1) {
      try {
        refresh = await session(result.user.id, result.store.id, req);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    if (!refresh) {
      logger.error(
        { err: lastError, userId: result.user.id, storeId: result.store.id },
        "Registration refresh session creation failed",
      );
      throw new AppError(
        503,
        "SESSION_INITIALIZATION_FAILED",
        "تم إنشاء الحساب بنجاح، لكن تعذر فتح الجلسة تلقائياً. ادخل من صفحة تسجيل الدخول.",
      );
    }

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
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error(
      { err: error, userId: result.user.id, storeId: result.store.id },
      "Registration session creation failed",
    );
    throw new AppError(
      503,
      "SESSION_INITIALIZATION_FAILED",
      "تم إنشاء الحساب بنجاح، لكن تعذر فتح الجلسة تلقائياً. ادخل من صفحة تسجيل الدخول.",
    );
  }
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
    include: { store: { select: { isActive: true, deletedAt: true } } },
  });
  if (!m || !m.store.isActive || m.store.deletedAt) {
    await systemDb.refreshSession.updateMany({
      where: { userId: old.userId, storeId: old.storeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res);
    throw new AppError(403, "MEMBERSHIP_REVOKED", "الصلاحية ملغاة");
  }
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
  res.json({ user, store, subscription, role: a.role, isPlatformAdmin: user.platformRole === "SUPER_ADMIN", apiVersion: "v1" });
});
