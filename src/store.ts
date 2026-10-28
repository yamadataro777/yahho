import { ARTICLES } from './content';
import type { Article, Env, Offer, TrackingEvent } from './types';

interface ArticleRow { slug: string; article_json: string; status: string }

export async function listArticles(env: Env): Promise<Article[]> {
  const rows = await env.DB.prepare('SELECT slug, article_json, status FROM articles').all<ArticleRow>();
  const articles = new Map(ARTICLES.map(article => [article.slug, article]));
  for (const row of rows.results) {
    if (row.status === 'published') articles.set(row.slug, JSON.parse(row.article_json) as Article);
    // A deliberately withheld/rejected update must not expose an older seed with that slug.
    else articles.delete(row.slug);
  }
  return [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getArticle(env: Env, slug: string): Promise<Article | null> {
  const row = await env.DB.prepare('SELECT slug, article_json, status FROM articles WHERE slug = ?').bind(slug).first<ArticleRow>();
  if (row) return row.status === 'published' ? JSON.parse(row.article_json) as Article : null;
  return ARTICLES.find(article => article.slug === slug) ?? null;
}

export async function listOffers(env: Env): Promise<Offer[]> {
  const rows = await env.DB.prepare('SELECT offer_json FROM offers ORDER BY id').all<{ offer_json: string }>();
  return rows.results.map(row => JSON.parse(row.offer_json) as Offer);
}

export async function recordEvent(env: Env, event: TrackingEvent): Promise<void> {
  if (!['diagnosis', 'affiliate_click'].includes(event.kind)) throw new Error('Invalid event kind');
  const fields = [event.articleSlug ?? '', event.offerId ?? '', event.variant ?? ''];
  if (fields.some(value => !/^[a-zA-Z0-9_-]{0,100}$/.test(value))) throw new Error('Invalid event dimensions');
  await env.DB.prepare(`INSERT INTO events(day, kind, article_slug, offer_id, variant, count)
    VALUES(?, ?, ?, ?, ?, 1)
    ON CONFLICT(day, kind, article_slug, offer_id, variant) DO UPDATE SET count = count + 1`)
    .bind(new Date().toISOString().slice(0, 10), event.kind, ...fields).run();
}

/** Only public DNS hostnames are accepted. No IP, private host, wildcard, credentials, or port. */
export function isPublicHostname(host: string): boolean {
  return host.length <= 253 && host.includes('.')
    && /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    && host.split('.').every(part => part.length > 0 && part.length <= 63 && !part.startsWith('-') && !part.endsWith('-'))
    && !/^[\d.]+$/.test(host)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)
    && !/(?:^|\.)example\.(?:com|net|org)$/.test(host);
}

export function isAllowedOfferUrl(url: string, allowedHosts: string[]): boolean {
  // ASP links must already be URL-encoded. URL() normalizes raw whitespace,
  // whereas Location headers reject controls and non-ByteString characters.
  // Reject instead of rewriting a potentially signed link.
  if (!/^[\x21-\x7e]+$/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
      && isPublicHostname(parsed.hostname)
      && allowedHosts.length > 0 && allowedHosts.every(isPublicHostname)
      && allowedHosts.includes(parsed.hostname);
  } catch { return false; }
}

export function isUsableOffer(offer: Offer, now = Date.now()): boolean {
  const verified = offer.verifiedAt ? Date.parse(offer.verifiedAt) : NaN;
  const expires = offer.expiresAt ? Date.parse(offer.expiresAt) : Infinity;
  return offer.enabled && isAllowedOfferUrl(offer.url, offer.allowedHosts)
    && Number.isFinite(verified) && verified <= now && expires > now;
}
