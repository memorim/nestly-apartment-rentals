import { setTimeout } from "node:timers/promises";
import { deliverNext, notificationConfig } from "./notifications.js";
// Import database setup without starting an HTTP listener.
process.env.NODE_ENV = "test";
const { createDb } = await import("./server.js");
const config = notificationConfig();
if (!config)
  throw new Error(
    "Configure NTFY_TOPIC or INQUIRY_WEBHOOK_URL and INQUIRY_WEBHOOK_SECRET first",
  );
const db = createDb();
let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});
try {
  while (!stopping) {
    await deliverNext(db, { config });
    if (!stopping) await setTimeout(1000);
  }
} finally {
  db.close();
}
