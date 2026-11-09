import { test, expect } from '@playwright/test';

for (const [status, confirmation] of [
  ['received', 'Заявка сохранена. Менеджер увидит её в кабинете владельца.'],
  ['saved_locally', 'Заявка сохранена в текущей вкладке. Контакты не отправлены менеджеру.'],
]) {
  test(`inquiry confirmation reflects ${status}`, async ({ page }, testInfo) => {
    await page.route('**/api/inquiries', route => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 777, status }),
    }));
    await page.goto('/');
    await expect(page.locator('.listing')).toHaveCount(6);
    if (process.env.UPDATE_UI_SCREENSHOTS && status === 'received') {
      await page.screenshot({ path: `screenshots/${testInfo.project.name}.png`, fullPage: true });
    }
    await page.locator('[data-view]').first().click();
    await page.locator('[name=name]').fill('Техническая проверка');
    await page.locator('[name=phone]').fill('+12025550123');
    await page.locator('.send').click();
    await expect(page.locator('.success')).toHaveText(confirmation);
    await expect(page.locator('[name=name]')).toHaveValue('');
    if (process.env.UPDATE_UI_SCREENSHOTS && status === 'received') {
      await page.screenshot({ path: `screenshots/inquiry-${testInfo.project.name}.png` });
    }
  });
}
