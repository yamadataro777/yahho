import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { analyticsReport, clickDestination, handleAnalytics, publicPage, purgeAnalytics } from '../src/analytics';
import { handleAdmin, validateOffer } from '../src/admin';
import type { Env, Offer } from '../src/types';

const DAY = 86_400_000;
const token = 'local-test-token-at-least-thirty-two-characters';
let db: DatabaseSync;
let env: Env;
const now = () => new Date();
const ago = (days: number) => new Date(Date.now() - days * DAY);
function statement(sql: string, args: unknown[] = []) {
  return {
    bind(...values: unknown[]) { return statement(sql, values); },
    async first() { return db.prepare(sql).get(...args as any[]) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args as any[]), success: true, meta: {} }; },
    async run() { const result = db.prepare(sql).run(...args as any[]); return { success: true, meta: { changes: Number(result.changes) } }; },
  };
}
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  env = { DB: { prepare: (sql: string) => statement(sql) }, ADMIN_TOKEN: token, CONVERSION_TOKEN: token } as unknown as Env;
  db.prepare('INSERT INTO growth_hypotheses(id,category,audience,pain,query,target_path,created_at) VALUES(?,?,?,?,?,?,?)').run('writing-need','writing','小規模チーム','文章の下書き','AI 文章','/tools/claude',ago(20).toISOString());
  db.prepare('INSERT INTO growth_campaigns(id,name,source,hypothesis_id,target_path,created_at) VALUES(?,?,?,?,?,?)').run('post-one','投稿1','threads','writing-need','/tools/claude',ago(20).toISOString());
});
afterEach(() => db.close());
function request(path: string, input: unknown, headers: Record<string,string> = {}) {
  return new Request('https://site.test'+path, { method: 'POST', headers: { origin: 'https://site.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
}
async function telemetry(path: string, input: unknown, date = now(), headers: Record<string,string> = {}) {
  return (await handleAnalytics(request('/api/analytics/'+path,input,headers),env,date))!;
}
async function admin(path: string, input: unknown) { const req = request(path,input,{ authorization: 'Bearer '+token }); return (await handleAdmin(path === '/api/admin/offers' ? new Request(req, { method: 'PUT' }) : req,env))!; }
function offer(tracking = true, id = 'claude'): Offer {
  return { id, name: 'Approved offer', category: 'writing', description: 'Operator-verified test affiliate', url: 'https://px.a8.net/svt/ejp?a8mat=1%2F2&sig=ab%2Bcd', allowedHosts: ['px.a8.net'], enabled: true, verifiedAt: ago(30).toISOString(), expiresAt: null, ...(tracking ? { clickTracking: { parameter: 'clickref', approved: true as const } } : {}) };
}
async function saveOffer(tracking = true,id='claude') { const value = offer(tracking,id); expect((await admin('/api/admin/offers',value)).status).toBe(200); return value; }
async function visit(date=now(), campaign: string|undefined='post-one') {
  const response = await telemetry('visit',{path:'/tools/claude',...(campaign?{campaign}:{}),source:'direct'},date);
  expect(response.status).toBe(201); return await response.json() as {visitId:string;expiresAt:string};
}
async function event(visitId: string, kind: string, date=now(), other: Record<string, unknown>={}) {
  const input = {visitId,eventId:crypto.randomUUID(),kind,path:'/tools/claude',...other};
  const response = await telemetry('event',input,date); return {input,response};
}

describe('anonymous visit boundaries and deduplicated events',()=>{
  it('records only known public paths and registered campaign metadata, retains first-touch across navigation',async()=>{
    const first=await visit();
    const repeat=await telemetry('visit',{visitId:first.visitId,path:'/diagnosis',source:'search'});
    expect((await repeat.json() as any).visitId).toBe(first.visitId);
    expect(db.prepare('SELECT source,campaign_id,landing_path FROM growth_visits').get()).toMatchObject({source:'threads',campaign_id:'post-one',landing_path:'/tools/claude'});
    expect((await telemetry('visit',{path:'/tools/claude',campaign:'unknown'})).status).toBe(400);
    expect((await telemetry('visit',{path:'/diagnosis',campaign:'post-one'})).status).toBe(400);
    expect((await telemetry('visit',{path:'/tools?q=private@example.com'})).status).toBe(400);
    expect((await telemetry('visit',{path:'/admin'})).status).toBe(400);
    expect((await telemetry('visit',{path:'/',source:'https://private.example.com/path'})).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM growth_visits').get()?.n).toBe(1);
    const names=db.prepare('PRAGMA table_info(growth_visits)').all().map(r=>r.name);
    for(const key of ['ip','user_agent','referrer','email','cookie']) expect(names).not.toContain(key);
    expect(await publicPage(env,'/tools/nonexistent')).toBeNull();
  });
  it('ignores DNT/GPC/bots, rejects cross-origin input and oversized bodies',async()=>{
    for(const h of [{'dnt':'1'},{'sec-gpc':'1'},{'user-agent':'PreviewBot'}]) expect((await telemetry('visit',{path:'/'},now(),h)).status).toBe(202);
    expect((await telemetry('visit',{path:'/'},now(),{origin:'https://evil.test'})).status).toBe(403);
    expect((await telemetry('visit',{path:'/',payload:'x'.repeat(5000)})).status).toBe(413);
    expect(db.prepare('SELECT COUNT(*) AS n FROM growth_visits').get()?.n).toBe(0);
  });
  it('expires journeys after30minutes and deduplicates event retries without allowing conflicting reuse',async()=>{
    const date=ago(1), first=await visit(date);
    const {input,response}=await event(first.visitId,'page_view',date);
    expect(response.status).toBe(200);
    expect((await telemetry('event',input,date)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM growth_events').get()?.n).toBe(1);
    expect((await telemetry('event',{...input,path:'/diagnosis'},date)).status).toBe(409);
    expect((await telemetry('event',input,new Date(date.getTime()+30*60_000))).status).toBe(410);
    const replacement=await telemetry('visit',{visitId:first.visitId,path:'/diagnosis'},new Date(date.getTime()+30*60_000));
    expect(replacement.status).toBe(201);
    expect((await replacement.json() as any).visitId).not.toBe(first.visitId);
  });
});

describe('approved click IDs and actual commission attribution',()=>{
  it('measures untagged search entry cohorts across navigation without counting tagged search or direct visits twice',async()=>{
    await saveOffer();const date=ago(10);
    const firstResponse=await telemetry('visit',{path:'/tools/claude',source:'search'},date);
    const first=await firstResponse.json() as {visitId:string};
    await event(first.visitId,'page_view',date);
    await event(first.visitId,'page_view',date,{path:'/compare/chatgpt-vs-claude'});
    const click=await event(first.visitId,'affiliate_click',date,{path:'/compare/chatgpt-vs-claude',offerId:'claude',attributionRequested:true});
    expect((await admin('/api/admin/conversions',{externalId:'organic-purchase',offerId:'claude',commissionJpy:800,occurredAt:new Date(date.getTime()+DAY).toISOString(),clickId:click.input.eventId})).status).toBe(201);
    // A successfully observed entry is counted even if the subsequent event request is lost.
    expect((await telemetry('visit',{path:'/tools/claude',source:'search'},date)).status).toBe(201);
    const other=await (await telemetry('visit',{path:'/tools/chatgpt',source:'search'},date)).json() as {visitId:string};
    await event(other.visitId,'page_view',date,{path:'/tools/chatgpt'});
    db.prepare('INSERT INTO growth_campaigns(id,name,source,hypothesis_id,target_path,created_at) VALUES(?,?,?,?,?,?)').run('tagged-search','Tagged search','search','writing-need','/tools/claude',date.toISOString());
    const tagged=await visit(date,'tagged-search');await event(tagged.visitId,'page_view',date);
    const direct=await visit(date,'');await event(direct.visitId,'page_view',date);
    const report=await analyticsReport(env);
    expect(report.totals).toMatchObject({visits:5,pageViews:5,clicks:1,confirmedConversions:1,confirmedRevenueJpy:800});
    expect(report.organicRows).toHaveLength(2);
    expect(report.organicRows.find(row=>row.pagePath==='/tools/claude')).toMatchObject({source:'search',campaignId:'',visits:2,pageViews:2,clicks:1,matureAttributableVisits:1,convertedClicks:1,confirmedRevenueJpy:800});
    expect(report.organicRows.find(row=>row.pagePath==='/tools/chatgpt')).toMatchObject({visits:1,clicks:0,confirmedRevenueJpy:0});
    expect(report.campaignRows.find(row=>row.campaignId==='tagged-search')).toMatchObject({visits:1,clicks:0});
    expect(report.organicRows.reduce((sum,row)=>sum+row.visits,0)).toBe(3);
    expect(report.organicRows.some(row=>row.pagePath==='/compare/chatgpt-vs-claude')).toBe(false);
    expect(db.prepare('SELECT attributed_landing_path,attributed_page_path FROM conversions').get()).toMatchObject({attributed_landing_path:'/tools/claude',attributed_page_path:'/compare/chatgpt-vs-claude'});
    expect((await analyticsReport(env,now(),ago(2))).organicRows).toEqual([]);
  });
  it('preserves issued URL by default and appends only an explicitly approved collision-free parameter',async()=>{
    const value=await saveOffer(false), first=await visit();
    const a=await event(first.visitId,'affiliate_click',now(),{offerId:'claude',attributionRequested:true});
    expect(await a.response.json()).toMatchObject({url:value.url,attributable:false});
    expect(clickDestination(value,crypto.randomUUID())).toBe(value.url);
    for(const config of [{parameter:'clickref',approved:false},{parameter:'a8mat',approved:true},{parameter:'sig',approved:true},{parameter:'url',approved:true}]) expect(()=>validateOffer({...value,clickTracking:config})).toThrow();
    expect(()=>validateOffer({...value,url:value.url+'#anchor',clickTracking:{parameter:'clickref',approved:true}})).toThrow();
    await saveOffer(true);
    const passive=await event(first.visitId,'affiliate_click',now(),{offerId:'claude'});
    expect(await passive.response.json()).toMatchObject({url:value.url,attributable:false});
    const active=await event(first.visitId,'affiliate_click',now(),{offerId:'claude',attributionRequested:true});
    expect(await active.response.json()).toMatchObject({url:value.url+'&clickref='+active.input.eventId,attributable:true});
    expect(db.prepare('SELECT tracked_click FROM growth_events WHERE id=?').get(active.input.eventId)?.tracked_click).toBe(1);
  });
  it('links only a matching historical ASP click, persists attribution and reverses idempotently',async()=>{
    await saveOffer(); await saveOffer(true,'notion');
    const date=ago(10), first=await visit(date);
    await event(first.visitId,'page_view',date);
    const click=await event(first.visitId,'affiliate_click',date,{offerId:'claude',attributionRequested:true});
    const input={externalId:'test:commission-1',offerId:'claude',commissionJpy:1200,occurredAt:new Date(date.getTime()+DAY).toISOString(),clickId:click.input.eventId};
    expect((await admin('/api/conversions/webhook',{...input,offerId:'notion'})).status).toBe(422);
    expect((await admin('/api/conversions/webhook',{...input,occurredAt:new Date(date.getTime()-1).toISOString()})).status).toBe(422);
    expect((await admin('/api/conversions/webhook',{...input,clickId:crypto.randomUUID()})).status).toBe(422);
    expect((await admin('/api/conversions/webhook',input)).status).toBe(201);
    expect((await admin('/api/conversions/webhook',input)).status).toBe(200);
    expect((await admin('/api/conversions/webhook',{...input,clickId:undefined})).status).toBe(409);
    expect(db.prepare('SELECT attributed_source,attributed_campaign_id,attributed_landing_path,attributed_page_path FROM conversions').get()).toMatchObject({attributed_source:'threads',attributed_campaign_id:'post-one',attributed_landing_path:'/tools/claude',attributed_page_path:'/tools/claude'});
    let report=await analyticsReport(env); expect(report.totals.confirmedRevenueJpy).toBe(1200); expect(report.campaignRows[0].convertedClicks).toBe(1);
    expect((await admin('/api/admin/conversions/reverse',{externalId:input.externalId})).status).toBe(200);
    expect(await (await admin('/api/admin/conversions/reverse',{externalId:input.externalId})).json()).toMatchObject({alreadyReversed:true});
    expect((await admin('/api/conversions/webhook',input)).status).toBe(200); // original delivery must not resurrect reversal
    report=await analyticsReport(env); expect(report.totals.confirmedRevenueJpy).toBe(0); expect(report.campaignRows[0].convertedClicks).toBe(0);
    expect(report.recentConversions[0].status).toBe('reversed');
    await purgeAnalytics(env,new Date(date.getTime()+100*DAY));
    expect(db.prepare('SELECT COUNT(*) AS n FROM growth_events').get()?.n).toBe(0);
    expect((await admin('/api/conversions/webhook',input)).status).toBe(200); // retry valid even after raw-click retention
    expect(db.prepare('SELECT attributed_campaign_id FROM conversions').get()?.attributed_campaign_id).toBe('post-one');
  });
  it('rejects untrackable and over-window claims and requires authorization for reports and reversals',async()=>{
    await saveOffer();
    const old=ago(40), first=await visit(old);
    const ancient=await event(first.visitId,'affiliate_click',old,{offerId:'claude',attributionRequested:true});
    const passive=await event(first.visitId,'affiliate_click',old,{offerId:'claude'});
    const conversion={externalId:'too-late',offerId:'claude',commissionJpy:100,occurredAt:ago(1).toISOString(),clickId:ancient.input.eventId};
    expect((await admin('/api/admin/conversions',conversion)).status).toBe(422);
    expect((await admin('/api/admin/conversions',{...conversion,externalId:'passive',occurredAt:ago(39).toISOString(),clickId:passive.input.eventId})).status).toBe(422);
    const unauthenticated=await handleAdmin(new Request('https://site.test/api/admin/analytics'),env);
    expect(unauthenticated?.status).toBe(401);
    expect((await handleAdmin(request('/api/admin/conversions/reverse',{externalId:'too-late'}),env))?.status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversions').get()?.n).toBe(0);
  });
  it('keeps unavailable attribution unknown instead of inferring it, and excludes young clicks from conversion rate',async()=>{
    await saveOffer();
    const old=ago(10), first=await visit(old);
    await event(first.visitId,'page_view',old);
    await event(first.visitId,'page_view',old,{path:'/diagnosis'});
    await event(first.visitId,'diagnosis',old,{path:'/diagnosis',category:'writing'});
    const mature=await event(first.visitId,'affiliate_click',old,{offerId:'claude',attributionRequested:true});
    await event(first.visitId,'affiliate_click',old,{offerId:'claude'}); // cannot receive sub-ID, not in conversion denominator
    const fresh=await visit(); await event(fresh.visitId,'page_view');
    await event(fresh.visitId,'affiliate_click',now(),{offerId:'claude',attributionRequested:true});
    for(let i=0;i<2;i++) expect((await admin('/api/admin/conversions',{externalId:'repeat-purchase-'+i,offerId:'claude',commissionJpy:500,occurredAt:new Date(old.getTime()+DAY).toISOString(),clickId:mature.input.eventId})).status).toBe(201);
    expect((await admin('/api/admin/conversions',{externalId:'unmatched',offerId:'claude',commissionJpy:700,occurredAt:ago(1).toISOString()})).status).toBe(201);
    const report=await analyticsReport(env);
    expect(report.totals).toMatchObject({visits:2,pageViews:3,diagnoses:1,clicks:3,confirmedConversions:3,confirmedRevenueJpy:1700,unattributedConversions:1});
    expect(report.campaignRows).toHaveLength(1);
    expect(report.campaignRows[0]).toMatchObject({visits:2,clicks:3,matureClicks:2,matureAttributableClicks:1,matureAttributableVisits:1,convertedClicks:1,convertedVisits:1,conversionRate:1,confirmedRevenueJpy:1000});
    expect(report.rows).toHaveLength(2);
    expect((await analyticsReport(env,now(),ago(2))).campaignRows[0]).toMatchObject({visits:1,matureAttributableClicks:0,conversionRate:null});
    await expect(analyticsReport(env,now(),ago(91))).rejects.toThrow('invalid_analytics_window');
  });
});
