import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "./config.js";
export const systemDb = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
export const tenantDb = new PrismaClient({
  datasourceUrl: env.DATABASE_TENANT_URL,
  log: ["error"],
});
export type TenantTransaction = Prisma.TransactionClient;
export async function withTenant<T>(
  storeId: string,
  operation: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      storeId,
    )
  )
    throw new Error("Invalid tenant identifier");
  return tenantDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_store_id', ${storeId}, true)`;
    return operation(tx);
  });
}
export async function disconnectDatabases() {
  await Promise.all([systemDb.$disconnect(), tenantDb.$disconnect()]);
}
