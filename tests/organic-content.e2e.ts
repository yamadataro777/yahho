import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('meeting template can be edited, copied and downloaded without sending its contents', async ({ page, context }) => {
 const marker = '非公開の議事録テスト内容-送信しない';
 const bodies: string[] = [];
 page.on('request', request => { const body = request.postData(); if (body) bodies.push(body); });
 await context.grantPermissions(['clipboard-read', 'clipboard-write']);
 await page.goto('/guides/meeting-notes-template');
 const field = page.getByLabel('議事録のひな形');
 const initial = await field.inputValue();
 expect(initial).toContain('決定事項');
 await field.fill(initial + marker);
 await page.getByRole('button', { name: '内容をコピー', exact: true }).click();
 await expect(page.locator('#template-status')).toContainText('コピーしました');
 expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(initial + marker);
 const downloadPromise = page.waitForEvent('download');
 await page.getByRole('button', { name: 'テキストで保存', exact: true }).click();
 const download = await downloadPromise;
 expect(download.suggestedFilename()).toBe('meeting-notes.txt');
 expect(readFileSync((await download.path())!, 'utf8')).toBe(initial + marker);
 expect(bodies.every(body => !body.includes(marker))).toBe(true);
 expect(await page.evaluate(text => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(text)), marker)).toBe(false);
 await page.reload();
 await expect(field).toHaveValue(initial);
 await field.fill('編集した内容');
 await page.getByRole('button', { name: '初期テンプレートに戻す' }).click();
 await expect(field).toHaveValue(initial);
});

test('organic entry pages offer crawlable task links and editorial attribution on narrow screens', async ({ page }) => {
 await page.setViewportSize({ width: 320, height: 740 });
 await page.goto('/');
 await page.locator('.intent-card[href="/guides/meeting-notes-template"]').click();
 await expect(page.locator('h1')).toContainText('議事録');
 await expect(page.locator('.related-reading a[href="/guides/meeting-notes-checklist"]')).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.locator('#meeting-template').evaluate(element => element.scrollIntoView({ block: 'start' }));
 await page.screenshot({ path: 'test-results/meeting-template-mobile.png' });
 await page.locator('.byline a[href="/editorial-policy"]').click();
 await expect(page.locator('h1')).toHaveText('編集方針と比較の方法');
 await page.goto('/guides/make-zapier-workflow');
 await page.locator('.related-reading a[href="/compare/make-vs-zapier"]').click();
 await expect(page.locator('h1')).toContainText('MakeとZapier');
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('meeting template is available as readable HTML when JavaScript is disabled', async ({ browser }) => {
 const context = await browser.newContext({ javaScriptEnabled: false });
 try {
  const page = await context.newPage();
  const response = await page.goto('http://127.0.0.1:8791/guides/meeting-notes-template');
  expect(response?.status()).toBe(200);
  await expect(page.getByLabel('議事録のひな形')).toBeVisible();
  await expect(page.getByLabel('議事録のひな形')).toHaveValue(/次にすること/);
  await expect(page.locator('#template-actions')).toBeHidden();
  await expect(page.locator('noscript p')).toHaveText('テキスト欄を選択してコピーし、お使いの文書アプリに貼り付けてください。');
 } finally { await context.close(); }
});
