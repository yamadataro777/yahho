import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateGrowth, evidenceIsFresh, handleGrowth, validateEvidence } from '../src/growth';
import { handleAdmin } from '../src/admin';
import { runAutomation } from '../src/automation';
import type { Env } from '../src/types';

const NOW=new Date('2026-10-28T12:00:00.000Z');
const token='test-growth-token-at-least-thirty-two-characters';
let sql:DatabaseSync,env:Env;
function stmt(query:string,values:unknown[]=[]):any{return{bind:(...args:unknown[])=>stmt(query,args),async first(){return sql.prepare(query).get(...values as any[])??null;},async all(){return{results:sql.prepare(query).all(...values as any[])};},async run(){const r=sql.prepare(query).run(...values as any[]);return{meta:{changes:Number(r.changes)}};}};}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));env={DB:{prepare:(q:string)=>stmt(q)},ADMIN_TOKEN:token,CONVERSION_TOKEN:token,SITE_URL:'https://shigoto.workers.dev'} as unknown as Env;});
afterEach(()=>{sql.close();vi.useRealTimers();});
async function api(endpoint:string,input?:unknown,method=input===undefined?'GET':'POST',auth=token){const request=new Request('https://shigoto.workers.dev/api/admin/growth'+endpoint,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});const response=(await handleGrowth(request,env))!;return{status:response.status,data:await response.json() as any};}
const hypothesis={id:'design-solo',category:'design',audience:'ひとり事業の担当者',pain:'毎回の資料の見た目を揃えるのに困っている',query:'Canva Adobe Express 比較',targetPath:'/compare/canva-vs-adobe-express'};
const campaign={id:'threads-design-01',name:'資料作りの悩み',source:'threads',hypothesisId:hypothesis.id,targetPath:hypothesis.targetPath};
const evidence={id:'customer-design-01',hypothesisId:hypothesis.id,kind:'customer_quote',sourceUrl:'https://community.shigoto.workers.dev/research/1',observedAt:'2026-10-20T09:00:00.000Z',summary:'テスト用の記録。資料の見た目が担当者ごとに揃わず、選定条件を知りたいという悩み。'};
async function prepare(withEvidence=true,withOffer=true){expect((await api('/hypotheses',hypothesis)).status).toBe(201);expect((await api('/campaigns',campaign)).status).toBe(201);if(withEvidence)expect((await api('/evidence',evidence)).status).toBe(201);if(withOffer){const offer={id:'canva',name:'Canva test',category:'design',description:'Test only',url:'https://partner.shigoto.workers.dev/canva',allowedHosts:['partner.shigoto.workers.dev'],verifiedAt:'2026-01-01T00:00:00.000Z',expiresAt:null,enabled:true,clickTracking:{parameter:'subid',approved:true}};sql.prepare('INSERT INTO offers VALUES(?,?,?,?,?)').run(offer.id,offer.category,1,JSON.stringify(offer),NOW.toISOString());}}
function population(visits:number,clicks:number,options:{date?:string;tracked?:boolean;oneVisit?:boolean}={}){const date=options.date??'2026-10-14T10:00:00.000Z';const visitIds=Array.from({length:visits},()=>crypto.randomUUID());for(const v of visitIds){sql.prepare('INSERT INTO growth_visits VALUES(?,?,?,?,?,?)').run(v,date,new Date(Date.parse(date)+1_800_000).toISOString(),'threads',campaign.id,campaign.targetPath);sql.prepare('INSERT INTO growth_events VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),v,'page_view',campaign.targetPath,'design','',0,date);}const ids:string[]=[];for(let i=0;i<clicks;i++){const id=crypto.randomUUID();ids.push(id);sql.prepare('INSERT INTO growth_events VALUES(?,?,?,?,?,?,?,?)').run(id,visitIds[options.oneVisit?0:i%visits],'affiliate_click',campaign.targetPath,'design','canva',Number(options.tracked!==false),date);}return ids;}
async function conversion(clickId:string,i:number,status='confirmed'){const request=new Request('https://shigoto.workers.dev/api/admin/conversions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({externalId:'asp-'+i,offerId:'canva',commissionJpy:500,occurredAt:'2026-10-18T10:00:00.000Z',clickId})});expect((await handleAdmin(request,env))?.status).toBe(201);if(status==='reversed')sql.prepare("UPDATE conversions SET status='reversed' WHERE external_id=?").run('asp-'+i);}

it('authenticates, validates public destinations, and keeps campaign identity immutable',async()=>{
  expect((await api('',undefined,'GET','bad')).status).toBe(401);
  expect((await api('/hypotheses',{...hypothesis,targetPath:'/admin'})).status).toBe(400);
  expect((await api('/hypotheses',{...hypothesis,category:'writing'})).data.error).toBe('hypothesis_category_mismatch');
  expect((await api('/hypotheses',{...hypothesis,id:'general-writing',category:'writing',targetPath:'/guides'})).status).toBe(201);
  await api('/hypotheses',{id:'general-writing',status:'paused'},'PATCH');
  await prepare(false,false);
  expect((await api('/hypotheses',hypothesis)).status).toBe(200);
  expect((await api('/campaigns',campaign)).status).toBe(200);
  expect((await api('/campaigns',{...campaign,source:'email'})).status).toBe(409);
  const overview=(await api('')).data;
  expect(overview.campaigns[0].url).toBe('https://shigoto.workers.dev'+campaign.targetPath+'?campaign='+campaign.id);
  expect((await api('/hypotheses',{id:hypothesis.id,status:'paused'},'PATCH')).status).toBe(200);
  expect((await evaluateGrowth(env,NOW)).decisions).toEqual([]);
});
it('records provenance idempotently, rejects invented volume, future dates, private URLs and overlapping search periods',async()=>{
  await prepare(false,false);
  expect((await api('/evidence',evidence)).status).toBe(201);
  expect((await api('/evidence',evidence)).status).toBe(200);
  expect((await api('/evidence',{...evidence,summary:evidence.summary+'変更'})).status).toBe(409);
  expect(()=>validateEvidence({...evidence,kind:'suggestion',metrics:{impressions:10,clicks:1}},NOW)).toThrow();
  expect(()=>validateEvidence({...evidence,sourceUrl:'https://127.0.0.1/private'},NOW)).toThrow();
  expect(()=>validateEvidence({...evidence,observedAt:'2026-10-29T00:00:00Z'},NOW)).toThrow();
  expect(()=>validateEvidence({...evidence,observedAt:'2026-02-30T00:00:00Z'},NOW)).toThrow();
  const search={...evidence,id:'gsc-design-1',kind:'search_console',query:'Canva 比較',metrics:{impressions:120,clicks:8},periodStart:'2026-10-01',periodEnd:'2026-10-15'};
  expect((await api('/evidence',search)).status).toBe(201);
  expect((await api('/evidence',{...search,id:'gsc-design-2',periodStart:'2026-10-15'})).status).toBe(409);
  expect((await api('/evidence',{...search,id:'gsc-design-3',periodStart:'2026-10-16',periodEnd:'2026-10-18'})).status).toBe(201);
});
it('does not double count overlapping platform observations',async()=>{
  await prepare(false,false);
  const obs={id:'threads-export-1',campaignId:campaign.id,periodStart:'2026-10-01',periodEnd:'2026-10-10',impressions:1500,clicks:20,sourceUrl:'https://www.threads.net/insights',observedAt:'2026-10-20T00:00:00Z'};
  expect((await api('/observations',obs)).status).toBe(201);
  expect((await api('/observations',obs)).status).toBe(200);
  expect((await api('/observations',{...obs,id:'threads-export-2',periodStart:'2026-10-09',periodEnd:'2026-10-15'})).status).toBe(409);
});
it('does not call suggestions, old observations or unattributable clicks a conversion winner',async()=>{
  await prepare(false);
  const stale={...evidence,observedAt:'2026-01-01T00:00:00Z'};
  expect(evidenceIsFresh(validateEvidence(stale,NOW),NOW)).toBe(false);
  await api('/evidence',{...evidence,kind:'suggestion'});
  population(120,35,{tracked:false});
  expect((await evaluateGrowth(env,NOW)).decisions[0].kind).toBe('research_demand');
  await api('/evidence',{...evidence,id:'real-observation'});
  const result=await evaluateGrowth(env,NOW);
  expect(result.decisions[0].kind).toBe('enable_attribution');expect(result.editorial).toBeNull();
});
it('does not label missing affiliate links as a poor CTA and requires distinct mature visits',async()=>{
  await prepare(true,false);population(110,0);
  expect((await evaluateGrowth(env,NOW)).decisions[0].kind).toBe('connect_offer_measurement');
  const offer={id:'canva',name:'Canva test',category:'design',description:'Test only',url:'https://partner.shigoto.workers.dev/canva',allowedHosts:['partner.shigoto.workers.dev'],verifiedAt:'2026-01-01T00:00:00.000Z',expiresAt:null,enabled:true};sql.prepare('INSERT INTO offers VALUES(?,?,?,?,?)').run(offer.id,offer.category,1,JSON.stringify(offer),NOW.toISOString());
  population(1,35,{oneVisit:true});
  expect((await evaluateGrowth(env,NOW)).decisions[0].kind).toBe('collect_conversions');
});
it('uses fresh evidence and mature confirmed conversions to select editorial work; reversals remove the signal',async()=>{
  await prepare();const clicks=population(120,35);for(let i=0;i<3;i++)await conversion(clicks[i],i);
  const first=await evaluateGrowth(env,NOW);expect(first.decisions[0].kind).toBe('expand_test');expect(first.editorial?.category).toBe('design');
  await evaluateGrowth(env,NOW);expect(sql.prepare('SELECT COUNT(*) AS n FROM growth_decisions').get()?.n).toBe(1);
  const fetcher=vi.fn(async()=>new Response('Official product documentation about creating and sharing visual work. '.repeat(8),{headers:{'content-type':'text/plain'}})) as unknown as typeof fetch;
  const report=await runAutomation(env,{now:NOW,fetcher});expect(report.growth?.status).toBe('evaluated');expect(report.editorial).toMatchObject({basis:'growth_conversions',category:'design',hypothesisId:hypothesis.id,sourceIds:['canva','adobe-express']});expect(report.generation.reasons).toContain('workers_ai_not_configured');
  sql.prepare("UPDATE conversions SET status='reversed' WHERE external_id='asp-2'").run();
  expect((await evaluateGrowth(env,NOW)).editorial).toBeNull();
});
it('logs changes and compares only post-change observations after a minimum observation period',async()=>{
  await prepare();population(110,0);
  const decision=(await evaluateGrowth(env,NOW)).decisions[0];expect(decision.kind).toBe('test_cta');
  expect((await api('/decisions',{id:decision.id,status:'evaluated',note:'順序が不正なテスト'},'PATCH')).status).toBe(409);
  expect((await api('/decisions',{id:decision.id,status:'applied',note:'比較条件の説明をCTAの直前に追加した'},'PATCH')).status).toBe(200);
  expect((await api('/decisions',{id:decision.id,status:'evaluated',note:'同日では検証できない'},'PATCH')).status).toBe(409);
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));population(100,12,{date:'2026-10-29T10:00:00.000Z',tracked:false});
  const evaluated=await api('/decisions',{id:decision.id,status:'evaluated',note:'変更後の観測期間で比較した'},'PATCH');expect(evaluated.status).toBe(200);expect(evaluated.data.decision.outcome).toMatchObject({status:'improved',beforeRate:0,afterRate:0.12,after:{visits:100,clicks:12}});
  expect(evaluated.data.decision.outcome.note).toContain('因果');
});
it('requires manual applied notes and does not treat a dismissed expansion as an automatic instruction',async()=>{
  await prepare();const clicks=population(120,35);for(let i=0;i<3;i++)await conversion(clicks[i],i);
  const d=(await evaluateGrowth(env,NOW)).decisions[0];
  expect((await api('/decisions',{id:d.id,status:'applied',note:'ok'},'PATCH')).status).toBe(400);
  expect((await api('/decisions',{id:d.id,status:'dismissed',note:'この仮説への投資は今回は見送る'},'PATCH')).status).toBe(200);
  const result=await evaluateGrowth(env,NOW);expect(result.editorial).toBeNull();expect(result.decisions[0].status).toBe('dismissed');
  const nextDay=await evaluateGrowth(env,new Date('2026-10-29T12:00:00Z'));expect(nextDay.editorial).toBeNull();expect(nextDay.decisions[0].id).toBe(d.id);expect(nextDay.decisions[0].status).toBe('dismissed');
  expect(sql.prepare('SELECT COUNT(*) AS n FROM growth_decisions').get()?.n).toBe(1);
});

it('refreshes proposed snapshots and allows later evaluation after an insufficient first observation',async()=>{
  await prepare();population(110,0);
  const first=(await evaluateGrowth(env,NOW)).decisions[0];expect(first.baseline.visits).toBe(110);
  population(20,0);const updated=(await evaluateGrowth(env,NOW)).decisions[0];expect(updated.id).toBe(first.id);expect(updated.baseline.visits).toBe(130);expect(updated.reason).toContain('130');
  await api('/decisions',{id:first.id,status:'applied',note:'導線の説明を追加して比較を開始した'},'PATCH');
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  const insufficient=await api('/decisions',{id:first.id,status:'evaluated',note:'一週間の観測を確認した'},'PATCH');
  expect(insufficient.status).toBe(200);expect(insufficient.data.decision.status).toBe('applied');expect(insufficient.data.decision.outcome.status).toBe('insufficient_data');
  population(110,11,{date:'2026-10-30T12:00:00Z',tracked:false});vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  const enough=await api('/decisions',{id:first.id,status:'evaluated',note:'追加の観測値が集まったため再評価した'},'PATCH');
  expect(enough.status).toBe(200);expect(enough.data.decision.status).toBe('evaluated');expect(enough.data.decision.outcome.status).toBe('improved');
});

it('returns a clear expired-window result beyond retention instead of a storage error',async()=>{
  await prepare();population(110,0);const decision=(await evaluateGrowth(env,NOW)).decisions[0];
  expect((await api('/decisions',{id:decision.id,status:'applied',note:'比較導線の改善を記録した'},'PATCH')).status).toBe(200);
  vi.setSystemTime(new Date(NOW.getTime()+90*86400000));
  const boundary=await api('/decisions',{id:decision.id,status:'evaluated',note:'保存期間の境界で評価した'},'PATCH');
  expect(boundary.status).toBe(200);expect(boundary.data.decision.status).toBe('applied');
  vi.setSystemTime(new Date(NOW.getTime()+90*86400000+1));
  const expired=await api('/decisions',{id:decision.id,status:'evaluated',note:'保存期間後に評価した'},'PATCH');
  expect(expired.status).toBe(409);expect(expired.data.error).toBe('observation_window_expired');expect(expired.data.message).toContain('新しいキャンペーン');
});
