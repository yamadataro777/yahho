import {describe,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {ARTICLES} from '../src/content';
import type {Env} from '../src/types';

const origin='https://shigoto-toolbox.jp';
function statement(){
 return {bind(){return this;},async first(){return null;},async all(){return{results:[],success:true};},async run(){return{success:true,meta:{changes:0}};}};
}
function environment():Env{return{
 SITE_URL:origin,OPERATOR_NAME:'テスト運営者',CONTACT_EMAIL:'contact@shigoto-toolbox.jp',
 DB:{prepare:()=>statement()},ASSETS:{fetch:vi.fn(async()=>new Response('body{}',{headers:{'content-type':'text/css'}}))},
} as unknown as Env;}
const ctx={waitUntil:vi.fn(),passThroughOnException:vi.fn()} as unknown as ExecutionContext;
const fetchPage=(path:string,method='GET',env=environment())=>worker.fetch(new Request(origin+path,{method}),env,ctx);

describe('organic landing route behavior',()=>{
 it('permanently consolidates public trailing slashes without rewriting campaign query values',async()=>{
  const response=await fetchPage('/compare/make-vs-zapier///?campaign=search-test&keep=a%2Bb%2Fc');
  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe(origin+'/compare/make-vs-zapier?campaign=search-test&keep=a%2Bb%2Fc');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const head=await fetchPage('/guides/'+ARTICLES[0].slug+'/','HEAD');
  expect(head.status).toBe(308);expect(await head.text()).toBe('');
 });
 it('keeps filtered pages noindex with a clean canonical, while the main listing remains indexable',async()=>{
  const filtered=await fetchPage('/tools?category=meeting');const html=await filtered.text();
  expect(filtered.status).toBe(200);expect(html).toContain('content="noindex,follow"');
  expect(html).toContain('rel="canonical" href="'+origin+'/tools"');
  expect(await (await fetchPage('/tools')).text()).toContain('content="index,follow"');
 });
 it('does not redirect missing content, administration, static assets, or API writes',async()=>{
  const missing=await fetchPage('/guides/not-a-real-guide/');
  expect(missing.status).toBe(404);expect(missing.headers.get('location')).toBeNull();
  expect(await missing.text()).toContain('content="noindex,follow"');
  const admin=await fetchPage('/admin/');expect(admin.status).toBe(200);expect(admin.headers.get('x-robots-tag')).toBe('noindex');
  const css=await fetchPage('/style.css');expect(css.status).toBe(200);expect(css.headers.get('location')).toBeNull();
  const api=await fetchPage('/api/recommend/','POST');expect(api.status).toBe(400);expect(api.headers.get('location')).toBeNull();
 });
 it('serves a crawlable editorial policy and links article author and breadcrumb metadata to public pages',async()=>{
  const policy=await fetchPage('/editorial-policy');expect(policy.status).toBe(200);
  const text=await policy.text();expect(text).toContain('content="index,follow"');expect(text).toContain(origin+'/editorial-policy');
  const guide=await fetchPage('/guides/'+ARTICLES[0].slug);const html=await guide.text();
  const match=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);expect(match).not.toBeNull();
  const data=JSON.parse(match![1]);
  expect(data.find((x:any)=>x['@type']==='Article').author.url).toBe(origin+'/editorial-policy');
  expect(data.find((x:any)=>x['@type']==='BreadcrumbList').itemListElement.map((x:any)=>x.item)).toEqual([origin+'/',origin+'/guides',origin+'/guides/'+ARTICLES[0].slug]);
 });
 it('publishes matching robots and sitemap URLs and excludes the unconfigured contact page',async()=>{
  const env=environment();delete env.CONTACT_EMAIL;
  expect(await (await fetchPage('/robots.txt','GET',env)).text()).toContain('Sitemap: '+origin+'/sitemap.xml');
  const sitemap=await fetchPage('/sitemap.xml','GET',env);const xml=await sitemap.text();
  expect(sitemap.status).toBe(200);expect(xml).toContain(origin+'/editorial-policy</loc>');expect(xml).not.toContain(origin+'/contact</loc>');
  expect(await (await fetchPage('/contact','GET',env)).text()).toContain('content="noindex,follow"');
 });
 it('removes withdrawn seed guides from homepage, related reading, comparison guidance, and the sitemap',async()=>{
  const withdrawn=['meeting-notes-template','canva-adobe-express'];
  const rows=withdrawn.map(slug=>({slug,status:'draft',article_json:'{}'}));
  const env=environment();
  env.DB={prepare:(query:string)=>{
   let values:unknown[]=[];
   return{bind(...args:unknown[]){values=args;return this;},async first(){return query.includes('FROM articles')?rows.find(row=>row.slug===values[0])??null:null;},async all(){return{results:query.includes('FROM articles')?rows:[],success:true};}};
  }} as unknown as D1Database;
  for(const path of ['/','/guides/meeting-notes-checklist','/compare/canva-vs-adobe-express']){
   const response=await fetchPage(path,'GET',env);expect(response.status).toBe(200);
   const html=await response.text();
   for(const slug of withdrawn)expect(html).not.toContain('href="/guides/'+slug+'"');
  }
  const xml=await (await fetchPage('/sitemap.xml','GET',env)).text();
  for(const slug of withdrawn){
   expect(xml).not.toContain('/guides/'+slug+'</loc>');
   expect((await fetchPage('/guides/'+slug,'GET',env)).status).toBe(404);
  }
  // Unrelated published guides remain discoverable after withdrawal.
  expect(xml).toContain('/guides/meeting-notes-checklist</loc>');
 });
});
