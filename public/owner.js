const $ = (id) => document.getElementById(id);
let ownerKey = "";
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + ownerKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.message || "Не удалось выполнить запрос: " + response.status,
    );
  }
  return response.status === 204 ? null : response.json();
}
function table(container, headings, rows) {
  const wrap = el("div");
  wrap.className = "scroll";
  const t = el("table"),
    thead = el("thead"),
    tr = el("tr");
  headings.forEach((h) => tr.append(el("th", h)));
  thead.append(tr);
  t.append(thead);
  const body = el("tbody");
  for (const cells of rows) {
    const row = el("tr");
    for (const item of cells) {
      const cell = el("td");
      item instanceof Node
        ? cell.append(item)
        : (cell.textContent = String(item ?? "—"));
      row.append(cell);
    }
    body.append(row);
  }
  t.append(body);
  wrap.append(t);
  container.replaceChildren(wrap);
  if (!rows.length) container.append(el("p", "Пока нет записей."));
}
function action(text, run) {
  const button = el("button", text);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  ownerKey = $("owner-key").value.trim();
  $("owner-key").value = "";
  try {
    await load();
    $("workspace").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
    message("Данные обновлены.");
  } catch (error) {
    ownerKey = "";
    message(error.message, true);
  }
});
$("logout").addEventListener("click", () => {
  ownerKey = "";
  location.reload();
});
$("refresh").addEventListener("click", async () => {
  try {
    await load();
    message("Данные обновлены.");
  } catch (error) {
    message(error.message, true);
  }
});
async function calendar() {
  const rows = await api(
    "/api/listings/" + $("listing").value + "/availability",
  );
  table(
    $("calendar"),
    ["Заезд", "Выезд", "Действие"],
    rows.map((r) => [
      r.start_date,
      r.end_date,
      action("Освободить период", async () => {
        await api("/api/owner/occupancy/" + r.id, { method: "DELETE" });
        await calendar();
        message("Период освобождён.");
      }),
    ]),
  );
}
async function load() {
  const inquiries = await api("/api/owner/inquiries");
  const notifications = await api("/api/owner/notifications");
  table(
    $("notifications"),
    ["Событие", "Заявка", "Попытки", "Статус", "Действие"],
    notifications.map((n) => [
      n.id,
      n.inquiry_id,
      n.attempts,
      n.delivered_at
        ? "Доставлено"
        : n.attempts >= 5
          ? "Требуется повтор"
          : "В очереди",
      !n.delivered_at && n.attempts >= 5
        ? action("Повторить доставку", async () => {
            await api("/api/owner/notifications/" + n.id + "/retry", {
              method: "POST",
            });
            await load();
            message("Событие возвращено в очередь.");
          })
        : "—",
    ]),
  );
  const listings = await api("/api/listings");
  table(
    $("inquiries"),
    ["Заявка", "Квартира", "Имя", "Телефон", "Сообщение", "Дата"],
    inquiries.map((i) => [
      i.id,
      i.listing_id,
      i.name,
      i.phone,
      i.message,
      i.created_at,
    ]),
  );
  const selected = $("listing").value;
  $("listing").replaceChildren(
    ...listings.map((l) => {
      const option = el("option", l.title);
      option.value = l.id;
      return option;
    }),
  );
  if (listings.some((l) => String(l.id) === selected))
    $("listing").value = selected;
  if (listings.length) await calendar();
}
$("listing").addEventListener("change", () =>
  calendar().catch((error) => message(error.message, true)),
);
$("occupancy").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/owner/listings/" + $("listing").value + "/occupancy", {
      method: "POST",
      body: JSON.stringify({
        startDate: $("start-date").value,
        endDate: $("end-date").value,
      }),
    });
    await calendar();
    message("Занятый период добавлен.");
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});
