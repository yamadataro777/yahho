import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAdmin, validateConversion, validateOffer } from '../src/admin';
import { getArticle, isAllowedOfferUrl, isUsableOffer, listArticles, recordEvent } from '../src/store';
import { ARTICLES } from '../src/content';
import type { Env } from '../src/types';

const token = 'local-test-token-at-least-thirty-two-characters';
let sql: DatabaseSync;
let env: Env;

function statement(query: string, values: unknown[] = []) {
  return {
    bind(...args: unknown[]) { return statement(query, args); },
    async first() { return sql.prepare(query).get(...values as any[]) ?? null; },
    async all() { return { results: sql.prepare(query).all(...values as any[]), success: true, meta: {} }; },
    async run() { const r = sql.prepare(query).run(...values as any[]); return { success: true, meta: { changes: Number(r.changes) } }; },
  };
}

beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0002_analytics.sql', import.meta.url), 'utf8'));
  env = { DB: { prepare: (query: string) => statement(query) }, ADMIN_TOKEN: token, CONVERSION_TOKEN: token } as unknown as Env;
});
afterEach(() => sql.close());

function request(path: string, method = 'GET', body?: unknown, bearer: string | null = token): Request {
  return new Request(`https://site.test${path}`, { method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

function validOffer() {
  return { id: 'partner-one', name: 'Example approved partner', category: 'writing', description: 'Approved partner supplied by the site operator.', url: 'https://px.a8.net/svt/ejp?a8mat=1%2F2&sig=ab%2Bcd', enabled: true, allowedHosts: ['px.a8.net'], verifiedAt: '2025-01-01T00:00:00.000Z', expiresAt: null };
}

describe('affiliate URL trust boundary', () => {
  it('preserves a signed ASP URL and accepts only an exact HTTPS host', () => {
    const input = validOffer();
    expect(validateOffer(input).url).toBe(input.url);
    expect(isAllowedOfferUrl('https://px.a8.net.attacker.com/', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl('http://px.a8.net/', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl('https://user:password@px.a8.net/', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl('https://127.0.0.1/', ['127.0.0.1'])).toBe(false);
    expect(isAllowedOfferUrl('https://internal.local/', ['internal.local'])).toBe(false);
    expect(isAllowedOfferUrl('https://example.com/', ['example.com'])).toBe(false);
    expect(isAllowedOfferUrl('https://px.a8.net:444/', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl('https://px.a8.net/\ntrack?a8mat=a', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl(' https://px.a8.net/', ['px.a8.net'])).toBe(false);
    expect(isAllowedOfferUrl('https://px.a8.net/日本語', ['px.a8.net'])).toBe(false);
  });
  it('requires verification before activation and never uses an expired offer', () => {
    expect(() => validateOffer({ ...validOffer(), verifiedAt: null })).toThrow(/verifiedAt/);
    expect(() => validateOffer({ ...validOffer(), verifiedAt: '2999-01-01T00:00:00Z' })).toThrow(/future/);
    expect(isUsableOffer({ ...validOffer(), expiresAt: '2025-01-02T00:00:00Z' })).toBe(false);
    expect(isUsableOffer({ ...validOffer(), enabled: false })).toBe(false);
    expect(isUsableOffer(validOffer())).toBe(true);
  });
});

describe('admin authentication and input boundaries', () => {
  it('does not authorize absent, incorrect or weak configured credentials', async () => {
    expect((await handleAdmin(request('/api/admin/status', 'GET', undefined, null), env))?.status).toBe(401);
    expect((await handleAdmin(request('/api/admin/status', 'GET', undefined, 'wrong'), env))?.status).toBe(401);
    expect((await handleAdmin(request('/api/admin/status'), { ...env, ADMIN_TOKEN: undefined }))?.status).toBe(503);
    expect((await handleAdmin(request('/api/admin/status'), { ...env, ADMIN_TOKEN: 'short' }))?.status).toBe(503);
    expect(await handleAdmin(request('/guides/example'), env)).toBeNull();
  });
  it('rejects oversized and malformed bodies before storage writes', async () => {
    expect((await handleAdmin(request('/api/admin/offers', 'PUT', { payload: 'a'.repeat(20_000) }), env))?.status).toBe(413);
    const malformed = new Request('https://site.test/api/admin/offers', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{bad' });
    expect((await handleAdmin(malformed, env))?.status).toBe(400);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM offers').get()?.n).toBe(0);
  });
});

describe('real SQL-backed tracking and revenue', () => {
  it('reports honest initial zero counts and aggregates events without visitor data', async () => {
    const initial = await (await handleAdmin(request('/api/admin/status'), env))!.json() as any;
    expect(initial.metrics).toEqual({ diagnoses: 0, affiliateClicks: 0, confirmedConversions: 0, confirmedRevenueJpy: 0 });
    await recordEvent(env, { kind: 'diagnosis', variant: 'writing' });
    await recordEvent(env, { kind: 'diagnosis', variant: 'writing' });
    await recordEvent(env, { kind: 'affiliate_click', offerId: 'partner-one' });
    const updated = await (await handleAdmin(request('/api/admin/status'), env))!.json() as any;
    expect(updated.metrics).toEqual({ diagnoses: 2, affiliateClicks: 1, confirmedConversions: 0, confirmedRevenueJpy: 0 });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(2);
    expect(sql.prepare('PRAGMA table_info(events)').all().map(row => row.name)).not.toContain('ip');
    await expect(recordEvent(env, { kind: 'diagnosis', variant: 'private@example.com' })).rejects.toThrow();
  });
  it('persists signed links unchanged and imports confirmed commission idempotently', async () => {
    expect((await handleAdmin(request('/api/admin/offers', 'PUT', validOffer()), env))?.status).toBe(200);
    const offers = await (await handleAdmin(request('/api/admin/offers'), env))!.json() as any;
    expect(offers.offers[0].url).toBe(validOffer().url);
    const conversion = { externalId: 'a8:transaction-1', offerId: 'partner-one', commissionJpy: 1200, occurredAt: '2025-01-01T00:00:00Z' };
    const first = await handleAdmin(request('/api/conversions/webhook', 'POST', conversion), env);
    expect(first?.status).toBe(201);
    const repeat = await handleAdmin(request('/api/conversions/webhook', 'POST', conversion), env);
    expect(repeat?.status).toBe(200);
    expect(await repeat?.json()).toEqual({ ok: true, created: false });
    const conflict = await handleAdmin(request('/api/conversions/webhook', 'POST', { ...conversion, commissionJpy: 9999 }), env);
    expect(conflict?.status).toBe(409);
    const metrics = (await (await handleAdmin(request('/api/admin/status'), env))!.json() as any).metrics;
    expect(metrics.confirmedConversions).toBe(1);
    expect(metrics.confirmedRevenueJpy).toBe(1200);
  });
  it('rejects unknown offers and malformed commission records', async () => {
    const input = { externalId: 'transaction-1', offerId: 'missing', commissionJpy: 1200, occurredAt: '2025-01-01T00:00:00Z' };
    expect((await handleAdmin(request('/api/admin/conversions', 'POST', input), env))?.status).toBe(404);
    expect(() => validateConversion({ ...input, commissionJpy: -1 })).toThrow();
    expect(() => validateConversion({ ...input, commissionJpy: 1.2 })).toThrow();
    expect(() => validateConversion({ ...input, occurredAt: '2999-01-01T00:00:00Z' })).toThrow();
    expect(() => validateConversion({ ...input, externalId: 'customer@example.com' })).toThrow();
  });
});

describe('article publication states', () => {
  it('allows withholding and republishing a seed without changing its content', async () => {
    const seed = ARTICLES[0];
    expect((await handleAdmin(request('/api/admin/articles', 'PATCH', { slug: seed.slug, status: 'draft' }), env))?.status).toBe(200);
    expect(await getArticle(env, seed.slug)).toBeNull();
    expect((await handleAdmin(request('/api/admin/articles', 'PATCH', { slug: seed.slug, status: 'published' }), env))?.status).toBe(200);
    expect(await getArticle(env, seed.slug)).toEqual(seed);
    expect((await handleAdmin(request('/api/admin/articles', 'PATCH', { slug: 'does-not-exist', status: 'published' }), env))?.status).toBe(404);
  });
  it('refuses to publish corrupted stored content or unknown source references', async () => {
    const seed = ARTICLES[0];
    const bad = { ...seed, sourceIds: ['unknown-source'] };
    sql.prepare("INSERT INTO articles VALUES (?, ?, 'draft', 'automation', ?, ?)").run(seed.slug, JSON.stringify(bad), '2025-01-01', '2025-01-01');
    expect((await handleAdmin(request('/api/admin/articles', 'PATCH', { slug: seed.slug, status: 'published' }), env))?.status).toBe(422);
    expect(await getArticle(env, seed.slug)).toBeNull();
    expect((await handleAdmin(request('/api/admin/articles', 'PATCH', { slug: seed.slug, status: 'rejected' }), env))?.status).toBe(200);
  });
  it('serves seed articles and honors database withholding and published overrides', async () => {
    expect(ARTICLES.length).toBeGreaterThan(0);
    const seed = ARTICLES[0];
    expect(await getArticle(env, seed.slug)).toEqual(seed);
    const changed = { ...seed, title: 'Updated title' };
    sql.prepare("INSERT INTO articles VALUES (?, ?, 'draft', 'automation', ?, ?)").run(seed.slug, JSON.stringify(changed), '2025-01-01', '2025-01-01');
    expect(await getArticle(env, seed.slug)).toBeNull();
    expect((await listArticles(env)).some(article => article.slug === seed.slug)).toBe(false);
    sql.prepare("UPDATE articles SET status = 'published' WHERE slug = ?").run(seed.slug);
    expect((await getArticle(env, seed.slug))?.title).toBe('Updated title');
    expect((await listArticles(env)).filter(article => article.slug === seed.slug)).toHaveLength(1);
  });
});
