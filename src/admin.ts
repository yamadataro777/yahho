import { ARTICLES, CATEGORIES, SOURCES } from './content';
import { isAllowedOfferUrl, listOffers } from './store';
import type { Article, Env, Offer } from './types';

const BODY_LIMIT = 16_384;
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;

class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function tokenMatches(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

async function authorize(request: Request, expected?: string): Promise<Response | null> {
  if (!expected || expected.length < 32) return reply({ error: 'not_configured', message: '管理用シークレット（32文字以上）の設定が必要です。' }, 503);
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (token.length > 512 || !(await tokenMatches(token, expected))) return reply({ error: 'unauthorized' }, 401);
  return null;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Content-Type must be application/json', 415);
  const length = request.headers.get('content-length');
  if (length && Number(length) > BODY_LIMIT) throw new InputError('Request body too large', 413);
  if (!request.body) throw new InputError('JSON body required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_LIMIT) { await reader.cancel(); throw new InputError('Request body too large', 413); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(all)); } catch { throw new InputError('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('JSON object required');
  return body as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`Invalid ${name}`);
  return value;
}

function date(value: unknown, name: string, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new InputError(`Invalid ${name}`);
  return new Date(value).toISOString();
}

export function validateOffer(body: Record<string, unknown>, now = Date.now()): Offer {
  const id = text(body.id, 'id', 80);
  if (!idPattern.test(id)) throw new InputError('Invalid offer id');
  const name = text(body.name, 'name', 120);
  const category = text(body.category, 'category', 80);
  if (!idPattern.test(category)) throw new InputError('Invalid category');
  const description = text(body.description, 'description', 500);
  // Keep the original signed ASP URL byte-for-byte; never add tracking parameters.
  const url = text(body.url, 'url', 4_096);
  const hosts = body.allowedHosts;
  if (!Array.isArray(hosts) || hosts.length > 12 || hosts.some(host => typeof host !== 'string')) throw new InputError('Invalid allowedHosts');
  const allowedHosts = hosts as string[];
  if (!isAllowedOfferUrl(url, allowedHosts)) throw new InputError('URL must use HTTPS and match a public hostname in allowedHosts');
  if (typeof body.enabled !== 'boolean') throw new InputError('enabled must be a boolean');
  const verifiedAt = date(body.verifiedAt ?? null, 'verifiedAt');
  const expiresAt = date(body.expiresAt ?? null, 'expiresAt');
  if (verifiedAt && Date.parse(verifiedAt) > now) throw new InputError('verifiedAt cannot be in the future');
  if (body.enabled && !verifiedAt) throw new InputError('Confirm ASP approval and URL validity, then supply verifiedAt before enabling');
  if (body.enabled && expiresAt && Date.parse(expiresAt) <= now) throw new InputError('Cannot enable an expired offer');
  return { id, name, category, description, url, allowedHosts, enabled: body.enabled, verifiedAt, expiresAt };
}

export interface ConversionInput { externalId: string; offerId: string; commissionJpy: number; occurredAt: string }

export function isPublishableArticle(value: unknown, slug: string): value is Article {
  if (!value || typeof value !== 'object') return false;
  const a = value as Article;
  const plain = (text: unknown, limit: number) => typeof text === 'string' && text.trim().length > 0 && text.length <= limit;
  return a.slug === slug && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug)
    && plain(a.title, 200) && plain(a.description, 1000) && plain(a.category, 100)
    && CATEGORIES.some(category => category.id === a.offerCategory)
    && Number.isInteger(a.readMinutes) && a.readMinutes > 0 && a.readMinutes <= 120
    && Number.isFinite(Date.parse(a.publishedAt)) && Number.isFinite(Date.parse(a.updatedAt))
    && Array.isArray(a.sourceIds) && a.sourceIds.length > 0 && a.sourceIds.length <= 12
    && a.sourceIds.every(id => SOURCES.some(source => source.id === id))
    && Array.isArray(a.sections) && a.sections.length > 0 && a.sections.length <= 20
    && a.sections.every(section => section && plain(section.heading, 200)
      && Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && section.paragraphs.length <= 20
      && section.paragraphs.every(paragraph => plain(paragraph, 4000))
      && (section.list === undefined || (Array.isArray(section.list) && section.list.length <= 30 && section.list.every(item => plain(item, 1000)))));
}

export function validateConversion(body: Record<string, unknown>, now = Date.now()): ConversionInput {
  const externalId = text(body.externalId, 'externalId', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(externalId)) throw new InputError('Invalid externalId; use an opaque ASP transaction identifier');
  const offerId = text(body.offerId, 'offerId', 80);
  if (!idPattern.test(offerId)) throw new InputError('Invalid offerId');
  const amount = body.commissionJpy;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) throw new InputError('commissionJpy must be a nonnegative integer of confirmed commission in JPY');
  const occurredAt = date(body.occurredAt, 'occurredAt', false)!;
  if (Date.parse(occurredAt) > now + 300_000) throw new InputError('occurredAt cannot be in the future');
  return { externalId, offerId, commissionJpy: amount, occurredAt };
}

