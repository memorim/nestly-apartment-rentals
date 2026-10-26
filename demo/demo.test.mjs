import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
function browser() {
  let offset = 0;
  class Clock extends Date {
    static now() {
      return Date.now() + offset;
    }
  }
  let network = 0;
  const scope = {
    DEMO_SEED: JSON.parse(
      readFileSync(new URL("./seed.json", import.meta.url), "utf8"),
    ),
    structuredClone,
    Response,
    Headers,
    URL,
    DOMException,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    location: new URL("https://example.test/project/"),
    fetch: async () => {
      network++;
      throw Error("Unexpected network request");
    },
  };
  runInNewContext(
    readFileSync(new URL("./browser.js", import.meta.url), "utf8"),
    scope,
  );
  return {
    call: async (path, method = "GET", body, headers) => {
      const response = await scope.fetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    advance: (ms) => {
      offset += ms;
    },
    network: () => network,
  };
}
test("catalog filters, isolated inquiries and replay", async () => {
  const b = browser();
  const all = await b.call("/api/listings");
  assert(all.body.length > 0);
  const filtered = await b.call("/api/listings?maxPrice=100000&rooms=2");
  assert(filtered.body.every((x) => x.price <= 100000 && x.rooms >= 2));
  const payload = {
    listingId: all.body[0].id,
    name: "Roman",
    phone: "+7 999 123-45-67",
  };
  const first = await b.call("/api/inquiries", "POST", payload, {
    "Idempotency-Key": "one",
  });
  assert.equal(first.status, 201);
  assert.equal(
    (
      await b.call("/api/inquiries", "POST", payload, {
        "Idempotency-Key": "one",
      })
    ).body.id,
    first.body.id,
  );
  assert.equal(
    (
      await b.call(
        "/api/inquiries",
        "POST",
        { ...payload, name: "Changed" },
        { "Idempotency-Key": "one" },
      )
    ).status,
    409,
  );
  assert.equal(
    (await b.call("/api/inquiries", "POST", { ...payload, listingId: -1 }))
      .status,
    404,
  );
  assert.equal(b.network(), 0);
});
