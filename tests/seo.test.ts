import {describe,it,expect} from 'vitest';
import {siteOrigin,sitemap,breadcrumbSchema} from '../src/seo';
import {layout,contactPage,policyPage,comparisonLanding} from '../src/views';
import {ARTICLES} from '../src/content';
import {COMPARISONS} from '../src/comparisons';
import type {Env} from '../src/types';
const env={SITE_URL:'https://shigoto-toolbox.jp',OPERATOR_NAME:'テスト運営者',CONTACT_EMAIL:'contact@shigoto-toolbox.jp',GOOGLE_SITE_VERIFICATION:'valid-verification-token'} as Env;
describe('public indexing and share metadata',()=>{
 it.each(['http://shigoto-toolbox.jp','https://localhost','https://127.0.0.1','https://tools.example.com','https://shigoto.test','https://shigoto-toolbox.jp/other','https://user:pass@shigoto-toolbox.jp','https://shigoto-toolbox.jp/?q=x'])('rejects an invalid deployment origin %s',url=>expect(siteOrigin({SITE_URL:url})).toBeNull());
 it('provides public canonical, share image, verification and structured data without inventing reviews',()=>{
  const html=layout('比較ページ','説明','<h1>比較</h1>','/compare/make-vs-zapier',env);
  expect(html).toContain('content="index,follow"');expect(html).toContain('https://shigoto-toolbox.jp/og-image.png');expect(html).toContain('name="google-site-verification" content="valid-verification-token"');expect(html).toContain('rel="canonical" href="https://shigoto-toolbox.jp/compare/make-vs-zapier"');expect(html).not.toContain('AggregateRating');
 });
 it('keeps local, filtered, missing and admin pages out of indexing',()=>{
  expect(layout('a','b','c','/',{} as Env)).toContain('content="noindex,follow"');
  expect(layout('a','b','c','/tools',env,undefined,{noindex:true})).toContain('content="noindex,follow"');
  expect(layout('a','b','c','/admin',env)).toContain('content="noindex,follow"');
 });
 it('sitemap includes comparison pages and article dates, only supplied published articles',()=>{
  const xml=sitemap(env,ARTICLES.slice(0,1));expect(xml).toContain('/compare/make-vs-zapier');expect(xml).toContain('/guides/'+ARTICLES[0].slug);expect(xml).not.toContain('/guides/'+ARTICLES[1].slug);expect(xml).toContain('<lastmod>2026-10-28</lastmod>');expect(xml).not.toContain('/admin');expect(sitemap({} as Env,ARTICLES)).not.toContain('<url>');
 });
 it('comparison has one h1, actual candidates and official references',()=>{
  const html=comparisonLanding(COMPARISONS[0],[]);expect(html.match(/<h1>/g)?.length).toBe(1);expect(html).toContain('Make');expect(html).toContain('Zapier');expect(html).toContain('よくある質問');expect(html).toContain('https://www.make.com/en');expect(html).not.toContain('data-offer=');
 });
 it('breadcrumb data uses the configured origin',()=>{
  expect(breadcrumbSchema(env,[{name:'比較',path:'/compare'}])).toMatchObject({itemListElement:[{item:'https://shigoto-toolbox.jp/compare',position:1}]});
 });
});
describe('real public contact details',()=>{
 it('renders configured public identity and contact and safely escapes the name',()=>{
  const local={...env,OPERATOR_NAME:'社名 & 編集'};expect(policyPage('about',local)).toContain('社名 &amp; 編集');expect(contactPage(local)).toContain('href="mailto:contact@shigoto-toolbox.jp"');
 });
 it('does not fabricate contact when unset or invalid',()=>{
  const html=contactPage({} as Env);expect(html).toContain('準備中');expect(html).not.toContain('mailto:');expect(html).not.toContain('example.com');
 });
});
