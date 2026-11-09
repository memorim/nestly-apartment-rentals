import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pg from 'pg';
import { createPostgresDb, postgresSql, postgresConfig } from '../postgres.js';
import { deliverNext } from '../notifications.js';
import { consumeBudget } from '../request-budget.js';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');

test('PostgreSQL keeps named values bound and rejects unverified remote TLS', () => {
  const sql = postgresSql(
    "SELECT '?' literal FROM listings WHERE district=$district LIMIT $limit",
    [{ $district: "' OR 1=1", $limit: 5 }],
  );
  assert.deepEqual(sql.values, ["' OR 1=1", 5]);
  assert.ok(
    sql.text.includes('FROM nestly.listings WHERE district=$1 LIMIT $2'),
  );
  assert.throws(() =>
    postgresConfig(
      'postgresql://owner:secret@db.example/nestly?sslmode=disable',
    ),
  );
  assert.throws(() =>
    postgresConfig(
      'postgresql://owner:secret@db.example/nestly?sslmode=verify-full&ssl=false',
    ),
  );
});

test(
  'PostgreSQL persists inquiries, occupancy, budgets and delivery leases across connections and reopening',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const url = process.env.TEST_POSTGRES_URL;
    assert.ok(
      ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname),
      'Use an isolated local PostgreSQL fixture',
    );
    const admin = new pg.Pool({ connectionString: url });
    const stores = [];
    const oldOrigin = process.env.APP_PUBLIC_ORIGIN,
      oldToken = process.env.APP_OWNER_TOKEN;
    process.env.APP_PUBLIC_ORIGIN = 'https://nestly.example';
    process.env.APP_OWNER_TOKEN = 'o'.repeat(48);
    const open = async () => {
      const store = await createPostgresDb(url, {
        seed: () => createDb(':memory:'),
      });
      stores.push(store);
      return store;
    };
    let release = () => {};
    try {
      const first = await open(),
        second = await open();
      assert.equal(first.initialized, true);
      assert.equal(second.initialized, false);
      const a = createApp(first),
        b = createApp(second);
      const call = (app, method, path) =>
        request(app)[method](path).set('Host', 'nestly.example');
      assert.equal(
        (
          await call(a, 'get', '/api/listings').query({
            rooms: 2,
            maxPrice: 150000,
            limit: 2,
          })
        ).status,
        200,
      );
      assert.deepEqual(
        (await call(a, 'get', '/api/listings').query({ district: "' OR 1=1" }))
          .body,
        [],
      );
      const body = {
        listingId: 1,
        name: 'Technical verification',
        phone: '+12025550123',
        message: 'Synthetic request; no contact required',
      };
      const submit = (app, key, data = body) =>
        call(app, 'post', '/api/inquiries')
          .set('Idempotency-Key', key)
          .send(data);
      const replies = await Promise.all([
        submit(a, 'same-request-123'),
        submit(b, 'same-request-123'),
        submit(a, 'same-request-123'),
      ]);
      assert.deepEqual(
        replies.map((row) => row.status).sort(),
        [200, 200, 201],
      );
      assert.equal(new Set(replies.map((row) => row.body.id)).size, 1);
      assert.equal(
        (await first.prepare('SELECT count(*) n FROM inquiries').get()).n,
        1,
      );
      assert.equal(
        (await first.prepare('SELECT count(*) n FROM inquiry_events').get()).n,
        1,
      );
      assert.equal(
        (await submit(b, 'same-request-123', { ...body, message: 'Changed' }))
          .status,
        409,
      );
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      let sends = 0;
      const config = {
        kind: 'ntfy',
        url: 'https://ntfy.sh/',
        topic: 'a'.repeat(48),
      };
      const active = deliverNext(first, {
        config,
        send: async (_url, options) => {
          sends++;
          assert.ok(!options.body.includes(body.name));
          started();
          await new Promise((resolve) => {
            release = resolve;
          });
          return new Response(null, { status: 200 });
        },
      });
      await ready;
      assert.equal(
        await deliverNext(second, {
          config,
          send: async () => {
            throw new Error('lease claimed twice');
          },
        }),
        false,
      );
      release();
      await active;
      assert.equal(sends, 1);
      const availability = (app, startDate, endDate) =>
        call(app, 'post', '/api/owner/listings/1/occupancy')
          .set('Authorization', 'Bearer ' + process.env.APP_OWNER_TOKEN)
          .send({ startDate, endDate });
      const reserved = await Promise.all([
        availability(a, '2026-12-01', '2026-12-10'),
        availability(b, '2026-12-05', '2026-12-12'),
      ]);
      assert.deepEqual(reserved.map((row) => row.status).sort(), [201, 409]);
      const limits = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          consumeBudget(i % 2 ? first : second, 'fixture-limit', 3, 1000),
        ),
      );
      assert.equal(limits.filter((row) => row.allowed).length, 3);
      const failed = await submit(a, 'failed-request-123', {
        ...body,
        phone: '+12025550124',
      });
      assert.equal(failed.status, 201);
      await deliverNext(first, {
        config,
        send: async () => new Response(null, { status: 503 }),
      });
      const queued = await second
        .prepare(
          'SELECT attempts,delivered_at,last_error FROM inquiry_events WHERE inquiry_id=?',
        )
        .get(failed.body.id);
      assert.equal(queued.attempts, 1);
      assert.equal(queued.delivered_at, null);
      assert.equal(queued.last_error, 'delivery_failed');
      for (let i = 0; i < 5; i++) {
        const result = await submit(
          i % 2 ? a : b,
          'contact-' + i + '-fixture',
          { ...body, phone: '+12025550125' },
        );
        assert.equal(result.status, 201);
      }
      assert.equal(
        (
          await submit(b, 'contact-last-fixture', {
            ...body,
            phone: '+12025550125',
          })
        ).status,
        429,
      );
      const before = await first
        .prepare('SELECT id,request_key FROM inquiries ORDER BY id')
        .all();
      await first.close();
      await second.close();
      const reopened = await open();
      assert.deepEqual(
        await reopened
          .prepare('SELECT id,request_key FROM inquiries ORDER BY id')
          .all(),
        before,
      );
      assert.deepEqual(
        await reopened
          .prepare(
            'SELECT attempts,delivered_at,last_error FROM inquiry_events WHERE inquiry_id=?',
          )
          .get(failed.body.id),
        queued,
      );
      assert.equal(
        (await reopened.prepare('SELECT count(*) n FROM occupancy').get()).n,
        1,
      );
      assert.equal(
        (await consumeBudget(reopened, 'fixture-limit', 3, 1000)).allowed,
        false,
      );
      assert.equal(
        (await call(createApp(reopened), 'get', '/api/owner/inquiries')).status,
        401,
      );
    } finally {
      release();
      await Promise.all(stores.map((db) => db.close()));
      await admin.query('DROP SCHEMA IF EXISTS nestly CASCADE');
      await admin.end();
      if (oldOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
      else process.env.APP_PUBLIC_ORIGIN = oldOrigin;
      if (oldToken === undefined) delete process.env.APP_OWNER_TOKEN;
      else process.env.APP_OWNER_TOKEN = oldToken;
    }
  },
);
