import { env } from "../config.js";
import { logger } from "../logger.js";
import { pollConnectedInstagramChannels } from "./instagram-poller.js";

if (env.NODE_ENV === "production") {
  const run = () =>
    void pollConnectedInstagramChannels().catch((error: unknown) => {
      logger.error({ err: error }, "Instagram inbox poll failed");
    });

  run();
  const timer = setInterval(run, 10_000);
  timer.unref();
}
