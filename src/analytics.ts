import { CATEGORIES, TOOLS } from './content';
import { COMPARISONS } from './comparisons';
import { getArticle, isUsableOffer, listOffers } from './store';
import type { Env, Offer } from './types';

const DAY = 86_400_000;
const VISIT_MS = 30 * 60_000;
export const ATTRIBUTION_DAYS = 30;
export const ANALYTICS_RETENTION_DAYS = 90;
export const TRAFFIC_SOURCES = ['direct', 'search', 'threads', 'social', 'referral', 'email', 'other'] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class AnalyticsInputError extends Error { constructor(message: string, public status = 400) { super(message); } }

interface Visit { id: string; started_at: string; expires_at: string; source: string; campaign_id: string; landing_path: string }
interface Event { id: string; visit_id: string; kind: string; page_path: string; category: string; offer_id: string; tracked_click: number; created_at: string }

/** Returns a validated public pathname and its editorial category. Never stores query text. */
export async function publicPage(env: Env, path: unknown): Promise<{ path: string; category: string } | null> {
  if (typeof path !== 'string' || path.length > 160 || !/^\/(?:[a-z0-9_-]+(?:\/[a-z0-9_-]+)*)?$/.test(path)) return null;
  if (['/', '/tools', '/compare', '/guides', '/diagnosis', '/about', '/contact', '/disclosure', '/privacy'].includes(path)) return { path, category: '' };
  if (path.startsWith('/tools/')) { const tool = TOOLS.find(t => path === '/tools/' + t.id); return tool ? { path, category: tool.category } : null; }
  if (path.startsWith('/compare/')) { const comparison = COMPARISONS.find(c => path === '/compare/' + c.slug); return comparison ? { path, category: TOOLS.find(t => t.id === comparison.toolIds[0])?.category ?? '' } : null; }
  if (path.startsWith('/guides/')) { const article = await getArticle(env, path.slice(8)); return article ? { path, category: article.offerCategory } : null; }
  return null;
}

export function validateClickTracking(value: unknown, url: string): Offer['clickTracking'] {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid clickTracking');
  const { parameter, approved } = value as Record<string, unknown>;
  if (approved !== true || typeof parameter !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(parameter)
    || /^(?:url|redirect|redirect_uri|redirect_url|target|destination|callback|token|signature|sig|key)$/i.test(parameter)) throw new Error('ASP permission and a valid click parameter are required');
  const parsed = new URL(url);
  if (parsed.hash || [...parsed.searchParams.keys()].some(key => key.toLowerCase() === parameter.toLowerCase())) throw new Error('Click parameter collides with the issued URL');
  return { parameter, approved: true };
}