async function saveConversion(request: Request, env: Env): Promise<Response> {
  const input = validateConversion(await jsonBody(request));
  const offer = await env.DB.prepare('SELECT id FROM offers WHERE id = ?').bind(input.offerId).first();
  if (!offer) return reply({ error: 'offer_not_found' }, 404);
  const result = await env.DB.prepare(`INSERT INTO conversions(external_id, offer_id, commission_jpy, occurred_at, received_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING`)
    .bind(input.externalId, input.offerId, input.commissionJpy, input.occurredAt, new Date().toISOString()).run();
  if (result.meta.changes === 0) {
    const existing = await env.DB.prepare('SELECT offer_id, commission_jpy, occurred_at FROM conversions WHERE external_id = ?')
      .bind(input.externalId).first<{ offer_id: string; commission_jpy: number; occurred_at: string }>();
    if (!existing || existing.offer_id !== input.offerId || existing.commission_jpy !== input.commissionJpy || existing.occurred_at !== input.occurredAt) {
      return reply({ error: 'idempotency_conflict', message: 'This externalId already records different conversion data.' }, 409);
    }
    return reply({ ok: true, created: false });
  }
  return reply({ ok: true, created: true }, 201);
}

export async function handleAdmin(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const webhook = path === '/api/conversions/webhook';
  if (!path.startsWith('/api/admin/') && !webhook) return null;
  const denied = await authorize(request, webhook ? env.CONVERSION_TOKEN : env.ADMIN_TOKEN);
  if (denied) return denied;
  try {
    if (webhook || path === '/api/admin/conversions') {
      if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
      return await saveConversion(request, env);
    }
    if (path === '/api/admin/offers') {
      if (request.method === 'GET') return reply({ offers: await listOffers(env) });
      if (request.method !== 'PUT') return reply({ error: 'method_not_allowed' }, 405);
      const offer = validateOffer(await jsonBody(request));
      await env.DB.prepare(`INSERT INTO offers(id, category, enabled, offer_json, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category, enabled=excluded.enabled, offer_json=excluded.offer_json, updated_at=excluded.updated_at`)
        .bind(offer.id, offer.category, Number(offer.enabled), JSON.stringify(offer), new Date().toISOString()).run();
      return reply({ ok: true, offer });
    }
    if (path === '/api/admin/articles') {
      if (request.method === 'PATCH') {
        const body = await jsonBody(request);
        if (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(body.slug)
          || typeof body.status !== 'string' || !['published', 'draft', 'rejected'].includes(body.status)) throw new InputError('Invalid article slug or status');
        const existing = await env.DB.prepare('SELECT article_json, origin, created_at FROM articles WHERE slug = ?').bind(body.slug).first<{ article_json: string; origin: string; created_at: string }>();
        const seed = ARTICLES.find(article => article.slug === body.slug);
        if (!existing && !seed) return reply({ error: 'article_not_found' }, 404);
        const articleJson = existing?.article_json ?? JSON.stringify(seed);
        if (body.status === 'published') {
          let article: unknown;
          try { article = JSON.parse(articleJson); } catch { return reply({ error: 'article_not_publishable', message: '記事データを読み取れないため公開できません。' }, 422); }
          if (!isPublishableArticle(article, body.slug)) return reply({ error: 'article_not_publishable', message: '記事本文または公式情報の参照先が不正なため公開できません。' }, 422);
        }
        const now = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO articles(slug, article_json, status, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`)
          .bind(body.slug, articleJson, body.status, existing?.origin ?? 'seed', existing?.created_at ?? now, now).run();
        return reply({ ok: true, slug: body.slug, status: body.status });
      }
      if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
      const rows = await env.DB.prepare('SELECT slug, status, origin, article_json, updated_at FROM articles ORDER BY updated_at DESC LIMIT 200').all();
      const stored = new Set(rows.results.map(row => row.slug));
      return reply({ sources: SOURCES, articles: [...rows.results.map(row => ({ slug: row.slug, status: row.status, origin: row.origin, updatedAt: row.updated_at, article: JSON.parse(String(row.article_json)) })), ...ARTICLES.filter(article => !stored.has(article.slug)).map(article => ({ slug: article.slug, status: 'published', origin: 'seed', updatedAt: article.updatedAt, article }))] });
    }
    if (path === '/api/admin/status') {
      if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
      const [events, conversions, offers, runs, sources] = await Promise.all([
        env.DB.prepare('SELECT kind, COALESCE(SUM(count), 0) AS total FROM events GROUP BY kind').all<{ kind: string; total: number }>(),
        env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(commission_jpy), 0) AS revenue FROM conversions').first<{ count: number; revenue: number }>(),
        listOffers(env),
        env.DB.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT 20').all(),
        env.DB.prepare('SELECT * FROM source_checks ORDER BY source_id').all(),
      ]);
      const eventCounts = Object.fromEntries(events.results.map(row => [row.kind, row.total]));
      return reply({ metrics: { diagnoses: eventCounts.diagnosis ?? 0, affiliateClicks: eventCounts.affiliate_click ?? 0, confirmedConversions: conversions?.count ?? 0, confirmedRevenueJpy: conversions?.revenue ?? 0 }, offers, runs: runs.results, sources: sources.results, automation: { enabled: env.ENABLE_AUTOPUBLISH === 'true', maxDailyArticles: Number(env.MAX_DAILY_ARTICLES ?? '1') }, revenueNote: 'Revenue includes only confirmed ASP commissions imported through the authenticated endpoint. Clicks are not revenue.' });
    }
    return reply({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof InputError) return reply({ error: 'invalid_request', message: error.message }, error.status);
    // Database and internal errors must not expose credentials or signed URLs.
    return reply({ error: 'storage_unavailable', message: '保存処理に失敗しました。データベースの設定を確認してください。' }, 503);
  }
}
