import type { PlatformRole, Prisma } from "@prisma/client";
import { systemDb } from "./db.js";

const PLATFORM_ADMIN_LOCK =
  "SELECT pg_advisory_xact_lock(62471020260718)";

async function lockBootstrap(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(PLATFORM_ADMIN_LOCK);
}

export async function initialPlatformRole(
  tx: Prisma.TransactionClient,
): Promise<PlatformRole> {
  await lockBootstrap(tx);
  const existing = await tx.user.findFirst({
    where: { platformRole: "SUPER_ADMIN" },
    select: { id: true },
  });
  return existing ? "USER" : "SUPER_ADMIN";
}

export async function ensureInitialPlatformAdmin(
  userId: string,
): Promise<PlatformRole> {
  return systemDb.$transaction(async (tx) => {
    await lockBootstrap(tx);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { platformRole: true },
    });
    if (!user) throw new Error("User not found");
    if (user.platformRole === "SUPER_ADMIN") return user.platformRole;

    const existing = await tx.user.findFirst({
      where: { platformRole: "SUPER_ADMIN" },
      select: { id: true },
    });
    if (existing) return user.platformRole;

    const promoted = await tx.user.update({
      where: { id: userId },
      data: { platformRole: "SUPER_ADMIN" },
      select: { platformRole: true },
    });
    return promoted.platformRole;
  });
}
