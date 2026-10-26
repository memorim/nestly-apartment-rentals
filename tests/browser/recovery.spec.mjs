import {test,expect} from '@playwright/test';
test('mobile layout and recovery after a failed API request',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('.load-feedback')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.route('**/api/listings*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Test unavailable"}'}));
 await page.reload();await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
 await page.unroute('**/api/listings*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(page.locator('.load-feedback')).toHaveText('');
});
test('saved filter shows only selected apartments',async({page})=>{await page.goto('/');await page.locator('.heart').first().click();await page.locator('.saved').click();await expect(page.locator('.listing')).toHaveCount(1);await page.locator('.saved').click();await expect(page.locator('.listing')).not.toHaveCount(1);});

test('failed form submission retains entered data',async({page})=>{
 await page.goto('/');await page.locator("[data-view]").first().click();const form=page.locator("#inquiry");await expect(form).toBeVisible();
 const values={"name": "Browser Demo", "phone": "+7 900 000-00-00"};for(const [name,value] of Object.entries(values))await form.locator('[name="'+name+'"]').fill(value);
 await page.route('**/api/**',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
 await form.locator('button').last().click();await expect(form.getByRole('alert')).toContainText('Не удалось выполнить запрос');
 await expect(form.locator('[name="name"]')).toHaveValue(values["name"]);
});

test('malformed saved favorites do not prevent loading the catalog',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('nestly-saved','{broken'));
 await page.goto('/');await expect(page.locator('.listing')).toHaveCount(6);
 await page.locator('.heart').first().click();await expect(page.locator('#saved-count')).toHaveText('1');
});
test('a retry after a lost response uses the same operation key',async({page})=>{
 const keys=[];let attempts=0;
 await page.route('**/api/inquiries',async route=>{keys.push(route.request().headers()['idempotency-key']);if(attempts++===0)await route.abort();else await route.fulfill({status:200,contentType:'application/json',body:'{"id":777,"status":"received"}'});});
 await page.goto('/');await page.locator('[data-view]').first().click();
 await page.locator('[name=name]').fill('Retry viewer');await page.locator('[name=phone]').fill('+79990000000');
 await page.locator('.send').click();await expect(page.locator('[role=alert]')).toBeVisible();
 await page.locator('.send').click();await expect(page.locator('.success')).toContainText('сохранена');
 expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);
});

test('changing filters cancels the older catalog request',async({page})=>{
 await page.goto('/');await expect(page.locator('.listing')).toHaveCount(6);
 let held;let captured;const seen=new Promise(resolve=>captured=resolve);
 await page.route('**/api/listings*',route=>{if(new URL(route.request().url()).searchParams.get('rooms')==='3'){held=route;captured();}else route.continue();});
 await page.locator('#rooms').selectOption('3');await page.locator('.search button').click();await seen;
 const cancelled=page.waitForEvent('requestfailed',r=>new URL(r.url()).searchParams.get('rooms')==='3');
 await page.locator('#rooms').selectOption('0');await page.locator('#price').selectOption('100000');await page.locator('.search button').click();
 await cancelled;await held.abort();await expect(page.locator('.listing')).toHaveCount(1);await expect(page.locator('.listing h3')).toHaveText('Минималистичная студия');
});
