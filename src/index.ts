import type { Env } from './types';
import { CATEGORIES, TOOLS } from './content';
import { listArticles, getArticle, listOffers, recordEvent, isUsableOffer } from './store';
import { handleAdmin, tokenMatches } from './admin';
import { adminPage } from './admin-view';
import { runAutomation } from './automation';
import { parseRecommendationInput, recommendTools } from './recommend';
import * as view from './views';
import { escapeHtml as e } from './html';
import { COMPARISONS } from './comparisons';
import { siteOrigin, sitemap, breadcrumbSchema, articleSchema } from './seo';
import { operatorProfile } from './site-config';
import { handleAnalytics } from './analytics';
import { handleGrowth } from './growth';

const json = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function readJson(request: Request): Promise<unknown> {
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON形式で送信してください。');
 if(!request.body) throw new Error('入力がありません。');
 const reader=request.body.getReader(); let bytes=0; const chunks:Uint8Array[]=[];
 while(true) { const {done,value}=await reader.read(); if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();throw new Error('入力が長すぎます。');}chunks.push(value); }
 const all=new Uint8Array(bytes);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.byteLength;}
 return JSON.parse(new TextDecoder().decode(all));
}
function secure(response: Response, path: string): Response {
 const headers=new Headers(response.headers);
 headers.set('x-content-type-options','nosniff'); headers.set('referrer-policy','strict-origin-when-cross-origin'); headers.set('x-frame-options','DENY');
 headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
 headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
 if(path.startsWith('/admin')||path.startsWith('/api/')){headers.set('cache-control','no-store');headers.set('x-robots-tag','noindex');}
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function route(request: Request,env: Env,ctx: ExecutionContext):Promise<Response>{
 const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'')||'/';
 if(request.method!=='GET'&&request.method!=='HEAD'){
  const origin=request.headers.get('origin');if(origin && origin!==url.origin)return json({error:'別のサイトからの操作は受け付けていません。'},403);
 }
 if(path==='/api/admin/run'){
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32)return json({error:'not_configured'},503);
  const token=/^Bearer ([^\s]{1,512})$/.exec(request.headers.get('authorization')??'')?.[1]??'';
  if(!(await tokenMatches(token,env.ADMIN_TOKEN)))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  // Background execution respects the same persisted daily lock as Cron.
  ctx.waitUntil(runAutomation(env).catch(()=>console.error('automation_run_failed')));
  return json({ok:true,message:'実行を受け付けました。同日の実行済みジョブは重複処理しません。しばらくして状態を更新してください。'},202);
 }
 const growth=await handleGrowth(request,env);if(growth)return growth;
 const analytics=await handleAnalytics(request,env);if(analytics)return analytics;
 const admin=await handleAdmin(request,env);if(admin)return admin;
 if(path==='/api/recommend'){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  let input;try{input=parseRecommendationInput(await readJson(request));}catch{return json({error:'用途・予算・使う人数を正しく選んでください。'},400);}
  const recommendations=recommendTools(input);
  if(request.headers.get('dnt')!=='1'&&request.headers.get('sec-gpc')!=='1'&&request.headers.get('x-analytics-opt-out')!=='1'&&!/bot|crawler|spider|preview/i.test(request.headers.get('user-agent')??''))await recordEvent(env,{kind:'diagnosis',variant:input.useCase});
  return json({recommendations});
 }
 if(path==='/api/events'){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  try{
   const body=await readJson(request) as Record<string,unknown>;
   if(body?.kind!=='affiliate_click'||typeof body.offerId!=='string')return json({error:'invalid_event'},400);
   const offer=(await listOffers(env)).find(o=>o.id===body.offerId&&isUsableOffer(o));
   if(!offer)return json({error:'offer_not_active'},400);
   if(body.articleSlug!==undefined&&(typeof body.articleSlug!=='string'||!(await getArticle(env,body.articleSlug))))return json({error:'invalid_article'},400);
   if(request.headers.get('dnt')!=='1'&&request.headers.get('sec-gpc')!=='1'&&request.headers.get('x-analytics-opt-out')!=='1'&&!/bot|crawler|spider|preview/i.test(request.headers.get('user-agent')??''))await recordEvent(env,{kind:'affiliate_click',offerId:offer.id,articleSlug:body.articleSlug as string|undefined});
   return json({ok:true});
  }catch{return json({error:'invalid_event'},400);}
 }
 if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
 if(['/style.css','/app.js','/analytics.js','/admin.js','/growth-admin.js','/favicon.svg','/og-image.png'].includes(path))return env.ASSETS.fetch(request);
 if(path==='/api/health'){
  await env.DB.prepare('SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM offers) AS offers, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM conversions) AS conversions, (SELECT COUNT(*) FROM source_checks) AS sources, (SELECT COUNT(*) FROM automation_runs) AS runs, (SELECT COUNT(*) FROM growth_visits) AS visits, (SELECT COUNT(*) FROM growth_events) AS journey_events, (SELECT COUNT(*) FROM growth_hypotheses) AS hypotheses, (SELECT COUNT(*) FROM growth_evidence) AS evidence, (SELECT COUNT(*) FROM growth_campaigns) AS campaigns, (SELECT COUNT(*) FROM growth_observations) AS observations, (SELECT COUNT(*) FROM growth_decisions) AS decisions').first();return json({ok:true,service:'shigoto-dougu',database:'ready'});
 }
 if(path.startsWith('/api/'))return json({error:'not_found'},404);
 const origin=siteOrigin(env);
 if(path==='/robots.txt')return new Response(origin?`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n',{headers:{'content-type':'text/plain; charset=utf-8'}});
 if(path==='/sitemap.xml'){
  const articles=await listArticles(env);
  return new Response(sitemap(env,articles),{headers:{'content-type':'application/xml; charset=utf-8'}});
 }
 const html=(title:string,description:string,body:string,status=200,schema?:unknown,noindex=false)=>new Response(view.layout(title,description,body,path,env,schema,{noindex:noindex||status!==200}),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
 if(path==='/')return html('AI・仕事効率化ツールの比較と選び方','個人事業主・小さなチーム向けに、議事録・自動化・資料作成の仕事からAI・効率化ツールを比較。選び方、導入手順、使えるテンプレートをまとめています。',view.home(await listArticles(env)));
 if(path==='/tools'){
  const category=url.searchParams.get('category')??'',q=(url.searchParams.get('q')??'').slice(0,100);
  return html('仕事の道具を探す','AI文章作成・会議・デザイン・自動化・情報整理の道具を目的から探して比較。',view.toolsPage(category,q),200,undefined,url.searchParams.has('q')||url.searchParams.has('category'));
 }
 if(path==='/compare'){
  const ids=[...new Set([...url.searchParams.getAll('tool'),...(url.searchParams.get('tools')??'').split(',')])].filter(Boolean);
  return html('仕事の道具を比較する','機能・向いている仕事・料金の確認先・注意点を同じ目線で比較。',view.comparePage(ids,await listOffers(env))+view.comparisonIndex(),200,undefined,url.searchParams.has('tool')||url.searchParams.has('tools'));
 }
 if(path.startsWith('/compare/')){
  const comparison=COMPARISONS.find(c=>c.slug===path.slice(9));
  if(comparison)return html(comparison.title,comparison.description,view.comparisonLanding(comparison,await listOffers(env),await listArticles(env)),200,breadcrumbSchema(env,[{name:'ホーム',path:'/'},{name:'比較する',path:'/compare'},{name:comparison.title,path}]));
 }
 if(path==='/diagnosis')return html('あなたに合う道具を診断','用途・予算・使う人数の3つの質問で、仕事に合う道具を理由つきで提案。',view.diagnosisPage());
 if(path==='/guides')return html('選び方ガイド','AI・効率化ツールを選ぶ前に読みたい実用ガイド。',view.guidesPage(await listArticles(env)));
 if(path==='/editorial-policy')return html('編集方針と比較の基準','しごと道具の執筆・比較方法、情報源、検証範囲、広告との関係、訂正の方針。',view.editorialPolicyPage(env),200,breadcrumbSchema(env,[{name:'ホーム',path:'/'},{name:'編集方針と比較の基準',path}]));
 if(path.startsWith('/tools/')){
  const tool=TOOLS.find(t=>t.id===path.slice(7));if(tool)return html(tool.name+'の特徴と選び方',tool.description,view.toolDetail(tool,await listOffers(env),await listArticles(env)),200,breadcrumbSchema(env,[{name:'ホーム',path:'/'},{name:'道具を探す',path:'/tools'},{name:tool.name,path}]));
 }
 if(path.startsWith('/guides/')){
  const article=await getArticle(env,path.slice(8));if(article)return html(article.title,article.description,view.articlePage(article,await listOffers(env),await listArticles(env)),200,[articleSchema(env,article),breadcrumbSchema(env,[{name:'ホーム',path:'/'},{name:'選び方ガイド',path:'/guides'},{name:article.title,path}])]);
 }
 if(['/about','/privacy','/disclosure'].includes(path))return html(path==='/about'?'このサイトについて':path==='/privacy'?'プライバシーポリシー':'広告・編集方針','しごと道具の運営・広告・プライバシーに関する方針。',view.policyPage(path.slice(1),env));
 if(path==='/contact'){
  const profile=operatorProfile(env);
  return html('お問い合わせ','掲載内容の訂正やサイトに関するお問い合わせ窓口。',view.contactPage(env),200,undefined,!profile.email&&!profile.contactUrl);
 }
 if(path==='/admin')return html('運営管理','運営管理者向けの画面です。',adminPage());
 return html('ページが見つかりません','該当するページはありません。',view.notFound(),404);
}
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  let response:Response;
  try{response=await route(request,env,ctx);}catch{console.error('request_failed',new URL(request.url).pathname);response=json({error:'一時的に利用できません。しばらくしてからお試しください。'},503);}
  // Consolidate successful public documents, preserving attribution/query bytes.
  // Never redirect API writes, private admin pages, assets, or genuine 404 responses.
  const url=new URL(request.url),canonicalPath=url.pathname.replace(/\/+$/,'')||'/';
  if((request.method==='GET'||request.method==='HEAD')&&response.status===200&&response.headers.get('content-type')?.startsWith('text/html')&&!url.pathname.startsWith('/admin')&&url.pathname!==canonicalPath){
   url.pathname=canonicalPath;response=new Response(null,{status:308,headers:{location:url.href,'cache-control':'public, max-age=3600'}});
  }
  if(request.method==='HEAD')response=new Response(null,{status:response.status,headers:response.headers});
  return secure(response,new URL(request.url).pathname);
 },
 async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runAutomation(env));}
} satisfies ExportedHandler<Env>;
