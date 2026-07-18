import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config.js";
import { disconnectDatabases } from "./db.js";
import { logger } from "./logger.js";
import {
  cacheRedis,
  inboundQueue,
  redis,
  whatsappOutboundQueue,
} from "./queues.js";
import { startInboundWorker } from "./worker-runtime.js";

type InboundWorker = Awaited<ReturnType<typeof startInboundWorker>>;

let inboundWorker: InboundWorker | undefined;
let isStopping = false;

const server = http.createServer(createApp());

server.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "AmiGo API listening");

  // Render must see an open HTTP port quickly. Database/Redis recovery can be
  // slow after a free-tier cold start, so initialize the worker in the
  // background after the web server is already accepting health checks.
  if (env.RUN_INBOUND_WORKER) {
    void startInboundWorker()
      .then(async (worker) => {
        if (isStopping) {
          await worker.close();
          return;
        }
        inboundWorker = worker;
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "inbound worker failed to start");
      });
  }
});

async function stop(signal: string) {
  if (isStopping) return;
  isStopping = true;
  logger.info({ signal }, "stopping API");

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
