import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const token = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))![1];
const adminHeaders = { authorization: `Bearer ${token}` };

test('demand record, campaign journey, approved click attribution and reversal work together', async ({ page, context, request }) => {
  const key = 'e2e-' + Date.now();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await page.locator('#admin-token').fill(token);
  await page.getByRole('button', { name: '運用状況を読み込む' }).click();
  await expect(page.locator('#admin-private')).toBeVisible();
  const hypothesisForm = page.locator('#growth-hypothesis-form');
  if (!await hypothesisForm.isVisible()) await hypothesisForm.locator('..').locator('summary').click();
  await page.locator('#growth-audience').fill('検証用の小規模チーム');
  await page.locator('#growth-category').selectOption('automation');
  await page.locator('#growth-pain').fill('同じ見積書の転記を減らす方法を比較したい');
  await page.locator('#growth-query').fill(key + ' 転記 自動化');
  await page.locator('#growth-target').fill('/compare/make-vs-zapier');
  await hypothesisForm.getByRole('button', { name: /保存|登録/ }).click();
  await expect(page.locator('#growth-hypotheses')).toContainText(key);
  let overview = await (await request.get('/api/admin/growth', { headers: adminHeaders })).json();
  const hypothesis = overview.hypotheses.find((h: any) => h.query.startsWith(key));
  expect(hypothesis).toBeTruthy();
  const evidence = await request.post('/api/admin/growth/evidence', { headers: adminHeaders, data: {
    id: key + '-evidence', hypothesisId: hypothesis.id, kind: 'customer_quote',
    sourceUrl: 'https://www.make.com/en/community', observedAt: new Date(Date.now() - 1000).toISOString(),
    summary: 'ブラウザテスト専用の観測記録です。実際の顧客発言や需要の証拠として扱いません。',
  } });
  expect(evidence.status()).toBe(201);
  const campaignId = key + '-campaign';
  expect((await request.post('/api/admin/growth/campaigns', { headers: adminHeaders, data: {
    id: campaignId, name: 'ブラウザ検証用の施策', source: 'threads', hypothesisId: hypothesis.id, targetPath: hypothesis.targetPath,
  } })).status()).toBe(201);
  const offer = {
    id: 'make', name: 'Make', category: 'automation', description: 'Isolated browser fixture; no actual affiliate relationship.',
    url: 'https://www.make.com/?fixture=e2e%2Bonly&sig=keep%2Fbytes', allowedHosts: ['www.make.com'],
    enabled: true, verifiedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: null,
    clickTracking: { parameter: 'sub_id', approved: true },
  };
  expect((await request.put('/api/admin/offers', { headers: adminHeaders, data: offer })).ok()).toBe(true);
  // Never visit the real provider in the test or trigger an actual affiliate request.
  await context.route('https://www.make.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Local test destination</p>' }));
  try {
    await page.goto('/compare/make-vs-zapier?campaign=' + campaignId);
    await expect.poll(() => page.evaluate(() => Boolean(sessionStorage.getItem('shigoto-visit-v1')))).toBe(true);
    await page.goto('/tools/make');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/analytics/event') && response.request().postDataJSON()?.kind === 'affiliate_click');
    const popupPromise = context.waitForEvent('page');
    await page.locator('a[data-offer="make"]').click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const click = await response.json();
    const popup = await popupPromise;
    await popup.waitForURL(url => url.hostname === 'www.make.com');
    expect(new URL(popup.url()).searchParams.get('sub_id')).toBe(click.clickId);
    expect(click.url).toBe(offer.url + '&sub_id=' + click.clickId);
    await popup.close();
    const conversion = { externalId: key + '-sale', offerId: 'make', commissionJpy: 456, occurredAt: new Date().toISOString(), clickId: click.clickId };
    expect((await request.post('/api/admin/conversions', { headers: adminHeaders, data: conversion })).status()).toBe(201);
    expect((await (await request.post('/api/admin/conversions', { headers: adminHeaders, data: conversion })).json()).created).toBe(false);
    const analytics = await (await request.get('/api/admin/analytics', { headers: adminHeaders })).json();
    expect(analytics.recentConversions.find((c: any) => c.externalId === conversion.externalId)).toMatchObject({ campaignId, source: 'threads', pagePath: '/tools/make', status: 'confirmed' });
    expect(analytics.campaignRows.find((r: any) => r.campaignId === campaignId)).toMatchObject({ visits: 1, clicks: 1, attributableClicks: 1, matureAttributableClicks: 0, conversionRate: null });
    expect((await request.post('/api/admin/conversions/reverse', { headers: adminHeaders, data: { externalId: conversion.externalId } })).ok()).toBe(true);
    const after = await (await request.get('/api/admin/analytics', { headers: adminHeaders })).json();
    expect(after.totals.confirmedRevenueJpy).toBe(analytics.totals.confirmedRevenueJpy - 456);
    expect(after.recentConversions.find((c: any) => c.externalId === conversion.externalId).status).toBe('reversed');
    expect((await request.post('/api/admin/growth/evaluate', { headers: adminHeaders, data: {} })).ok()).toBe(true);
    overview = await (await request.get('/api/admin/growth', { headers: adminHeaders })).json();
    const decision = overview.decisions.find((d: any) => d.campaignId === campaignId);
    expect(decision.kind).toBe('collect_traffic');
    expect((await request.patch('/api/admin/growth/decisions', { headers: adminHeaders, data: { id: decision.id, status: 'applied', note: 'テスト用の変更記録です。実際の広告や投稿は変更していません。' } })).ok()).toBe(true);
    expect((await request.patch('/api/admin/growth/decisions', { headers: adminHeaders, data: { id: decision.id, status: 'evaluated', note: '観測期間より早い評価が拒否されることを確認する。' } })).status()).toBe(409);
    await page.goto('/admin');
    await page.locator('#admin-token').fill(token);
    await page.getByRole('button', { name: '運用状況を読み込む' }).click();
    await expect(page.locator('#growth-decisions')).toContainText('変更済み');
    await expect(page.locator('#growth-conversions')).toContainText('取消');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await request.put('/api/admin/offers', { headers: adminHeaders, data: { ...offer, enabled: false } });
    await request.patch('/api/admin/growth/campaigns', { headers: adminHeaders, data: { id: campaignId, status: 'paused' } });
    await request.patch('/api/admin/growth/hypotheses', { headers: adminHeaders, data: { id: hypothesis.id, status: 'paused' } });
  }
});

