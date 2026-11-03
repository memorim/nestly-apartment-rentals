import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  deliverNext,
  retryNotification,
  notificationConfig,
} from "../notifications.js";
process.env.NODE_ENV = "test";
const { createDb } = await import("../server.js");
const config = {
  url: "https://adapter.example.test/inquiry",
  secret: "s".repeat(40),
};
function insert(db) {
  db.prepare(
    "INSERT INTO inquiries(listing_id,name,phone,message,created_at) VALUES(1,?,?,?,?)",
  ).run(
    "Private name",
    "+79990001122",
    "Private message",
    "2026-11-03T00:00:00Z",
  );
}
test("outbox creation rolls back the inquiry if event persistence fails", () => {
  const db = createDb(":memory:");
  try {
    db.exec(
      "CREATE TRIGGER reject_event BEFORE INSERT ON inquiry_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    assert.throws(() => insert(db));
    assert.equal(db.prepare("SELECT count(*) n FROM inquiries").get().n, 0);
  } finally {
    db.close();
  }
});
test("delivery claims once, signs metadata, retries with same idempotency and supports manual reset", async () => {
  const db = createDb(":memory:");
  let time = 1000,
    calls = 0;
  try {
    insert(db);
    let release;
    const first = deliverNext(db, {
      config,
      now: () => time,
      send: async (url, options) => {
        calls++;
        assert.equal(url, config.url);
        assert.equal(options.redirect, "error");
        assert.equal(options.headers["Idempotency-Key"], "nestly-inquiry-1");
        assert.equal(
          options.headers["X-Nestly-Signature"],
          createHmac("sha256", config.secret)
            .update(time + "." + options.body)
            .digest("hex"),
        );
        assert.ok(!options.body.includes("Private"));
        await new Promise((r) => (release = r));
        return new Response("", { status: 503 });
      },
    });
    assert.equal(
      await deliverNext(db, {
        config,
        now: () => time,
        send: () => {
          throw new Error("must not run");
        },
      }),
      false,
    );
    release();
    await first;
    assert.equal(calls, 1);
    assert.equal(await deliverNext(db, { config, now: () => time }), false);
    const fail = async () => new Response("", { status: 503 });
    for (let attempt = 2; attempt <= 5; attempt++) {
      time += 4000000;
      await deliverNext(db, { config, now: () => time, send: fail });
    }
    time += 4000000;
    assert.equal(
      await deliverNext(db, { config, now: () => time, send: fail }),
      false,
    );
    assert.equal(retryNotification(db, 1, time), true);
    await deliverNext(db, {
      config,
      now: () => time,
      send: async () => new Response(null, { status: 204 }),
    });
    assert.ok(
      db.prepare("SELECT delivered_at FROM inquiry_events").get().delivered_at,
    );
    assert.equal(retryNotification(db, 1, time), false);
  } finally {
    db.close();
  }
});
test("expired worker leases recover and configuration fails closed", async () => {
  const db = createDb(":memory:");
  try {
    insert(db);
    db.exec(
      "UPDATE inquiry_events SET lease_until=2000,lease_token='crashed',attempts=1",
    );
    assert.equal(await deliverNext(db, { config, now: () => 1000 }), false);
    assert.equal(
      await deliverNext(db, {
        config,
        now: () => 3000,
        send: async () => new Response(null, { status: 204 }),
      }),
      true,
    );
    assert.equal(notificationConfig({}), null);
    assert.throws(() =>
      notificationConfig({
        INQUIRY_WEBHOOK_URL: "http://adapter.test",
        INQUIRY_WEBHOOK_SECRET: "s".repeat(40),
      }),
    );
    assert.throws(() =>
      notificationConfig({
        INQUIRY_WEBHOOK_URL: config.url,
        INQUIRY_WEBHOOK_SECRET: "short",
      }),
    );
  } finally {
    db.close();
  }
});
