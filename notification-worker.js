import { setTimeout } from 'node:timers/promises';
import {
  deliverNext,
  notificationConfig,
  runNotificationBatch,
} from './notifications.js';
// Import database setup without starting an HTTP listener.
process.env.NODE_ENV = 'test';
const { openDatabase } = await import('./server.js');
const config = notificationConfig();
if (!config)
  throw new Error(
    'Configure NTFY_TOPIC or INQUIRY_WEBHOOK_URL and INQUIRY_WEBHOOK_SECRET first',
  );
const db = await openDatabase();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
});
process.once('SIGINT', () => {
  stopping = true;
});
try {
  if (process.argv.includes('--once')) {
    const summary = await runNotificationBatch(db, { config });
    console.log(JSON.stringify({ event: 'notification_batch', ...summary }));
    if (summary.failed) process.exitCode = 1;
    stopping = true;
  }
  while (!stopping) {
    await deliverNext(db, { config });
    if (!stopping) await setTimeout(1000);
  }
} finally {
  await db.close();
}
