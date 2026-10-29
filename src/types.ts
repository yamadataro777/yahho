export type OfferCategory = string;
export interface Source { id: string; label: string; url: string }
export interface ArticleSection { heading: string; paragraphs: string[]; list?: string[] }
export interface Article {
  slug: string; title: string; description: string; category: string;
  readMinutes: number; publishedAt: string; updatedAt: string;
  sections: ArticleSection[]; sourceIds: string[]; offerCategory: OfferCategory;
}
export interface Offer {
  id: string; name: string; category: OfferCategory; description: string;
  url: string; enabled: boolean; allowedHosts: string[];
  verifiedAt: string | null; expiresAt: string | null;
  clickTracking?: { parameter: string; approved: true };
}
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  ADMIN_TOKEN?: string;
  CONVERSION_TOKEN?: string;
  SITE_URL?: string;
  SITE_NAME?: string;
  OPERATOR_NAME?: string;
  CONTACT_EMAIL?: string;
  PUBLIC_CONTACT_URL?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  ENABLE_AUTOPUBLISH?: string;
  MAX_DAILY_ARTICLES?: string;
}
export interface TrackingEvent {
  kind: 'diagnosis' | 'affiliate_click';
  articleSlug?: string; offerId?: string; variant?: string;
}
