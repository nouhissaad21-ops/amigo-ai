import { systemDb } from "./db.js";
import { enqueueInbound } from "./queues.js";

let recoveryRunning = false;

export async function recoverInboundEventsDirectly() {
  if (recoveryRunning) return { recovered: 0, skipped: true };
  recoveryRunning = true;
  try {
    const now = Date.now();
    const events = await systemDb.webhookEvent.findMany({
      where: {
        OR: [
          {
            status: "RECEIVED",
            receivedAt: { lt: new Date(now - 5_000) },
          },
          {
            status: "FAILED",
            attempts: { lt: 10 },
          },
          {
            status: "PROCESSING",
            receivedAt: { lt: new Date(now - 120_000) },
          },
        ],
      },
      orderBy: { receivedAt: "asc" },
      take: 100,
      select: { id: true, status: true },
    });

    for (const event of events) {
      if (event.status === "PROCESSING") {
        await systemDb.webhookEvent.updateMany({
          where: { id: event.id, status: "PROCESSING" },
          data: { status: "FAILED", lastError: "recovered stale event" },
        });
      }
      // enqueueInbound now also runs the event inside the web process, so this
      // recovery works even when Redis and the BullMQ worker are unavailable.
      await enqueueInbound(event.id, true);
    }

    return { recovered: events.length, skipped: false };
  } finally {
    recoveryRunning = false;
  }
}
