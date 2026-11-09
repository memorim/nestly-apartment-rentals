import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledHandler } from '../scheduled-notifications.js';
process.env.NODE_ENV = 'test';
const { createDb } = await import('../server.js');
const config = { kind: 'ntfy', url: 'https://ntfy.sh/', topic: 'a'.repeat(48) };

function tick(header = 'fixture-tick', bodyId = 'fixture-tick') {
  return new Request('https://fixture.example/cron', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-neon-trigger-invocation-id': header,
    },
    body: JSON.stringify({
      version: 1,
      invocation_id: bodyId,
      trigger: {
        type: 'schedule',
        id: 'trigger-fixture',
        name: 'nestly-notifications',
      },
      data: { scheduled_at: '2026-11-09T00:00:00Z' },
    }),
  });
}
test('missing or inconsistent trigger provenance cannot open the database or send notifications', async () => {
  let opened = 0;
  const handler = createScheduledHandler({
    open: () => {
      opened++;
      throw new Error('must not open');
    },
  });
  const anonymous = await handler.fetch(
    new Request('https://fixture.example/cron', { method: 'POST' }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await handler.fetch(tick('a', 'b'))).status, 401);
  assert.equal(opened, 0);
});
for (const status of [200, 302, 503])
  test(`scheduled batch persists delivery outcome for HTTP ${status}`, async () => {
    const db = createDb(':memory:');
    try {
      db.prepare(
        "INSERT INTO inquiries(listing_id,name,phone,message,created_at) VALUES(1,'Technical fixture','+12025550123','No contact required','2026-11-09T00:00:00Z')",
      ).run();
      const handler = createScheduledHandler({
        open: async () => db,
        configuration: () => config,
        send: async (_url, options) => {
          assert.equal(options.redirect, 'error');
          assert.ok(!options.body.includes('Technical'));
          return new Response(null, { status });
        },
        now: () => 1000,
      });
      const result = await handler.fetch(tick());
      assert.equal(result.status, status === 200 ? 200 : 503);
      assert.deepEqual(await result.json(), {
        attempted: 1,
        delivered: status === 200 ? 1 : 0,
        failed: status === 200 ? 0 : 1,
      });
      const row = db.prepare('SELECT * FROM inquiry_events').get();
      assert.equal(row.attempts, 1);
      assert.equal(Boolean(row.delivered_at), status === 200);
      if (status !== 200) assert.equal(row.last_error, 'delivery_failed');
    } finally {
      db.close();
    }
  });
