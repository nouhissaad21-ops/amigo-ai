import { disconnectDatabases } from "./db.js";
import { startInboundWorker } from "./worker-runtime.js";

const runtime = await startInboundWorker();
async function stop() {
  await runtime.close();
  await disconnectDatabases();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