test('privacy preference and browser tracking refusal leave diagnosis usable without telemetry', async ({ page, context, request }) => {
  await page.goto('/privacy');
  await page.getByRole('button', { name: 'このブラウザの計測を停止する' }).click();
  await expect(page.locator('#measurement-status')).toContainText('計測しません');
  const requests: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/analytics/')) requests.push(r.url()); });
  const before = await (await request.get('/api/admin/status', { headers: adminHeaders })).json();
  await page.goto('/diagnosis');
  await page.locator('input[name=useCase][value=automation]').check();
  await page.locator('input[name=budget][value=paid]').check();
  await page.locator('input[name=team][value=team]').check();
  await page.getByRole('button', { name: 'ぴったりの候補を見る' }).click();
  await expect(page.locator('#diagnosis-results')).toContainText('Make');
  expect(requests).toEqual([]);
  expect((await (await request.get('/api/admin/status', { headers: adminHeaders })).json()).metrics.diagnoses).toBe(before.metrics.diagnoses);
  await context.clearCookies();
  await page.evaluate(() => localStorage.removeItem('shigoto-measurement-off'));
  await context.setExtraHTTPHeaders({ DNT: '1' });
  // The browser API can differ from request headers; server-side refusal must still work.
  const ignored = await request.post('/api/analytics/visit', { headers: { origin: 'http://127.0.0.1:8791', DNT: '1' }, data: { path: '/', source: 'direct' } });
  expect(ignored.status()).toBe(202);
  expect((await ignored.json()).ignored).toBe(true);
});
