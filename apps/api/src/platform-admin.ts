import type { PlatformRole, Prisma } from "@prisma/client";
import { env } from "./config.js";
import { systemDb } from "./db.js";

const PLATFORM_ADMIN_LOCK =
  "SELECT pg_advisory_xact_lock(62471020260718)";

async function lockBootstrap(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(PLATFORM_ADMIN_LOCK);
}

function configuredAdminEmail() {
  return env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
}

export async function initialPlatformRole(
  tx: Prisma.TransactionClient,
  email?: string,
): Promise<PlatformRole> {
  await lockBootstrap(tx);
  const targetEmail = configuredAdminEmail();

  // Never promote the first public signup to platform admin. Production
  // deployments must explicitly configure the administrator email in the
  // private environment (PLATFORM_ADMIN_EMAIL).
  if (targetEmail && email?.trim().toLowerCase() === targetEmail)
    return "SUPER_ADMIN";

  return "USER";
}

export async function ensureInitialPlatformAdmin(
  userId: string,
): Promise<PlatformRole> {
  return systemDb.$transaction(async (tx) => {
    await lockBootstrap(tx);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, email: true },
    });
    if (!user) throw new Error("User not found");
    if (user.platformRole === "SUPER_ADMIN") return user.platformRole;

    const targetEmail = configuredAdminEmail();
    if (targetEmail && user.email.toLowerCase() === targetEmail) {
      const promoted = await tx.user.update({
        where: { id: userId },
        data: { platformRole: "SUPER_ADMIN" },
        select: { platformRole: true },
      });
      return promoted.platformRole;
    }

    return user.platformRole;
  });
}