export function clickDestination(offer: Offer, clickId: string): string {
  if (!offer.clickTracking) return offer.url;
  if (!UUID.test(clickId)) throw new Error('Invalid click identifier');
  const config = validateClickTracking(offer.clickTracking, offer.url)!;
  // Preserve the original signed/encoded bytes. Only operator-approved sub-ID parameters are appended.
  return offer.url + (offer.url.includes('?') ? (/[?&]$/.test(offer.url) ? '' : '&') : '?') + config.parameter + '=' + clickId;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AnalyticsInputError('json_required', 415);
  if (!request.body) throw new AnalyticsInputError('body_required');
  const reader = request.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new AnalyticsInputError('body_too_large', 413); } chunks.push(part.value); }
  const combined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  let result: unknown; try { result = JSON.parse(new TextDecoder().decode(combined)); } catch { throw new AnalyticsInputError('invalid_json'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new AnalyticsInputError('invalid_body');
  return result as Record<string, unknown>;
}

/** Public, same-origin telemetry. Client data is observational, never proof of a human or a purchase. */
export async function handleAnalytics(request: Request, env: Env, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  if (!['/api/analytics/visit', '/api/analytics/event'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (request.headers.get('origin') !== url.origin) return reply({ error: 'same_origin_required' }, 403);
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1' || /bot|crawler|spider|preview/i.test(request.headers.get('user-agent') ?? '')) return reply({ ok: true, ignored: true }, 202);
  try {
    const input = await body(request);
    const page = await publicPage(env, input.path);
    if (!page) throw new AnalyticsInputError('invalid_public_path');
    if (url.pathname.endsWith('/visit')) {
      if (input.visitId !== undefined && (typeof input.visitId !== 'string' || !UUID.test(input.visitId))) throw new AnalyticsInputError('invalid_visit_id');
      if (input.campaign !== undefined && (typeof input.campaign !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.campaign))) throw new AnalyticsInputError('invalid_campaign');
      const campaign = input.campaign ? await env.DB.prepare("SELECT id, source, target_path, status FROM growth_campaigns WHERE id = ?").bind(input.campaign).first<{ id: string; source: string; target_path: string; status: string }>() : null;
      if (input.campaign && (!campaign || campaign.status !== 'active' || campaign.target_path !== page.path)) throw new AnalyticsInputError('campaign_not_active_or_target_mismatch');
      if (input.source !== undefined && !TRAFFIC_SOURCES.includes(input.source as any)) throw new AnalyticsInputError('invalid_source');
      if (input.visitId) {
        const existing = await env.DB.prepare('SELECT * FROM growth_visits WHERE id = ?').bind(input.visitId).first<Visit>();
        if (existing && Date.parse(existing.expires_at) > now.getTime() && Date.parse(existing.started_at) <= now.getTime()
          && (!campaign || campaign.id === existing.campaign_id)) return reply({ visitId: existing.id, expiresAt: existing.expires_at });
      }
      const id = crypto.randomUUID(); const expiresAt = new Date(now.getTime() + VISIT_MS).toISOString();
      await env.DB.prepare('INSERT INTO growth_visits(id, started_at, expires_at, source, campaign_id, landing_path) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, now.toISOString(), expiresAt, campaign?.source ?? input.source ?? 'direct', campaign?.id ?? '', page.path).run();
      return reply({ visitId: id, expiresAt }, 201);
    }
    if (typeof input.visitId !== 'string' || !UUID.test(input.visitId) || typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new AnalyticsInputError('invalid_identifier');
    if (!['page_view', 'diagnosis', 'affiliate_click'].includes(String(input.kind))) throw new AnalyticsInputError('invalid_kind');
    const visit = await env.DB.prepare('SELECT * FROM growth_visits WHERE id = ?').bind(input.visitId).first<Visit>();
    if (!visit || Date.parse(visit.expires_at) <= now.getTime() || Date.parse(visit.started_at) > now.getTime()) throw new AnalyticsInputError('visit_expired', 410);
    let offer: Offer | undefined; let category = page.category;
    if (input.attributionRequested !== undefined && typeof input.attributionRequested !== 'boolean') throw new AnalyticsInputError('invalid_attribution_flag');
    if (input.kind === 'affiliate_click') {
      if (typeof input.offerId !== 'string') throw new AnalyticsInputError('offer_required');
      offer = (await listOffers(env)).find(o => o.id === input.offerId && isUsableOffer(o, now.getTime()));
      if (!offer) throw new AnalyticsInputError('offer_not_active');
      if (offer.clickTracking) { try { validateClickTracking(offer.clickTracking, offer.url); } catch { throw new AnalyticsInputError('invalid_click_configuration'); } }
    } else if (input.offerId !== undefined) throw new AnalyticsInputError('unexpected_offer');
    if (input.kind === 'diagnosis') {
      if (page.path !== '/diagnosis' || !CATEGORIES.some(c => c.id === input.category)) throw new AnalyticsInputError('invalid_diagnosis');
      category = String(input.category);
    } else if (input.category !== undefined) throw new AnalyticsInputError('unexpected_category');
    const tracked = Boolean(offer?.clickTracking && input.attributionRequested === true);
    const old = await env.DB.prepare('SELECT * FROM growth_events WHERE id = ?').bind(input.eventId).first<Event>();
    if (old && (old.visit_id !== visit.id || old.kind !== input.kind || old.page_path !== page.path || old.offer_id !== (offer?.id ?? '') || old.category !== category || old.tracked_click !== Number(tracked))) throw new AnalyticsInputError('event_id_conflict', 409);
    if (!old) {
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM growth_events WHERE visit_id = ?').bind(visit.id).first<{ n: number }>();
      if ((count?.n ?? 0) >= 200) throw new AnalyticsInputError('visit_event_limit', 429);
      await env.DB.prepare('INSERT INTO growth_events(id, visit_id, kind, page_path, category, offer_id, tracked_click, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(input.eventId, visit.id, input.kind, page.path, category, offer?.id ?? '', Number(tracked), now.toISOString()).run();
      // A racing duplicate must match the same visit and dimensions too.
      const stored = await env.DB.prepare('SELECT * FROM growth_events WHERE id = ?').bind(input.eventId).first<Event>();
      if (!stored || stored.visit_id !== visit.id || stored.kind !== input.kind || stored.page_path !== page.path || stored.offer_id !== (offer?.id ?? '') || stored.category !== category || stored.tracked_click !== Number(tracked)) throw new AnalyticsInputError('event_id_conflict', 409);
    }
    return reply({ ok: true, ...(offer ? { clickId: input.eventId, url: tracked ? clickDestination(offer, input.eventId) : offer.url, attributable: tracked } : {}) });
  } catch (error) {
    if (error instanceof AnalyticsInputError) return reply({ error: error.message }, error.status);
    return reply({ error: 'analytics_unavailable' }, 503);
  }
}

export interface AnalyticsRow {
  pagePath: string; category: string; source: string; campaignId: string;
  visits: number; pageViews: number; diagnoses: number; clicks: number; attributableClicks: number;
  matureClicks: number; matureAttributableClicks: number; matureAttributableVisits: number; convertedClicks: number; convertedVisits: number; confirmedRevenueJpy: number;
  ctr: number | null; conversionRate: number | null;
}
export interface AnalyticsReport {
  window: { start: string; end: string; matureBefore: string };
  totals: { visits: number; pageViews: number; diagnoses: number; clicks: number; confirmedConversions: number; confirmedRevenueJpy: number; unattributedConversions: number };
  rows: AnalyticsRow[];
  campaignRows: AnalyticsRow[];
  recentConversions: { externalId: string; offerId: string; commissionJpy: number; occurredAt: string; status: string; clickId: string | null; pagePath: string; source: string; campaignId: string }[];
}

export async function analyticsReport(env: Env, now = new Date(), startAt?: Date): Promise<AnalyticsReport> {
  if (startAt && (!Number.isFinite(startAt.getTime()) || startAt.getTime() > now.getTime() || startAt.getTime() < now.getTime() - 90 * DAY)) throw new Error('invalid_analytics_window');
  const end = now.toISOString(), start = (startAt ?? new Date(now.getTime() - 30 * DAY)).toISOString(), matureBefore = new Date(now.getTime() - 7 * DAY).toISOString();
  // Aggregate before joining conversion values so repeat purchases cannot multiply visits or clicks.
  async function grouped(byPage: boolean): Promise<AnalyticsRow[]> {
    const groups = `v.source, v.campaign_id${byPage ? ', e.page_path' : ''}`;
    const result = await env.DB.prepare(`SELECT ${byPage ? 'e.page_path' : "''"} AS pagePath, ${byPage ? 'MAX(e.category)' : "''"} AS category, v.source, v.campaign_id AS campaignId,
      COUNT(DISTINCT e.visit_id) AS visits, SUM(e.kind='page_view') AS pageViews, SUM(e.kind='diagnosis') AS diagnoses,
      SUM(e.kind='affiliate_click') AS clicks, SUM(e.kind='affiliate_click' AND e.tracked_click=1) AS attributableClicks,
      SUM(e.kind='affiliate_click' AND e.created_at<=?) AS matureClicks,
      SUM(e.kind='affiliate_click' AND e.tracked_click=1 AND e.created_at<=?) AS matureAttributableClicks,
      COUNT(DISTINCT CASE WHEN e.kind='affiliate_click' AND e.tracked_click=1 AND e.created_at<=? THEN e.visit_id END) AS matureAttributableVisits,
      SUM(CASE WHEN e.kind='affiliate_click' AND e.tracked_click=1 AND e.created_at<=? AND EXISTS(SELECT 1 FROM conversions c WHERE c.click_id=e.id AND c.status='confirmed' AND c.occurred_at<=?) THEN 1 ELSE 0 END) AS convertedClicks,
      COUNT(DISTINCT CASE WHEN e.kind='affiliate_click' AND e.tracked_click=1 AND e.created_at<=? AND EXISTS(SELECT 1 FROM conversions c WHERE c.click_id=e.id AND c.status='confirmed' AND c.occurred_at<=?) THEN e.visit_id END) AS convertedVisits,
      SUM(CASE WHEN e.kind='affiliate_click' THEN COALESCE((SELECT SUM(c.commission_jpy) FROM conversions c WHERE c.click_id=e.id AND c.status='confirmed' AND c.occurred_at<=?),0) ELSE 0 END) AS confirmedRevenueJpy
      FROM growth_events e JOIN growth_visits v ON v.id=e.visit_id WHERE e.created_at>=? AND e.created_at<=? GROUP BY ${groups} ORDER BY visits DESC, campaignId, pagePath LIMIT 500`)
      .bind(matureBefore, matureBefore, matureBefore, matureBefore, end, matureBefore, end, end, start, end).all<Omit<AnalyticsRow, 'ctr' | 'conversionRate'>>();
    return result.results.map(row => ({ ...row, ctr: row.pageViews > 0 ? row.clicks / row.pageViews : null, conversionRate: row.matureAttributableClicks > 0 ? row.convertedClicks / row.matureAttributableClicks : null }));
  }
  const [rows, campaignRows, events, visits, conversions, recent] = await Promise.all([
    grouped(true), grouped(false),
    env.DB.prepare("SELECT SUM(kind='page_view') AS pageViews, SUM(kind='diagnosis') AS diagnoses, SUM(kind='affiliate_click') AS clicks FROM growth_events WHERE created_at>=? AND created_at<=?").bind(start, end).first<{ pageViews: number; diagnoses: number; clicks: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM growth_visits WHERE started_at>=? AND started_at<=?').bind(start, end).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(commission_jpy),0) AS revenue, COALESCE(SUM(click_id IS NULL),0) AS unattributed FROM conversions WHERE status='confirmed' AND occurred_at>=? AND occurred_at<=?").bind(start, end).first<{ n: number; revenue: number; unattributed: number }>(),
    env.DB.prepare('SELECT external_id AS externalId, offer_id AS offerId, commission_jpy AS commissionJpy, occurred_at AS occurredAt, status, click_id AS clickId, attributed_page_path AS pagePath, attributed_source AS source, attributed_campaign_id AS campaignId FROM conversions ORDER BY occurred_at DESC, external_id DESC LIMIT 50').all<AnalyticsReport['recentConversions'][number]>(),
  ]);
  return { window: { start, end, matureBefore }, totals: { visits: visits?.n ?? 0, pageViews: events?.pageViews ?? 0, diagnoses: events?.diagnoses ?? 0, clicks: events?.clicks ?? 0, confirmedConversions: conversions?.n ?? 0, confirmedRevenueJpy: conversions?.revenue ?? 0, unattributedConversions: conversions?.unattributed ?? 0 }, rows, campaignRows, recentConversions: recent.results };
}

export async function purgeAnalytics(env: Env, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * DAY).toISOString();
  await env.DB.prepare('DELETE FROM growth_events WHERE created_at < ?').bind(cutoff).run();
  await env.DB.prepare('DELETE FROM growth_visits WHERE started_at < ?').bind(cutoff).run();
}
