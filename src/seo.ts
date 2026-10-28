import { publicSiteOrigin } from './site-config';
import type { Article, Env } from './types';
import { COMPARISONS } from './comparisons';
import { TOOLS } from './content';
import { escapeHtml as e } from './html';
export function siteOrigin(env:Pick<Env,'SITE_URL'>):string|null {
 return publicSiteOrigin(env.SITE_URL);
}
export function sitemap(env:Env,articles:Article[]):string{
 const origin=siteOrigin(env);
 const paths=['/','/tools','/compare','/diagnosis','/guides','/about','/disclosure','/privacy','/contact',...TOOLS.map(t=>'/tools/'+t.id),...COMPARISONS.map(c=>'/compare/'+c.slug)];
 const records=[...paths.map(path=>({path,date:null as string|null})),...articles.map(a=>({path:'/guides/'+a.slug,date:Number.isFinite(Date.parse(a.updatedAt))?new Date(a.updatedAt).toISOString().slice(0,10):null}))];
 return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin?records.map(r=>`<url><loc>${e(origin+r.path)}</loc>${r.date?`<lastmod>${r.date}</lastmod>`:''}</url>`).join(''):''}</urlset>`;
}
export function breadcrumbSchema(env:Env,items:{name:string;path:string}[]):unknown|null{
 const origin=siteOrigin(env);return origin?{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.name,item:origin+item.path}))}:null;
}
