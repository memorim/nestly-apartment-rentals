// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
// ponytail: state lasts for one page session; use the documented server for shared, durable data.
(() => {
  const state = structuredClone(globalThis.DEMO_SEED);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, min = 1, max = 200) => {
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      fail("Проверьте введённые данные");
    return value.trim();
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, globalThis.location.href);
    if (
      url.origin !== globalThis.location.origin ||
      !url.pathname.startsWith("/api/")
    )
      return originalFetch(input, options);
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    try {
      return await handle(
        url,
        options.method || "GET",
        options.body ? JSON.parse(options.body) : {},
        new Headers(options.headers),
      );
    } catch (error) {
      return json(
        { message: error.message, detail: error.message },
        error.status || 400,
      );
    }
  };
  globalThis.PORTFOLIO_DEMO = true;

  let inquiries = 0;
  const seen = new Map();
  async function handle(url, method, body, headers) {
    if (url.pathname === "/api/listings" && method === "GET") {
      const q = url.searchParams;
      return json(
        state["/api/listings"]
          .filter(
            (x) =>
              (!q.get("district") ||
                q.get("district") === "all" ||
                x.district === q.get("district")) &&
              x.rooms >= Number(q.get("rooms") || 0) &&
              (!Number(q.get("maxPrice")) ||
                x.price <= Number(q.get("maxPrice"))),
          )
          .sort((a, b) => a.price - b.price || a.id - b.id),
      );
    }
    if (url.pathname === "/api/inquiries" && method === "POST") {
      text(body.name, 2, 80);
      if (!/^[+()\d\s-]{7,32}$/.test(body.phone || ""))
        fail("Проверьте телефон");
      if (
        !state["/api/listings"].some(
          (x) => x.id === body.listingId && x.available,
        )
      )
        fail("Квартира недоступна", 404);
      const key = headers.get("Idempotency-Key"),
        serialized = JSON.stringify(body);
      if (key && seen.has(key)) {
        const previous = seen.get(key);
        if (previous.body !== serialized)
          fail("Запрос с этим ключом уже обработан", 409);
        return json(previous.result);
      }
      if (inquiries >= 20) fail("Перезагрузите страницу для новой сессии", 429);
      const result = { id: ++inquiries, status: "saved_locally" };
      if (key) seen.set(key, { body: serialized, result });
      return json(result, 201);
    }
    fail("Маршрут недоступен в браузерной версии", 404);
  }
})();
