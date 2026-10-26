import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
process.env.NODE_ENV = "test";
const { createDb, createApp } = await import("../server.js");
const payload = {
  listingId: 1,
  name: "Viewer",
  phone: "+79990000000",
  message: "Evening",
};
test("catalog rejects invalid numeric filters", async () => {
  const db = createDb(":memory:");
  try {
    for (const query of [
      "rooms=NaN",
      "rooms=-1",
      "maxPrice=Infinity",
      "maxPrice=-1",
      "maxPrice=1.5",
      "district[]=x",
      "limit=0",
    ])
      assert.equal(
        (await request(createApp(db)).get("/api/listings?" + query)).status,
        400,
        query,
      );
  } finally {
    db.close();
  }
});
test("inquiry validates contacts and safely replays one operation", async () => {
  const db = createDb(":memory:"),
    app = createApp(db);
  try {
    for (const invalid of [
      { name: "  " },
      { phone: "invalid-number" },
      { name: "x".repeat(81) },
    ])
      assert.equal(
        (
          await request(app)
            .post("/api/inquiries")
            .send({ ...payload, ...invalid })
        ).status,
        400,
      );
    const send = (data) =>
      request(app)
        .post("/api/inquiries")
        .set("Idempotency-Key", "regression-key-0001")
        .send(data);
    const a = await send(payload),
      b = await send(payload);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inquiries").get().n, 1);
    assert.equal(
      (await send({ ...payload, name: "Different viewer" })).status,
      409,
    );
  } finally {
    db.close();
  }
});

test("availability, pagination, limits and failed writes preserve inquiry integrity", async () => {
  const db = createDb(":memory:");
  let time = 1000;
  const app = createApp(db, { now: () => time });
  const logs = [],
    original = console.error;
  try {
    assert.equal(
      (await request(app).get("/api/listings").set("Host", "attacker.example"))
        .status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/inquiries")
          .set("Origin", "https://attacker.example")
          .send(payload)
      ).status,
      403,
    );
    const a = await request(app).get("/api/listings?limit=2"),
      b = await request(app).get("/api/listings?limit=2&offset=2");
    assert.equal(new Set([...a.body, ...b.body].map((x) => x.id)).size, 4);
    assert.equal(
      (await request(app).get("/api/listings?maxPrice=89000")).body.length,
      1,
    );
    db.prepare("UPDATE listings SET available=0 WHERE id=1").run();
    assert.equal((await request(app).get("/api/listings/1")).status, 404);
    assert.equal(
      (await request(app).post("/api/inquiries").send(payload)).status,
      404,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inquiries").get().n, 0);
    db.prepare("UPDATE listings SET available=1 WHERE id=1").run();
    db.exec(
      "CREATE TRIGGER fail_inquiry BEFORE INSERT ON inquiries BEGIN SELECT RAISE(ABORT,'Private phone +79990000000');END",
    );
    console.error = (x) => logs.push(x);
    const send = () =>
      request(app)
        .post("/api/inquiries")
        .set("Idempotency-Key", "failed-write-key")
        .send(payload);
    assert.equal((await send()).status, 503);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inquiries").get().n, 0);
    assert.ok(!JSON.stringify(logs).includes(payload.phone));
    db.exec("DROP TRIGGER fail_inquiry");
    assert.equal((await send()).status, 201);
    db.prepare("UPDATE listings SET available=0 WHERE id=1").run();
    assert.equal((await send()).status, 200);
    assert.equal(
      (
        await request(app)
          .post("/api/inquiries")
          .send({ ...payload, message: "x".repeat(17000) })
      ).status,
      413,
    );
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const r = await request(app).post("/api/inquiries").send({});
      if (r.status === 429) {
        assert.ok(Number(r.headers["retry-after"]) > 0);
        limited = true;
        break;
      }
    }
    assert.ok(limited);
    time += 60000;
    assert.equal(
      (await request(app).post("/api/inquiries").send({})).status,
      400,
    );
  } finally {
    console.error = original;
    db.close();
  }
});
