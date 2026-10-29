import { operatorProfile, publicSiteOrigin } from './site-config';
import type { Article, Env } from './types';
import { COMPARISONS } from './comparisons';
import { TOOLS } from './content';
import { escapeHtml as e } from './html';
export function siteOrigin(env:Pick<Env,'SITE_URL'>):string|null {
 return publicSiteOrigin(env.SITE_URL);
}
export function sitemap(env:Env,articles:Article[]):string{
 const origin=siteOrigin(env);
 const profile=operatorProfile(env);
 // Only indexable canonical URLs belong here. An unconfigured contact page is noindex.
 const paths=['/','/tools','/compare','/diagnosis','/guides','/about','/editorial-policy','/disclosure','/privacy',...(profile.email||profile.contactUrl?['/contact']:[]),...TOOLS.map(t=>'/tools/'+t.id),...COMPARISONS.map(c=>'/compare/'+c.slug)];
 const records=new Map(paths.map(path=>[path,null as string|null]));
 for(const article of articles){
  if(!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(article.slug))continue;
  const updated=Date.parse(article.updatedAt);
  records.set('/guides/'+article.slug,Number.isFinite(updated)&&updated<=Date.now()?new Date(updated).toISOString().slice(0,10):null);
 }
 return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin?[...records].map(([path,date])=>`<url><loc>${e(origin+path)}</loc>${date?`<lastmod>${date}</lastmod>`:''}</url>`).join(''):''}</urlset>`;
}
export function breadcrumbSchema(env:Env,items:{name:string;path:string}[]):unknown|null{
 const origin=siteOrigin(env);return origin?{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.name,item:origin+item.path}))}:null;
}

/** Editorial attribution describes the actual guide; it makes no review or rating claims. */
export function articleSchema(env:Env,article:Article):unknown|null{
 const origin=siteOrigin(env);if(!origin)return null;
 return {'@context':'https://schema.org','@type':'Article',headline:article.title,description:article.description,
  datePublished:article.publishedAt,dateModified:article.updatedAt,inLanguage:'ja-JP',
  mainEntityOfPage:origin+'/guides/'+article.slug,
  author:{'@type':'Organization',name:'しごと道具 編集部',url:origin+'/editorial-policy'},
  publisher:{'@type':'Organization',name:'しごと道具',url:origin+'/about'}};
}
