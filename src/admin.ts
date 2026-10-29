import { ARTICLES, CATEGORIES, SOURCES } from './content';
import { isAllowedOfferUrl, listOffers } from './store';
import type { Article, Env, Offer } from './types';
import { analyticsReport, ATTRIBUTION_DAYS, UUID, validateClickTracking } from './analytics';

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
  // Keep the original issued URL byte-for-byte; optional sub-ID use requires explicit ASP permission.
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
  let clickTracking: Offer['clickTracking'];
  try { clickTracking = validateClickTracking(body.clickTracking, url); } catch (error) { throw new InputError(error instanceof Error ? error.message : 'Invalid clickTracking'); }
  return { id, name, category, description, url, allowedHosts, enabled: body.enabled, verifiedAt, expiresAt, ...(clickTracking ? { clickTracking } : {}) };
}

export interface ConversionInput { externalId: string; offerId: string; commissionJpy: number; occurredAt: string; clickId?: string }

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
  const clickId = body.clickId;
  if (clickId !== undefined && (typeof clickId !== 'string' || !UUID.test(clickId))) throw new InputError('Invalid clickId; use the opaque identifier returned by the ASP');
  return { externalId, offerId, commissionJpy: amount, occurredAt, ...(clickId ? { clickId: clickId as string } : {}) };
}

async function saveConversion(request: Request, env: Env): Promise<Response> {
  const input = validateConversion(await jsonBody(request));
  type SavedConversion = { offer_id: string; commission_jpy: number; occurred_at: string; click_id: string | null };
  const same = (row: SavedConversion | null) => row && row.offer_id === input.offerId && row.commission_jpy === input.commissionJpy && row.occurred_at === input.occurredAt && row.click_id === (input.clickId ?? null);
  const existing = await env.DB.prepare('SELECT offer_id, commission_jpy, occurred_at, click_id FROM conversions WHERE external_id = ?').bind(input.externalId).first<SavedConversion>();
  if (existing) return same(existing) ? reply({ ok: true, created: false }) : reply({ error: 'idempotency_conflict', message: 'This externalId already records different conversion data.' }, 409);
  const offer = await env.DB.prepare('SELECT id FROM offers WHERE id = ?').bind(input.offerId).first();
  if (!offer) return reply({ error: 'offer_not_found' }, 404);
  type Attribution = { source: string; campaign_id: string; landing_path: string; page_path: string; created_at: string; offer_id: string; tracked_click: number };
  let attribution: Attribution | null = null;
  if (input.clickId) {
    attribution = await env.DB.prepare(`SELECT v.source, v.campaign_id, v.landing_path, e.page_path, e.created_at, e.offer_id, e.tracked_click
      FROM growth_events e JOIN growth_visits v ON v.id=e.visit_id WHERE e.id=? AND e.kind='affiliate_click'`)
      .bind(input.clickId).first<Attribution>();
    const delta = attribution ? Date.parse(input.occurredAt) - Date.parse(attribution.created_at) : -1;
    if (!attribution || attribution.offer_id !== input.offerId || attribution.tracked_click !== 1 || delta < 0 || delta > ATTRIBUTION_DAYS * 86_400_000) {
      return reply({ error: 'invalid_click_attribution', message: 'The click must belong to this offer, support ASP sub-ID attribution, and precede conversion by at most 30 days.' }, 422);
    }
  }
  const result = await env.DB.prepare(`INSERT INTO conversions(external_id, offer_id, commission_jpy, occurred_at, received_at, click_id, attributed_source, attributed_campaign_id, attributed_landing_path, attributed_page_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING`)
    .bind(input.externalId, input.offerId, input.commissionJpy, input.occurredAt, new Date().toISOString(), input.clickId ?? null, attribution?.source ?? '', attribution?.campaign_id ?? '', attribution?.landing_path ?? '', attribution?.page_path ?? '').run();
  if (!result.meta.changes) {
    const stored = await env.DB.prepare('SELECT offer_id, commission_jpy, occurred_at, click_id FROM conversions WHERE external_id = ?').bind(input.externalId).first<SavedConversion>();
    if (!same(stored)) return reply({ error: 'idempotency_conflict', message: 'This externalId already records different conversion data.' }, 409);
    return reply({ ok: true, created: false });
  }
  return reply({ ok: true, created: true }, 201);
}

async function reverseConversion(request: Request, env: Env): Promise<Response> {
  const input = await jsonBody(request); const externalId = text(input.externalId, 'externalId', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(externalId)) throw new InputError('Invalid externalId');
  const existing = await env.DB.prepare('SELECT status FROM conversions WHERE external_id=?').bind(externalId).first<{ status: string }>();
  if (!existing) return reply({ error: 'conversion_not_found' }, 404);
  await env.DB.prepare("UPDATE conversions SET status='reversed', reversed_at=? WHERE external_id=? AND status='confirmed'").bind(new Date().toISOString(), externalId).run();
  return reply({ ok: true, status: 'reversed', alreadyReversed: existing.status === 'reversed' });
}

export async function handleAdmin(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const webhook = path === '/api/conversions/webhook';
  if (!path.startsWith('/api/admin/') && !webhook) return null;
  const denied = await authorize(request, webhook ? env.CONVERSION_TOKEN : env.ADMIN_TOKEN);
  if (denied) return denied;
  try {
    if (path === '/api/admin/analytics') {
      if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
      return reply(await analyticsReport(env));
    }
    if (path === '/api/admin/conversions/reverse') {
      if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
      return await reverseConversion(request, env);
    }
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
      const [events, conversions, offers, runs, sources, detailedClicks] = await Promise.all([
        env.DB.prepare('SELECT kind, COALESCE(SUM(count), 0) AS total FROM events GROUP BY kind').all<{ kind: string; total: number }>(),
        env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(commission_jpy), 0) AS revenue FROM conversions WHERE status = 'confirmed'").first<{ count: number; revenue: number }>(),
        listOffers(env),
        env.DB.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT 20').all(),
        env.DB.prepare('SELECT * FROM source_checks ORDER BY source_id').all(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM growth_events WHERE kind='affiliate_click'").first<{ n: number }>(),
      ]);
      const eventCounts = Object.fromEntries(events.results.map(row => [row.kind, row.total]));
      return reply({ metrics: { diagnoses: eventCounts.diagnosis ?? 0, affiliateClicks: (eventCounts.affiliate_click ?? 0) + (detailedClicks?.n ?? 0), confirmedConversions: conversions?.count ?? 0, confirmedRevenueJpy: conversions?.revenue ?? 0 }, offers, runs: runs.results, sources: sources.results, automation: { enabled: env.ENABLE_AUTOPUBLISH === 'true', maxDailyArticles: Number(env.MAX_DAILY_ARTICLES ?? '1') }, revenueNote: 'Revenue includes only confirmed ASP commissions imported through the authenticated endpoint. Clicks are not revenue.' });
    }
    return reply({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof InputError) return reply({ error: 'invalid_request', message: error.message }, error.status);
    // Database and internal errors must not expose credentials or signed URLs.
    return reply({ error: 'storage_unavailable', message: '保存処理に失敗しました。データベースの設定を確認してください。' }, 503);
  }
}
