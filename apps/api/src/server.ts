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
const inboundWorker = env.RUN_INBOUND_WORKER
  ? await startInboundWorker()
  : undefined;
const server = http.createServer(createApp());
server.listen(env.PORT, "0.0.0.0", () =>
  logger.info({ port: env.PORT }, "AmiGo API listening"),
);
async function stop(signal: string) {
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
