const credentials = document.querySelector('#credentials');
const profile = document.querySelector('#profile');
const status = document.querySelector('#status');
const bookingForm = document.querySelector('#booking-form');
const bookingList = document.querySelector('#bookings');
const checkoutStatus = document.querySelector('#checkout-status');

async function request(path, options) {
  const response = await fetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.message || 'Не удалось выполнить запрос');
  return data;
}

async function showProfile(account) {
  document.querySelector('#account-email').textContent = account.email;
  credentials.hidden = true;
  profile.hidden = false;
  const [ids, listings] = await Promise.all([
    request('/api/account/favorites'), request('/api/listings'),
  ]);
  const favorites = document.querySelector('#favorites');
  favorites.replaceChildren();
  for (const listing of listings.filter(item => ids.includes(item.id))) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = './?listing=' + listing.id + '#catalog';
    link.textContent = listing.title;
    item.append(link);
    favorites.append(item);
  }
  if (!favorites.childElementCount) {
    const item = document.createElement('li');
    item.textContent = 'В избранном пока нет квартир.';
    favorites.append(item);
  }
  await showBookings(listings);
}

async function showBookings(listings = []) {
  const checkout = await request('/api/account/bookings');
  bookingForm.hidden = !checkout.testPayments;
  checkoutStatus.textContent = checkout.testPayments
    ? 'ЮKassa работает в тестовом режиме. Бронируется первый месяц аренды.'
    : 'Для тестовой оплаты требуется подключить тестовый магазин ЮKassa.';
  if (listings.length) {
    bookingForm.elements.listingId.replaceChildren(...listings.map(listing => {
      const option = document.createElement('option');
      option.value = listing.id;
      option.textContent = listing.title;
      return option;
    }));
  }
  bookingList.replaceChildren();
  for (const booking of checkout.bookings) {
    const item = document.createElement('li');
    const expired = booking.status === 'pending' && booking.expires_at <= Date.now();
    const status = expired ? 'Срок оплаты истёк' : {
      pending: 'Ожидает оплаты', capturing: 'Оплата проверяется',
      confirmed: 'Забронировано', canceled: 'Отменено',
    }[booking.status];
    item.textContent = `Квартира №${booking.listing_id} · ${booking.start_date} — ${booking.end_date} · ${booking.amount_rub} ₽ · ${status} `;
    if (booking.status === 'pending' && !expired && booking.payment_url) {
      const link = document.createElement('a');
      link.href = booking.payment_url;
      link.textContent = 'Оплатить в тестовом режиме';
      item.append(link, ' ');
    }
    if (booking.payment_url && ['pending', 'capturing'].includes(booking.status)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Проверить оплату';
      button.onclick = () => verifyPayment(booking.id);
      item.append(button);
    }
    bookingList.append(item);
  }
}

async function verifyPayment(id) {
  try {
    const booking = await request('/api/account/bookings/' + encodeURIComponent(id) + '/verify', { method: 'POST' });
    await showBookings();
    status.textContent = booking.status === 'confirmed'
      ? 'Тестовая оплата подтверждена. Квартира забронирована.'
      : 'Статус тестового платежа обновлён.';
  } catch (error) { status.textContent = error.message; }
}

bookingForm.onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const fields = new FormData(bookingForm);
  try {
    const booking = await request('/api/account/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: Number(fields.get('listingId')), startDate: fields.get('startDate') }),
    });
    if (booking.payment_url) location.assign(booking.payment_url);
    else await showBookings();
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; }
};

credentials.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const buttons = form.querySelectorAll('button');
  for (const button of buttons) button.disabled = true;
  status.textContent = '';
  try {
    const account = await request('/api/account/' + event.submitter.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    await showProfile(account);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    for (const button of buttons) button.disabled = false;
  }
};

document.querySelector('#logout').onclick = async () => {
  try {
    await request('/api/account/logout', { method: 'POST' });
    profile.hidden = true;
    credentials.hidden = false;
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
};

async function loadAccount() {
  try {
    const response = await fetch('/api/account');
    if (response.status === 401) credentials.hidden = false;
    else if (response.ok) {
      await showProfile(await response.json());
      const booking = new URLSearchParams(location.search).get('booking');
      if (booking) await verifyPayment(booking);
    }
    else throw new Error('Аккаунт доступен при серверном запуске Nestly');
  } catch (error) {
    status.textContent = error.message;
  }
}
void loadAccount();
