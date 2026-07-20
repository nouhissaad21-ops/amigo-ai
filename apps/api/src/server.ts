import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config.js";
import { disconnectDatabases, systemDb } from "./db.js";
import { recoverInboundEventsDirectly } from "./inbound-runtime.js";
import { logger } from "./logger.js";
import {
  cacheRedis,
  inboundQueue,
  redis,
  whatsappOutboundQueue,
} from "./queues.js";
import { repairConnectedFacebookChannels } from "./services/facebook.js";
import { repairConnectedInstagramChannels } from "./services/instagram.js";
import { startInboundWorker } from "./worker-runtime.js";

type InboundWorker = Awaited<ReturnType<typeof startInboundWorker>>;

let inboundWorker: InboundWorker | undefined;
let isStopping = false;
let workerRetryTimer: NodeJS.Timeout | undefined;
let recoveryTimer: NodeJS.Timeout | undefined;
let channelRepairTimer: NodeJS.Timeout | undefined;

const server = http.createServer(createApp());

async function repairMessagingChannels() {
  // Never let a transient Meta API check disable inbound routing. Reactivate
  // previously connected channels immediately, then repair subscriptions.
  const reactivated = await systemDb.channel.updateMany({
    where: {
      type: { in: ["FACEBOOK", "INSTAGRAM"] },
      status: "ERROR",
    },
    data: { status: "CONNECTED" },
  });

  const [instagram, facebook] = await Promise.allSettled([
    repairConnectedInstagramChannels(),
    repairConnectedFacebookChannels(),
  ]);

  // Instagram's checker may mark a channel ERROR after a temporary API failure.
  // Restore routing again while preserving lastError for diagnostics.
  const restoredAfterChecks = await systemDb.channel.updateMany({
    where: {
      type: { in: ["FACEBOOK", "INSTAGRAM"] },
      status: "ERROR",
    },
    data: { status: "CONNECTED" },
  });

  logger.info(
    {
      instagram:
        instagram.status === "fulfilled"
          ? instagram.value
          : { error: String(instagram.reason) },
      facebook:
        facebook.status === "fulfilled"
          ? facebook.value
          : { error: String(facebook.reason) },
      reactivated: reactivated.count + restoredAfterChecks.count,
    },
    "Meta messaging channels checked",
  );
}

async function startWorkerWithRetry() {
  if (isStopping || !env.RUN_INBOUND_WORKER || inboundWorker) return;
  try {
    const worker = await startInboundWorker();
    if (isStopping) {
      await worker.close();
      return;
    }
    inboundWorker = worker;
    logger.info("inbound worker is active");
  } catch (error) {
    logger.error({ err: error }, "inbound worker failed to start; retrying");
    workerRetryTimer = setTimeout(() => {
      void startWorkerWithRetry();
    }, 15_000);
    workerRetryTimer.unref();
  }
}

server.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "AmiGo API listening");

  // Render must see an open HTTP port quickly. Recovery runs after the server
  // starts and never blocks health checks or webhook acknowledgements.
  void repairMessagingChannels().catch((error: unknown) => {
    logger.error({ err: error }, "Meta startup repair failed");
  });
  void recoverInboundEventsDirectly().catch((error: unknown) => {
    logger.error({ err: error }, "direct inbound startup recovery failed");
  });
  void startWorkerWithRetry();

  recoveryTimer = setInterval(() => {
    void recoverInboundEventsDirectly().catch((error: unknown) => {
      logger.error({ err: error }, "direct inbound recovery failed");
    });
  }, 30_000);
  recoveryTimer.unref();

  channelRepairTimer = setInterval(() => {
    void repairMessagingChannels().catch((error: unknown) => {
      logger.error({ err: error }, "periodic Meta repair failed");
    });
  }, 15 * 60_000);
  channelRepairTimer.unref();
});

async function stop(signal: string) {
  if (isStopping) return;
  isStopping = true;
  logger.info({ signal }, "stopping API");
  if (workerRetryTimer) clearTimeout(workerRetryTimer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  if (channelRepairTimer) clearInterval(channelRepairTimer);

  server.close(async () => {
    await inboundWorker?.close();
    await Promise.all([inboundQueue.close(), whatsappOutboundQueue.close()]);
    await Promise.all([redis.quit(), cacheRedis.quit()]);
    await disconnectDatabases();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 15000).unref();
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
