import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./config.js";
import { disconnectDatabases, systemDb } from "./db.js";
import { logger } from "./logger.js";
import { BaileysManager } from "./services/baileys.js";
const manager = new BaileysManager(),
  connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }),
  subscriber = connection.duplicate(),
  worker = new Worker<
    { messageId: string; channelId: string; jid: string; text: string },
    void,
    "send"
  >(
    "whatsapp-outbound",
    async (j) => {
      const externalMessageId = await manager.send(
        j.data.channelId,
        j.data.jid,
        j.data.text,
      );
      await systemDb.message.update({
        where: { id: j.data.messageId },
        data: {
          status: "SENT",
          externalMessageId,
          processedAt: new Date(),
          error: null,
        },
      });
    },
    { connection, concurrency: 20, lockDuration: 60000 },
  );
worker.on("failed", (j, e) => {
  if (j && j.attemptsMade >= (j.opts.attempts ?? 1))
    void systemDb.message.update({
      where: { id: j.data.messageId },
      data: { status: "FAILED", error: e.message.slice(0, 1000) },
    });
});
await subscriber.subscribe("whatsapp-control");
subscriber.on("message", (_c: string, v: string) => {
  try {
    const x = JSON.parse(v);
    if (x.action === "start") void manager.start(x.channelId);
    if (x.action === "stop") void manager.disconnect(x.channelId);
  } catch {}
});
await manager.bootstrap();
const timer = setInterval(() => void manager.bootstrap(), 30000);
async function stop() {
  clearInterval(timer);
  await Promise.all([worker.close(), subscriber.quit()]);
  await manager.stopAll();
  await connection.quit();
  await disconnectDatabases();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
logger.info("WhatsApp gateway started");
