const credentials = document.querySelector('#credentials');
const profile = document.querySelector('#profile');
const status = document.querySelector('#status');

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
}

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
    else if (response.ok) await showProfile(await response.json());
    else throw new Error('Аккаунт доступен при серверном запуске Nestly');
  } catch (error) {
    status.textContent = error.message;
  }
}
void loadAccount();
