import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./config.js";
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  connectTimeout: 3000,
  commandTimeout: 5000,
});
export const cacheRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  connectTimeout: 3000,
  commandTimeout: 3000,
  lazyConnect: true,
});
export const inboundQueue = new Queue<{ eventId: string }, void, "process">(
  "inbound-messages",
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 604800, count: 10000 },
    },
  },
);
export const whatsappOutboundQueue = new Queue<
  { messageId: string; channelId: string; jid: string; text: string },
  void,
  "send"
>("whatsapp-outbound", {
  connection: redis,
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});
export async function enqueueInbound(eventId: string, force = false) {
  if (force) {
    const old = await inboundQueue.getJob(eventId);
    if (old) {
      const state = await old.getState();
      if (state === "failed" || state === "completed") await old.remove();
    }
  }
  await inboundQueue.add("process", { eventId }, { jobId: eventId });
}
