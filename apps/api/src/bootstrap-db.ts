import { env } from "./config.js";
import { systemDb, tenantDb } from "./db.js";
import { logger } from "./logger.js";

async function bootstrapTenantRole() {
  if (!env.AMIGO_TENANT_PASSWORD) {
    logger.info(
      "AMIGO_TENANT_PASSWORD is not set; tenant role bootstrap skipped",
    );
    return;
  }

  await systemDb.$transaction(async (tx) => {
    // Keep the password out of generated SQL and logs. The transaction-local
    // setting is read by the DO block on the same database connection.
    await tx.$queryRaw`SELECT set_config('app.bootstrap_password', ${env.AMIGO_TENANT_PASSWORD}, true)`;
    await tx.$executeRawUnsafe(`
      DO $amigo_bootstrap$
      DECLARE
        role_password text := current_setting('app.bootstrap_password', true);
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amigo_app') THEN
          EXECUTE format(
            'ALTER ROLE amigo_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',
            role_password
          );
        ELSE
          EXECUTE format(
            'CREATE ROLE amigo_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',
            role_password
          );
        END IF;
      END
      $amigo_bootstrap$;
    `);
  });

  logger.info("limited tenant database role is ready");
}

try {
  await bootstrapTenantRole();
} catch (error) {
  logger.error({ err: error }, "tenant role bootstrap failed");

  // A managed provider can reject ALTER ROLE even when the already-created
  // least-privilege login is still valid. Continue only after proving that the
  // existing tenant credentials work; otherwise preserve the startup failure.
  try {
    await tenantDb.$queryRaw`SELECT 1`;
    logger.warn(
      "existing limited tenant role verified; continuing without rotation",
    );
  } catch {
    throw error;
  }
} finally {
  await Promise.all([systemDb.$disconnect(), tenantDb.$disconnect()]);
}
