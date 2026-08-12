import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePlatformAdmin } from "../auth.js";
import { env } from "../config.js";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { cacheRedis } from "../queues.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requirePlatformAdmin);

adminRouter.get("/overview", async (_req, res) => {
  const [
    users,
    stores,
    activeStores,
    suspendedUsers,
    orders,
    revenue,
    recentStores,
    recentUsers,
  ] = await Promise.all([
    systemDb.user.count(),
    systemDb.store.count({ where: { deletedAt: null } }),
    systemDb.store.count({ where: { isActive: true, deletedAt: null } }),
    systemDb.user.count({ where: { status: "SUSPENDED" } }),
    systemDb.order.count(),
    systemDb.order.aggregate({
      where: { status: { notIn: ["CANCELED", "RETURNED"] } },
      _sum: { totalAmount: true },
    }),
    systemDb.store.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        subscription: true,
        memberships: {
          where: { role: "OWNER" },
          take: 1,
          include: {
            user: {
              select: { id: true, email: true, fullName: true, status: true },
            },
          },
        },
        _count: {
          select: { memberships: true, products: true, channels: true, orders: true },
        },
      },
    }),
    systemDb.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        platformRole: true,
        createdAt: true,
        memberships: {
          take: 3,
          select: {
            role: true,
            store: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    }),
  ]);

  res.json({
    stats: {
      users,
      stores,
      activeStores,
      suspendedUsers,
      orders,
      revenue: revenue._sum.totalAmount?.toFixed(2) ?? "0.00",
    },
    stores: recentStores,
    users: recentUsers,
  });
});

adminRouter.get("/health", async (_req, res) => {
  const started = Date.now();
  const checks: Record<string, { status: "UP" | "DOWN" | "WARN"; detail: string; latencyMs?: number }> = {};

  const dbStarted = Date.now();
  try {
    await systemDb.$queryRaw`SELECT 1`;
    checks.database = { status: "UP", detail: "PostgreSQL is reachable", latencyMs: Date.now() - dbStarted };
  } catch (error) {
    checks.database = { status: "DOWN", detail: error instanceof Error ? error.message.slice(0, 180) : "Database unavailable", latencyMs: Date.now() - dbStarted };
  }

  const redisStarted = Date.now();
  try {
    await cacheRedis.ping();
    checks.redis = { status: "UP", detail: "Queue/cache backend is reachable", latencyMs: Date.now() - redisStarted };
  } catch (error) {
    checks.redis = { status: "DOWN", detail: error instanceof Error ? error.message.slice(0, 180) : "Redis unavailable", latencyMs: Date.now() - redisStarted };
  }

  checks.ai = {
    status: env.AI_PROVIDER === "groq" ? (env.GROQ_API_KEY ? "UP" : "DOWN") : env.XAI_API_KEY ? "UP" : "DOWN",
    detail: `${env.AI_PROVIDER} · ${env.AI_PROVIDER === "groq" ? env.GROQ_MODEL : env.XAI_MODEL}`,
  };
  checks.meta = {
    status: env.META_APP_ID && env.META_APP_SECRET ? "UP" : "WARN",
    detail: env.META_APP_ID && env.META_APP_SECRET ? "Meta OAuth configured" : "Meta credentials are not configured",
  };
  checks.instagram = {
    status: env.META_ENABLE_INSTAGRAM ? "UP" : "WARN",
    detail: env.META_ENABLE_INSTAGRAM ? "Instagram integration enabled" : "Instagram integration disabled",
  };

  const down = Object.values(checks).filter((check) => check.status === "DOWN").length;
  const warnings = Object.values(checks).filter((check) => check.status === "WARN").length;
  res.status(down ? 503 : 200).json({
    status: down ? "DEGRADED" : warnings ? "WARNING" : "HEALTHY",
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    version: "1.0.0",
    admin: {
      configured: Boolean(env.PLATFORM_ADMIN_EMAIL),
      email: env.PLATFORM_ADMIN_EMAIL ?? null,
    },
    checks,
  });
});

adminRouter.patch("/stores/:id/status", async (req, res) => {
  const storeId = z.uuid().parse(req.params.id);
  const input = z.object({ isActive: z.boolean() }).parse(req.body);
  if (storeId === req.auth!.storeId && !input.isActive)
    throw new AppError(422, "CANNOT_DISABLE_OWN_STORE", "ما تقدرش توقف متجرك الرئيسي من نفس الجلسة");

  const existing = await systemDb.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!existing) throw new AppError(404, "STORE_NOT_FOUND", "المتجر غير موجود");

  const store = await systemDb.$transaction(async (tx) => {
    const updated = await tx.store.update({
      where: { id: storeId },
      data: { isActive: input.isActive },
      select: { id: true, name: true, isActive: true },
    });
    await tx.auditLog.create({
      data: {
        storeId,
        userId: req.auth!.userId,
        action: input.isActive ? "PLATFORM_STORE_ENABLED" : "PLATFORM_STORE_DISABLED",
        entityType: "Store",
        entityId: storeId,
        metadata: { isActive: input.isActive },
        ipAddress: req.ip,
      },
    });
    return updated;
  });

  res.json({ store });
});

adminRouter.patch("/users/:id/status", async (req, res) => {
  const userId = z.uuid().parse(req.params.id);
  const input = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(req.body);
  if (userId === req.auth!.userId && input.status === "SUSPENDED")
    throw new AppError(422, "CANNOT_SUSPEND_SELF", "ما تقدرش توقف حسابك الرئيسي");

  const existing = await systemDb.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { storeId: true },
      },
    },
  });
  if (!existing) throw new AppError(404, "USER_NOT_FOUND", "المستخدم غير موجود");

  const user = await systemDb.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { status: input.status },
      select: { id: true, email: true, fullName: true, status: true, platformRole: true },
    });
    const storeId = existing.memberships[0]?.storeId;
    if (storeId)
      await tx.auditLog.create({
        data: {
          storeId,
          userId: req.auth!.userId,
          action: input.status === "ACTIVE" ? "PLATFORM_USER_ENABLED" : "PLATFORM_USER_SUSPENDED",
          entityType: "User",
          entityId: userId,
          metadata: { status: input.status },
          ipAddress: req.ip,
        },
      });
    return updated;
  });

  res.json({ user });
});
