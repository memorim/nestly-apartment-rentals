import { createHmac, randomUUID } from 'node:crypto';

export function initializeNotifications(db) {
  const columns = db
    .prepare('PRAGMA table_info(inquiry_events)')
    .all()
    .map((row) => row.name);
  for (const [name, type] of [
    ['lease_until', 'INTEGER NOT NULL DEFAULT 0'],
    ['lease_token', 'TEXT'],
  ]) {
    if (!columns.includes(name))
      db.exec(`ALTER TABLE inquiry_events ADD COLUMN ${name} ${type}`);
  }
  // The event and inquiry must commit together, even when a process crashes.
  db.exec(`CREATE TRIGGER IF NOT EXISTS inquiries_enqueue AFTER INSERT ON inquiries
    BEGIN INSERT INTO inquiry_events(inquiry_id,created_at) VALUES(NEW.id,NEW.created_at); END;`);
}

export function notificationConfig(env = process.env) {
  if (env.NTFY_TOPIC) {
    if (env.INQUIRY_WEBHOOK_URL)
      throw new Error('Choose ntfy or the inquiry webhook');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(env.NTFY_TOPIC))
      throw new Error('Use a random ntfy topic of 32–128 safe characters');
    return { kind: 'ntfy', url: 'https://ntfy.sh/', topic: env.NTFY_TOPIC };
  }
  if (!env.INQUIRY_WEBHOOK_URL) return null;
  const url = new URL(env.INQUIRY_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error(
      'INQUIRY_WEBHOOK_URL must be an HTTPS URL without credentials',
    );
  if (!env.INQUIRY_WEBHOOK_SECRET || env.INQUIRY_WEBHOOK_SECRET.length < 32)
    throw new Error(
      'INQUIRY_WEBHOOK_SECRET must contain at least 32 random characters',
    );
  return { url: url.href, secret: env.INQUIRY_WEBHOOK_SECRET };
}

export function retryNotification(db, id, now = Date.now()) {
  const result = db
    .prepare(
      `UPDATE inquiry_events SET attempts=0,next_attempt_at=0,last_error=NULL,
    lease_until=0,lease_token=NULL WHERE id=? AND delivered_at IS NULL
    AND attempts>=5 AND lease_until<=?`,
    )
    .run(id, now);
  return db.dialect === 'postgres'
    ? result.then((row) => row.changes > 0)
    : result.changes > 0;
}

export async function deliverNext(
  db,
  { config, now = Date.now, send = fetch, onDelivery = () => {} } = {},
) {
  if (!config) return false;
  const time = now(),
    lease = randomUUID();
  // One atomic UPDATE claims a row across workers. A crash expires after 30 seconds.
  const event = await db
    .prepare(
      `UPDATE inquiry_events SET attempts=attempts+1,
    lease_until=?,lease_token=? WHERE id=(SELECT id FROM inquiry_events
    WHERE delivered_at IS NULL AND attempts<5 AND next_attempt_at<=? AND lease_until<=?
    ORDER BY id LIMIT 1${db.dialect === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : ''}) RETURNING *`,
    )
    .get(time + 30000, lease, time, time);
  if (!event) return false;
  const payload = JSON.stringify({
    event: 'inquiry.created',
    eventId: event.id,
    inquiryId: event.inquiry_id,
    createdAt: event.created_at,
  });
  const timestamp = String(time);
  const ntfy = config.kind === 'ntfy';
  const body = ntfy
    ? JSON.stringify({
        topic: config.topic,
        title: 'Nestly',
        message: 'New inquiry #' + event.inquiry_id,
      })
    : payload;
  const signedHeaders = ntfy
    ? {}
    : {
        'X-Nestly-Timestamp': timestamp,
        'X-Nestly-Signature': createHmac('sha256', config.secret)
          .update(timestamp + '.' + payload)
          .digest('hex'),
      };
  let status;
  try {
    const response = await send(config.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'nestly-inquiry-' + event.id,
        ...signedHeaders,
      },
      body,
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('delivery_failed');
    const saved = await db
      .prepare(
        `UPDATE inquiry_events SET delivered_at=?,lease_until=0,lease_token=NULL,last_error=NULL
      WHERE id=? AND lease_token=?`,
      )
      .run(new Date(now()).toISOString(), event.id, lease);
    status = saved.changes === 1 ? 'delivered' : 'lease_lost';
  } catch {
    // Never persist URLs, secrets, contact details or response bodies in error logs.
    const delay = Math.min(3600000, 30000 * 2 ** (event.attempts - 1));
    await db
      .prepare(
        `UPDATE inquiry_events SET next_attempt_at=?,lease_until=0,lease_token=NULL,
      last_error='delivery_failed' WHERE id=? AND lease_token=?`,
      )
      .run(now() + delay, event.id, lease);
    status = 'retry';
  }
  onDelivery({ id: event.id, status });
  return true;
}

export async function runNotificationBatch(db, options = {}) {
  if (!options.config)
    throw new Error('Configure an external delivery destination');
  const result = { attempted: 0, delivered: 0, failed: 0 };
  for (let i = 0; i < 10; i++) {
    const changed = await deliverNext(db, {
      ...options,
      onDelivery: ({ status }) => {
        result.attempted++;
        if (status === 'delivered') result.delivered++;
        else result.failed++;
      },
    });
    if (!changed) break;
  }
  return result;
}
