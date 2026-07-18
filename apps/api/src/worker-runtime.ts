import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./config.js";
import { systemDb } from "./db.js";
import { logger } from "./logger.js";
import { enqueueInbound } from "./queues.js";
import {
  processInboundEvent,
  sendFallbackForEvent,
} from "./services/inbound.js";

async function recoverStaleEvents() {
  const stale = await systemDb.webhookEvent.findMany({
    where: {
      OR: [
        {
          status: "RECEIVED",
          receivedAt: { lt: new Date(Date.now() - 60_000) },
        },
        {
          status: "PROCESSING",
          receivedAt: { lt: new Date(Date.now() - 900_000) },
        },
      ],
    },
    take: 1000,
  });

  for (const event of stale) {
    if (event.status === "PROCESSING")
      await systemDb.webhookEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", lastError: "recovered stale event" },
      });
    await enqueueInbound(event.id, true);
  }
}

function logRecoveryError(error: unknown) {
  logger.error({ err: error }, "stale event recovery failed");
}

export async function startInboundWorker() {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 3000,
  });
  connection.on("error", (error) =>
    logger.error({ err: error }, "inbound worker Redis error"),
  );

  const worker = new Worker<{ eventId: string }, void, "process">(
    "inbound-messages",
    (job) => processInboundEvent(job.data.eventId),
    {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 120_000,
    },
  );

  worker.on("error", (error) => {
    logger.error({ err: error }, "inbound worker error");
  });
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "inbound failed");
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void sendFallbackForEvent(job.data.eventId).catch((fallbackError) => {
        logger.error(
          { err: fallbackError, jobId: job.id },
          "fallback message failed",
        );
      });
  });

  try {
    await recoverStaleEvents();
  } catch (error) {
    logRecoveryError(error);
  }

  const timer = setInterval(() => {
    void recoverStaleEvents().catch(logRecoveryError);
  }, 300_000);

  logger.info(
    { concurrency: env.WORKER_CONCURRENCY },
    "inbound worker started",
  );

  return {
    async close() {
      clearInterval(timer);
      await worker.close();
      await connection.quit();
    },
  };
}
