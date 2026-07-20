import { systemDb } from "./db.js";
import { logger } from "./logger.js";
import { enqueueInbound } from "./queues.js";
import {
  processInboundEvent,
  sendFallbackForEvent,
} from "./services/inbound.js";

const activeDirectEvents = new Set<string>();
let recoveryRunning = false;

async function processDirectly(eventId: string) {
  if (activeDirectEvents.has(eventId)) return;
  activeDirectEvents.add(eventId);
  try {
    await processInboundEvent(eventId);
  } catch (error) {
    logger.error({ err: error, eventId }, "direct inbound processing failed");
    const event = await systemDb.webhookEvent
      .findUnique({ where: { id: eventId }, select: { attempts: true } })
      .catch(() => null);
    if ((event?.attempts ?? 0) >= 5) {
      await sendFallbackForEvent(eventId).catch((fallbackError) => {
        logger.error(
          { err: fallbackError, eventId },
          "direct inbound fallback failed",
        );
      });
    }
  } finally {
    activeDirectEvents.delete(eventId);
  }
}

/**
 * Every inbound event is sent to BullMQ and also scheduled inside the web
 * process. The database claim in processInboundEvent makes the race safe: only
 * one path can move RECEIVED/FAILED to PROCESSING. This keeps Meta messaging
 * working when Redis is waking up or the BullMQ worker failed to start.
 */
export function scheduleInboundEvent(eventId: string, force = false) {
  void enqueueInbound(eventId, force).catch((error) => {
    logger.error(
      { err: error, eventId },
      "inbound queue unavailable; direct processing remains active",
    );
  });
  setImmediate(() => {
    void processDirectly(eventId);
  });
}

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
      scheduleInboundEvent(event.id, true);
    }

    return { recovered: events.length, skipped: false };
  } finally {
    recoveryRunning = false;
  }
}
