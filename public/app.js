const loadFeedback = document.createElement("p");
loadFeedback.className = "load-feedback";
loadFeedback.setAttribute("role", "status");
loadFeedback.style.cssText =
  "position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:#fff8dd;color:#222;padding:12px 20px;margin:0;font:14px/1.5 system-ui;border-radius:8px";
document.querySelector("main").prepend(loadFeedback);
let lastLoadArgs = [],
  loadController;
async function load(...args) {
  loadController?.abort();
  const controller = (loadController = new AbortController());
  lastLoadArgs = args;
  loadFeedback.hidden = false;
  loadFeedback.textContent = "Загрузка данных…";
  try {
    await loadData(controller.signal);
    if (controller.signal.aborted) return;
    loadFeedback.textContent = "";
    loadFeedback.hidden = true;
  } catch (error) {
    if (controller.signal.aborted) return;
    loadFeedback.textContent = "Не удалось загрузить данные. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Повторить загрузку";
    retry.onclick = () => load(...lastLoadArgs);
    loadFeedback.append(retry);
  }
}
let saved = new Set(),
  list = [],
  onlySaved = false,
  lastInquiry;
try {
  saved = new Set(
    JSON.parse(localStorage.getItem("nestly-saved") || "[]").filter(
      Number.isSafeInteger,
    ),
  );
} catch {
  /* Keep session controls usable when saved data or storage is unavailable. */
}
const money = (v) => `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
async function loadData(signal) {
  const qs = new URLSearchParams({
    district: district.value,
    rooms: rooms.value,
    maxPrice: price.value,
  });
  list = await fetch(`/api/listings?${qs}`, { signal }).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
  if (onlySaved) list = list.filter((x) => saved.has(x.id));
  document.querySelector("#result-count").textContent = list.length;
  document.querySelector("#listings").innerHTML =
    list
      .map(
        (x, n) =>
          `<article class="listing"><div class="listing-art" style="--accent:${x.accent};--hue:${n * 12}deg"><img src="photos/${x.style}.webp" alt="Интерьер квартиры" width="1440" height="960" loading="lazy" decoding="async"><span>${x.style}</span><button class="heart ${saved.has(x.id) ? "active" : ""}" data-save="${x.id}">♡</button></div><div class="listing-info"><small>${x.district} · ${x.address}</small><h3>${x.title}</h3><div class="specs"><span>${x.rooms} комн.</span><span>${x.area} м²</span><span>${x.floor} этаж</span></div><div class="listing-foot"><strong>${money(x.price)} <small>/ месяц</small></strong><button data-view="${x.id}">Записаться →</button></div></div></article>`,
      )
      .join("") || '<p role="status">По выбранным условиям квартир нет.</p>';
  document.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = Number(b.dataset.save);
        saved.has(id) ? saved.delete(id) : saved.add(id);
        try {
          localStorage.setItem("nestly-saved", JSON.stringify([...saved]));
        } catch {
          /* Favorites remain available for this session. */
        }
        document.querySelector("#saved-count").textContent = saved.size;
        load();
      }),
  );
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        const x = list.find((v) => v.id === Number(b.dataset.view));
        document.querySelector("[name=listingId]").value = x.id;
        document.querySelector("#dialog-title").textContent = x.title;
        document.querySelector("dialog").showModal();
      }),
  );
}
document.querySelector(".search").onsubmit = (e) => {
  e.preventDefault();
  load();
};
document.querySelector(".close").onclick = () =>
  document.querySelector("dialog").close();
document.querySelector("#inquiry").onsubmit = async (e) => {
  e.preventDefault();
  const d = new FormData(e.target);
  const body = JSON.stringify({
    listingId: Number(d.get("listingId")),
    name: d.get("name"),
    phone: d.get("phone"),
    message: d.get("message"),
  });
  if (lastInquiry?.body !== body)
    lastInquiry = { body, key: crypto.randomUUID() };
  const r = await fetch("/api/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": lastInquiry.key,
    },
    body,
  });
  const out = await r.json();
  document.querySelector(".success").textContent = r.ok
    ? "Демо-заявка сохранена. Уведомления менеджеру не отправляются."
    : out.message;
  if (r.ok) {
    e.target.reset();
    lastInquiry = null;
  }
};
document.querySelector("#saved-count").textContent = saved.size;
load();

document.querySelector(".saved").onclick = () => {
  onlySaved = !onlySaved;
  document
    .querySelector(".saved")
    .setAttribute("aria-pressed", String(onlySaved));
  load();
  document.querySelector("#listings").scrollIntoView({ behavior: "smooth" });
};
document.querySelector(".menu").onclick = () =>
  document.querySelector(".search").scrollIntoView({ behavior: "smooth" });

for (const form of document.querySelectorAll("form")) {
  const submit = form.onsubmit;
  if (!submit) continue;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector(
      "button[type=submit],button.send,button:not([type])",
    );
    if (button) button.disabled = true;
    form.querySelector("[role=alert]")?.remove();
    try {
      await submit(event);
    } catch {
      let message = form.querySelector("[role=alert]");
      if (!message) {
        message = document.createElement("p");
        message.setAttribute("role", "alert");
        form.append(message);
      }
      message.textContent =
        "Не удалось выполнить запрос. Повторите действие; введённые данные остаются в форме.";
    } finally {
      if (button) button.disabled = false;
    }
  };
}
