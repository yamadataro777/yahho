import { CATEGORIES, TOOLS } from './content';
import { COMPARISONS } from './comparisons';
import { getArticle, isPublicHostname, listOffers, isUsableOffer } from './store';
import { tokenMatches } from './admin';
import { analyticsReport, publicPage, type AnalyticsReport } from './analytics';
import { siteOrigin } from './seo';
import type { Env } from './types';

const DAY = 86_400_000;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const GROWTH_THRESHOLDS = { freshDays: 90, minVisits: 100, minMatureAttributableClicks: 30, minConvertedClicks: 3, minMatureAttributableVisits: 20, minConvertedVisits: 3, observationDays: 7, lowClickRate: 0.05 } as const;
const EVIDENCE_KINDS = ['customer_quote','search_console','suggestion','competitor','official_page'] as const;
const SOURCES = ['threads','search','social','email','referral','other'];
export interface Hypothesis { id: string; category: string; audience: string; pain: string; query: string; targetPath: string; status: 'active'|'paused'; createdAt: string }
export interface Evidence { id: string; hypothesisId: string; kind: typeof EVIDENCE_KINDS[number]; sourceUrl: string; observedAt: string; summary: string; query?: string; metrics?: {impressions:number;clicks:number}; periodStart?: string; periodEnd?: string }
export interface Campaign { id:string; name:string; source:string; hypothesisId:string; targetPath:string; status:'active'|'paused'; createdAt:string }
export interface Observation { id:string; campaignId:string; periodStart:string; periodEnd:string; impressions:number; clicks:number; sourceUrl:string; observedAt:string }
export interface GrowthMetrics { visits:number; clicks:number; attributableClicks:number; matureAttributableClicks:number; matureAttributableVisits:number; convertedClicks:number; convertedVisits:number; confirmedRevenueJpy:number }
type GrowthCohort = {kind:'organic_search_landing';targetPath:string;source:'search'} | {kind:'campaign';campaignId:string;source:string};
export interface GrowthDecision {
  id:string; hypothesisId:string; campaignId:string; kind:string; title:string; reason:string; action:string; metric:string;
  baseline:GrowthMetrics; snapshot:{window:unknown; thresholds:typeof GROWTH_THRESHOLDS; evidenceIds:string[]; evidenceStatus:string;cohort?:GrowthCohort};
  status:'proposed'|'applied'|'dismissed'|'evaluated'; createdAt:string; updatedAt:string; note:string;
  appliedAt?:string; outcome?:{status:'insufficient_data'|'improved'|'declined'|'unchanged'|'criterion_met'; measuredAt:string; after:GrowthMetrics; beforeRate:number|null; afterRate:number|null; note:string};
}
export interface GrowthEvaluation { decisions:GrowthDecision[]; editorial:{hypothesisId:string;category:string;campaignId:string;reason:string;topic:string}|null }

class GrowthError extends Error { constructor(message:string, public status=400, public detail?:string){super(message);} }
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const plain=(value:unknown,name:string,min=1,max=200):string=>{if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f<>]/.test(value))throw new GrowthError(`Invalid ${name}`);return value.trim();};
const id=(value:unknown,name='id'):string=>{const v=plain(value,name,1,80);if(!ID.test(v))throw new GrowthError(`Invalid ${name}`);return v;};
const count=(value:unknown,name:string):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1_000_000_000)throw new GrowthError(`Invalid ${name}`);return value;};
function timestamp(value:unknown,name:string,now:Date):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))throw new GrowthError(`Invalid ${name}`);
  day(value.slice(0,10),name);const date=new Date(value);if(date.getTime()>now.getTime())throw new GrowthError(`${name} cannot be in the future`);return date.toISOString();
}
function day(value:unknown,name:string):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new GrowthError(`Invalid ${name}`);return value;}
function period(body:Record<string,unknown>,observedAt:string){const periodStart=day(body.periodStart,'periodStart'),periodEnd=day(body.periodEnd,'periodEnd');if(periodStart>periodEnd||periodEnd>observedAt.slice(0,10)||(Date.parse(periodEnd)-Date.parse(periodStart))/DAY>365)throw new GrowthError('Invalid observation period');return{periodStart,periodEnd};}
function publicUrl(value:unknown):string {
  const sourceUrl=plain(value,'sourceUrl',1,2048);let u:URL;try{u=new URL(sourceUrl);}catch{throw new GrowthError('Invalid sourceUrl');}
  if(u.protocol!=='https:'||!isPublicHostname(u.hostname)||u.username||u.password||u.port||u.hash)throw new GrowthError('sourceUrl must be a public HTTPS URL without credentials or fragment');
  return sourceUrl;
}
export async function validGrowthPath(env:Env,value:unknown):Promise<string>{
  const path=plain(value,'targetPath',1,200);
  if(['/','/tools','/compare','/guides','/diagnosis'].includes(path))return path;
  if(TOOLS.some(tool=>path==='/tools/'+tool.id)||COMPARISONS.some(c=>path==='/compare/'+c.slug))return path;
  if(/^\/guides\/[a-z0-9][a-z0-9_-]{0,99}$/.test(path)&&(await getArticle(env,path.slice(8))))return path;
  throw new GrowthError('targetPath must be a published site page without query parameters');
}
async function body(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new GrowthError('Content-Type must be application/json',415);
  if(!request.body)throw new GrowthError('JSON object required');const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>16384){await reader.cancel();throw new GrowthError('Request too large',413);}chunks.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let obj:unknown;try{obj=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new GrowthError('Invalid JSON');}
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new GrowthError('JSON object required');return obj as Record<string,unknown>;
}
async function hypotheses(env:Env):Promise<Hypothesis[]>{return(await env.DB.prepare('SELECT id,category,audience,pain,query,target_path AS targetPath,status,created_at AS createdAt FROM growth_hypotheses ORDER BY created_at,id').all<Hypothesis>()).results;}
async function campaigns(env:Env):Promise<Campaign[]>{return(await env.DB.prepare('SELECT id,name,source,hypothesis_id AS hypothesisId,target_path AS targetPath,status,created_at AS createdAt FROM growth_campaigns ORDER BY created_at,id').all<Campaign>()).results;}
async function records<T>(env:Env,table:'growth_evidence'|'growth_observations'|'growth_decisions',limit=1000):Promise<T[]>{return(await env.DB.prepare(`SELECT payload_json FROM ${table} ORDER BY created_at DESC,id LIMIT ?`).bind(limit).all<{payload_json:string}>()).results.map(row=>JSON.parse(row.payload_json) as T);}
export function evidenceIsFresh(item:Evidence,now:Date):boolean {const date=Date.parse(item.periodEnd?item.periodEnd+'T23:59:59.999Z':item.observedAt);return date<=now.getTime()+DAY&&Date.parse(item.observedAt)<=now.getTime()&&date>=now.getTime()-GROWTH_THRESHOLDS.freshDays*DAY;}
const actualDemand=(item:Evidence)=>item.kind==='customer_quote'||(item.kind==='search_console'&&(item.metrics?.impressions??0)>0);
const metrics=(row?:Partial<GrowthMetrics>):GrowthMetrics=>({visits:row?.visits??0,clicks:row?.clicks??0,attributableClicks:row?.attributableClicks??0,matureAttributableClicks:row?.matureAttributableClicks??0,matureAttributableVisits:row?.matureAttributableVisits??0,convertedClicks:row?.convertedClicks??0,convertedVisits:row?.convertedVisits??0,confirmedRevenueJpy:row?.confirmedRevenueJpy??0});
function decisionMetrics(report:AnalyticsReport,decision:GrowthDecision):GrowthMetrics {
  const cohort=decision.snapshot.cohort;
  if(cohort?.kind==='organic_search_landing')return metrics(report.organicRows.find(row=>row.pagePath===cohort.targetPath));
  // Old campaign-free decisions did not have an identifiable population. Do not mix all untagged traffic into them.
  return metrics(decision.campaignId?report.campaignRows.find(row=>row.campaignId===decision.campaignId):undefined);
}

export function validateEvidence(input:Record<string,unknown>,now=new Date()):Evidence {
  const kind=plain(input.kind,'kind') as Evidence['kind'];if(!EVIDENCE_KINDS.includes(kind))throw new GrowthError('Invalid evidence kind');
  const result:Evidence={id:id(input.id),hypothesisId:id(input.hypothesisId,'hypothesisId'),kind,sourceUrl:publicUrl(input.sourceUrl),observedAt:timestamp(input.observedAt,'observedAt',now),summary:plain(input.summary,'summary',20,2000)};
  if(input.query!==undefined)result.query=plain(input.query,'query',1,200);
  if(input.metrics!==undefined){if(!input.metrics||typeof input.metrics!=='object'||Array.isArray(input.metrics)||kind==='suggestion')throw new GrowthError('Suggestions are not measured search volume');const m=input.metrics as Record<string,unknown>;result.metrics={impressions:count(m.impressions,'impressions'),clicks:count(m.clicks,'clicks')};if(result.metrics.clicks>result.metrics.impressions)throw new GrowthError('clicks exceed impressions');Object.assign(result,period(input,result.observedAt));}
  if(kind==='search_console'&&(!result.metrics||!result.query))throw new GrowthError('search_console evidence requires query, metrics and period');
  if(input.periodStart!==undefined||input.periodEnd!==undefined)Object.assign(result,period(input,result.observedAt));
  return result;
}
async function saveEvidence(env:Env,input:Record<string,unknown>,now:Date){
  const data=validateEvidence(input,now);const serialized=JSON.stringify(data);
  const previous=await env.DB.prepare('SELECT payload_json FROM growth_evidence WHERE id=?').bind(data.id).first<{payload_json:string}>();
  if(previous){if(previous.payload_json!==serialized)throw new GrowthError('idempotency_conflict',409);return{created:false,evidence:data};}
  if(!await env.DB.prepare('SELECT id FROM growth_hypotheses WHERE id=?').bind(data.hypothesisId).first())throw new GrowthError('hypothesis_not_found',404);
  if(data.kind==='search_console'&&await env.DB.prepare("SELECT id FROM growth_evidence WHERE hypothesis_id=? AND kind='search_console' AND query=? AND period_start<=? AND period_end>=?").bind(data.hypothesisId,data.query!,data.periodEnd!,data.periodStart!).first())throw new GrowthError('overlapping_evidence_period',409);
  try{await env.DB.prepare('INSERT INTO growth_evidence(id,hypothesis_id,kind,source_url,query,observed_at,period_start,period_end,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(data.id,data.hypothesisId,data.kind,data.sourceUrl,data.query??'',data.observedAt,data.periodStart??null,data.periodEnd??null,serialized,now.toISOString()).run();}
  catch{throw new GrowthError('evidence_conflict',409);}return{created:true,evidence:data};
}
async function saveHypothesis(env:Env,input:Record<string,unknown>,now:Date){
  const category=plain(input.category,'category');if(!CATEGORIES.some(c=>c.id===category))throw new GrowthError('Invalid category');
  const data={id:id(input.id),category,audience:plain(input.audience,'audience',2,200),pain:plain(input.pain,'pain',5,500),query:plain(input.query,'query',2,200),targetPath:await validGrowthPath(env,input.targetPath)};
  const target=await publicPage(env,data.targetPath);
  if(target?.category&&target.category!==category)throw new GrowthError('hypothesis_category_mismatch',400,'仮説の用途を案内ページの用途に合わせてください。');
  const previous=(await hypotheses(env)).find(h=>h.id===data.id);if(previous){if(Object.entries(data).some(([key,value])=>previous[key as keyof Hypothesis]!==value))throw new GrowthError('idempotency_conflict',409);return{created:false,hypothesis:previous};}
  await env.DB.prepare('INSERT INTO growth_hypotheses(id,category,audience,pain,query,target_path,created_at) VALUES(?,?,?,?,?,?,?)').bind(data.id,data.category,data.audience,data.pain,data.query,data.targetPath,now.toISOString()).run();
  return{created:true,hypothesis:{...data,status:'active',createdAt:now.toISOString()}};
}
async function saveCampaign(env:Env,input:Record<string,unknown>,now:Date){
  const data={id:id(input.id),name:plain(input.name,'name',2,160),source:plain(input.source,'source'),hypothesisId:id(input.hypothesisId,'hypothesisId'),targetPath:await validGrowthPath(env,input.targetPath)};
  if(!SOURCES.includes(data.source))throw new GrowthError('Invalid source');const hyp=(await hypotheses(env)).find(h=>h.id===data.hypothesisId);if(!hyp)throw new GrowthError('hypothesis_not_found',404);if(hyp.targetPath!==data.targetPath)throw new GrowthError('Campaign destination must match its hypothesis');
  const previous=(await campaigns(env)).find(c=>c.id===data.id);if(previous){if(Object.entries(data).some(([key,value])=>previous[key as keyof Campaign]!==value))throw new GrowthError('idempotency_conflict',409);return{created:false,campaign:{...previous,url:campaignUrl(previous,env)}};}
  await env.DB.prepare('INSERT INTO growth_campaigns(id,name,source,hypothesis_id,target_path,created_at) VALUES(?,?,?,?,?,?)').bind(data.id,data.name,data.source,data.hypothesisId,data.targetPath,now.toISOString()).run();
  const campaign:Campaign={...data,status:'active',createdAt:now.toISOString()};return{created:true,campaign:{...campaign,url:campaignUrl(campaign,env)}};
}
function campaignUrl(c:Campaign,env:Env){return(siteOrigin(env)??'')+c.targetPath+'?campaign='+encodeURIComponent(c.id);}
async function saveObservation(env:Env,input:Record<string,unknown>,now:Date){
  const observedAt=timestamp(input.observedAt,'observedAt',now);const data:Observation={id:id(input.id),campaignId:id(input.campaignId,'campaignId'),...period(input,observedAt),impressions:count(input.impressions,'impressions'),clicks:count(input.clicks,'clicks'),sourceUrl:publicUrl(input.sourceUrl),observedAt};
  if(data.clicks>data.impressions)throw new GrowthError('clicks exceed impressions');const serialized=JSON.stringify(data);
  const previous=await env.DB.prepare('SELECT payload_json FROM growth_observations WHERE id=?').bind(data.id).first<{payload_json:string}>();if(previous){if(previous.payload_json!==serialized)throw new GrowthError('idempotency_conflict',409);return{created:false,observation:data};}
  if(!await env.DB.prepare('SELECT id FROM growth_campaigns WHERE id=?').bind(data.campaignId).first())throw new GrowthError('campaign_not_found',404);
  if(await env.DB.prepare('SELECT id FROM growth_observations WHERE campaign_id=? AND period_start<=? AND period_end>=?').bind(data.campaignId,data.periodEnd,data.periodStart).first())throw new GrowthError('overlapping_observation_period',409);
  try{await env.DB.prepare('INSERT INTO growth_observations(id,campaign_id,period_start,period_end,payload_json,created_at) VALUES(?,?,?,?,?,?)').bind(data.id,data.campaignId,data.periodStart,data.periodEnd,serialized,now.toISOString()).run();}
  catch{throw new GrowthError('observation_conflict',409);}return{created:true,observation:data};
}

function recommendation(h:Hypothesis,c:Campaign|undefined,m:GrowthMetrics,e:Evidence[],impressions:number,hasOffer:boolean):{kind:string;title:string;reason:string;action:string;metric:string}{
  const search=!c||c.source==='search';
  if(!e.some(actualDemand))return{kind:'research_demand',title:'需要の根拠を追加する',reason:'直近90日以内の顧客の悩み、または検索の実測記録がありません。サジェストや公式製品ページだけでは需要を確認できません。',action:`「${h.query}」の検索実績、または対象読者の具体的な悩みを出典・日付付きで収集する。`,metric:'demand_evidence'};
  if(search&&m.visits<GROWTH_THRESHOLDS.minVisits)return{kind:'collect_traffic',title:'検索への掲載と検索意図を確認する',reason:`この対象で計測できた検索経由の訪問は${m.visits}件です。運用上の観測目安${GROWTH_THRESHOLDS.minVisits}件未満のため、成約の良し悪しは判定しません。Search Consoleのクリックとは定義や期間が異なり、個別の検索語は訪問へ紐付けません。`,action:'Search Consoleで対象URLのインデックス、検索語、表示回数、クリックを確認する。掲載状況に問題がなければ、検索意図に対する回答・タイトル・内部リンクを一項目ずつ改善する。通常のURLで計測でき、SNS投稿や計測パラメータは不要。',metric:'visits'};
  if(m.visits<100)return{kind:'collect_traffic',title:impressions>=1000?'投稿の切り口を比較する':'集客の実測を増やす',reason:`計測できた訪問は${m.visits}件で、判断目安の100件に届いていません。${impressions>=1000?'媒体の表示記録はありますが、サイト訪問との定義・期間の違いも確認してください。':''}`,action:'対象読者の悩みを冒頭に置いた投稿を別キャンペーンとして試し、表示・リンククリックとサイト訪問をそれぞれ記録する。',metric:'visits'};
  if(!hasOffer)return{kind:'connect_offer_measurement',title:'計測対象の広告を接続する',reason:'このページに対応する有効な広告がありません。通常の公式リンクは広告クリックとして計測しないため、クリック0回を導線の失敗とは判断しません。',action:'提携済み案件の対象製品と掲載条件を確認して有効化し、計測対象になってから導線を比較する。',metric:'eligible_clicks'};
  if(m.clicks/m.visits<GROWTH_THRESHOLDS.lowClickRate)return{kind:'test_cta',title:'記事から比較・広告への導線を試す',reason:`訪問${m.visits}件に対して広告クリック${m.clicks}回です。クリック回数/訪問数が運用目安5%未満です。これは業界基準や因果の証明ではありません。`,action:'対象者と比較基準を記事冒頭に明記し、次に確認できる条件をCTAに添える。変更内容を記録して再計測する。',metric:'click_rate'};
  if(!m.attributableClicks)return{kind:'enable_attribution',title:'成果を結び付けられる案件を確認する',reason:'クリックIDを渡せる広告クリックがありません。成果が付かないことを、成約率が低いと判断しません。',action:'ASPのサブID対応とURL変更条件を確認し、対応案件だけ計測パラメータと成果通知のclickIdを接続する。',metric:'attribution'};
  if(m.matureAttributableClicks<30||m.matureAttributableVisits<20)return{kind:'collect_conversions',title:'成約を判断できる件数を待つ',reason:`7日以上経過した成果紐付け可能クリックは${m.matureAttributableClicks}件です。クリック30件かつ異なる訪問20件の目安までは勝敗を決めません。訪問IDは人数ではありません。`,action:'ASPの承認期間と未確定成果を確認し、成熟した計測対象クリックを増やす。',metric:'conversion_rate'};
  if(m.convertedClicks===0)return{kind:'review_offer',title:'案件条件と読者の意図を確認する',reason:`成熟した計測対象クリック${m.matureAttributableClicks}件に紐付く確定成約はありません。承認待ち・通知不備・条件の不一致を切り分ける必要があります。`,action:'ASPの成果通知と承認期間を確認した後、記事で案内する対象者と申込み条件を揃える。変更は1項目ずつ記録する。',metric:'conversion_rate'};
  if(m.convertedClicks>=3&&m.convertedVisits>=3)return{kind:'expand_test',title:'成約につながった悩みで追加検証する',reason:`成熟した計測対象クリック${m.matureAttributableClicks}件のうち${m.convertedClicks}件に確定成約が紐付き、最近の需要記録があります。再現性や因果は未確定です。`,action:search?'既存ページに不足する具体例を補い、別の検索意図が確認できた場合だけ補助記事を作る。検索入口ページごとに再検証し、推薦順位は変えない。':'同じ悩みの別の具体例を追加記事・投稿の候補にし、別キャンペーンで再検証する。既存の推薦順位は変えない。',metric:'conversion_rate'};
  return{kind:'continue_test',title:'同じ条件で検証を続ける',reason:`確定成約が紐付いたクリックは${m.convertedClicks}件です。追加検証の目安3件に届いていません。`,action:'案件と記事の条件を記録したまま、追加の確定成果を待つ。',metric:'conversion_rate'};
}

export async function evaluateGrowth(env:Env,now=new Date()):Promise<GrowthEvaluation>{
  const [hyps,camps,evidence,observations,existing,report,offers]=await Promise.all([hypotheses(env),campaigns(env),records<Evidence>(env,'growth_evidence'),records<Observation>(env,'growth_observations'),records<GrowthDecision>(env,'growth_decisions'),analyticsReport(env,now),listOffers(env)]);
  const decisions:GrowthDecision[]=[];let editorial:GrowthEvaluation['editorial']=null;let bestConversions=-1;
  const activeHyps=hyps.filter(h=>h.status==='active');const organicOwners=new Map<string,string>();
  // Search terms are not available per visit. One page cohort must not become multiple query cohorts.
  for(const hyp of activeHyps)if(!organicOwners.has(hyp.targetPath))organicOwners.set(hyp.targetPath,hyp.id);
  for(const hyp of activeHyps){
    const fresh=evidence.filter(e=>e.hypothesisId===hyp.id&&evidenceIsFresh(e,now));
    const active=camps.filter(c=>c.hypothesisId===hyp.id&&c.status==='active');
    const organicRow=report.organicRows.find(row=>row.pagePath===hyp.targetPath);
    const includeOrganic=organicOwners.get(hyp.targetPath)===hyp.id&&(!active.length||Boolean(organicRow?.visits));
    for(const campaign of [...active,...(includeOrganic?[undefined]:[])]){
      const row=campaign?report.campaignRows.find(r=>r.campaignId===campaign.id):organicRow;const m=metrics(row);
      const cohort:GrowthCohort=campaign?{kind:'campaign',campaignId:campaign.id,source:campaign.source}:{kind:'organic_search_landing',targetPath:hyp.targetPath,source:'search'};
      const recentObservations=observations.filter(o=>o.campaignId===campaign?.id&&Date.parse(o.periodEnd+'T23:59:59Z')>=now.getTime()-30*DAY&&Date.parse(o.observedAt)<=now.getTime());
      const pageTool=hyp.targetPath.startsWith('/tools/')?hyp.targetPath.slice(7):null;
      const hasOffer=offers.some(offer=>isUsableOffer(offer,now.getTime())&&(pageTool?offer.id===pageTool:offer.category===hyp.category));
      const rec=recommendation(hyp,campaign,m,fresh,recentObservations.reduce((sum,o)=>sum+o.impressions,0),hasOffer);
      // Hypothesis IDs and campaign IDs are separate namespaces and may contain the same value.
      const decisionId=`${now.toISOString().slice(0,10)}:${campaign?'campaign:'+campaign.id:'organic:'+hyp.id}:${rec.kind}`;
      const legacyId=`${now.toISOString().slice(0,10)}:${campaign?.id??hyp.id}:${rec.kind}`;
      const sameIdentity=(d:GrowthDecision)=>d.hypothesisId===hyp.id&&d.campaignId===(campaign?.id??'')&&d.kind===rec.kind
        &&(!d.snapshot.cohort||(cohort.kind==='campaign'?d.snapshot.cohort.kind==='campaign'&&d.snapshot.cohort.campaignId===cohort.campaignId:d.snapshot.cohort.kind==='organic_search_landing'&&d.snapshot.cohort.targetPath===cohort.targetPath));
      const dismissedRow=await env.DB.prepare("SELECT payload_json FROM growth_decisions WHERE hypothesis_id=? AND campaign_id=? AND kind=? AND status='dismissed' ORDER BY updated_at DESC LIMIT 1").bind(hyp.id,campaign?.id??'',rec.kind).first<{payload_json:string}>();
      const dismissed=dismissedRow?JSON.parse(dismissedRow.payload_json) as GrowthDecision:undefined;
      const prior=(dismissed&&sameIdentity(dismissed)?dismissed:undefined)??existing.find(d=>sameIdentity(d)&&(d.id===decisionId||d.id===legacyId))??existing.find(d=>sameIdentity(d)&&(d.status==='proposed'||d.status==='applied'));
      const decision:GrowthDecision=prior??{id:decisionId,hypothesisId:hyp.id,campaignId:campaign?.id??'',...rec,baseline:m,snapshot:{window:report.window,thresholds:GROWTH_THRESHOLDS,evidenceIds:fresh.map(e=>e.id),evidenceStatus:fresh.some(actualDemand)?'recent_observation_not_proof':'insufficient',cohort},status:'proposed',createdAt:now.toISOString(),updatedAt:now.toISOString(),note:''};
      if(prior?.status==='proposed'){
        Object.assign(decision,rec,{baseline:m,snapshot:{window:report.window,thresholds:GROWTH_THRESHOLDS,evidenceIds:fresh.map(e=>e.id),evidenceStatus:fresh.some(actualDemand)?'recent_observation_not_proof':'insufficient',cohort},updatedAt:now.toISOString()});
        await env.DB.prepare("UPDATE growth_decisions SET payload_json=?,updated_at=? WHERE id=? AND status='proposed'").bind(JSON.stringify(decision),decision.updatedAt,decision.id).run();
      }
      if(!prior)await env.DB.prepare('INSERT OR IGNORE INTO growth_decisions(id,hypothesis_id,campaign_id,kind,status,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(decision.id,hyp.id,decision.campaignId,decision.kind,decision.status,JSON.stringify(decision),decision.createdAt,decision.updatedAt).run();
      decisions.push(decision);
      if(rec.kind==='expand_test'&&decision.status!=='dismissed'&&m.convertedClicks>bestConversions){bestConversions=m.convertedClicks;editorial={hypothesisId:hyp.id,category:hyp.category,campaignId:campaign?.id??'',reason:rec.reason,topic:`${hyp.audience}が「${hyp.pain}」を解決するために、${hyp.query}を比較する判断基準`};}
    }
  }
  return{decisions,editorial};
}
async function updateDecision(env:Env,input:Record<string,unknown>,now:Date){
  const decisionId=plain(input.id,'id',1,180);const status=plain(input.status,'status');if(!['applied','dismissed','evaluated'].includes(status))throw new GrowthError('Invalid decision status');
  const note=plain(input.note,'note',5,1500);const row=await env.DB.prepare('SELECT payload_json FROM growth_decisions WHERE id=?').bind(decisionId).first<{payload_json:string}>();if(!row)throw new GrowthError('decision_not_found',404);
  const d=JSON.parse(row.payload_json) as GrowthDecision;
  if(d.status===status){if(d.note!==note)throw new GrowthError('idempotency_conflict',409);return{decision:d};}
  if(status==='dismissed'&&d.status!=='proposed'||status==='applied'&&d.status!=='proposed'||status==='evaluated'&&d.status!=='applied')throw new GrowthError('Invalid decision transition',409);
  if(status==='applied'){
    const report=await analyticsReport(env,now);d.baseline=decisionMetrics(report,d);d.snapshot.window=report.window;d.appliedAt=now.toISOString();
  }
  if(status==='evaluated'){
    if(!d.appliedAt||now.getTime()-Date.parse(d.appliedAt)<GROWTH_THRESHOLDS.observationDays*DAY)throw new GrowthError('Observe at least 7 days after applying a change',409);
    if(now.getTime()-Date.parse(d.appliedAt)>90*DAY)throw new GrowthError('observation_window_expired',409,'実施から90日を超え、詳細計測の保存期間外です。既存の仮説を保留して新しい仮説、または新しいキャンペーンで検証を始めてください。');
    const report=await analyticsReport(env,now,new Date(d.appliedAt));const after=decisionMetrics(report,d);
    const rate=(m:GrowthMetrics)=>d.metric==='click_rate'?(m.visits>=100?m.clicks/m.visits:null):d.metric==='conversion_rate'?(m.matureAttributableClicks>=30&&m.matureAttributableVisits>=20?m.convertedClicks/m.matureAttributableClicks:null):null;
    const beforeRate=rate(d.baseline),afterRate=rate(after);let state:NonNullable<GrowthDecision['outcome']>['status']=beforeRate===null||afterRate===null?'insufficient_data':afterRate>beforeRate?'improved':afterRate<beforeRate?'declined':'unchanged';
    if(d.metric==='visits'&&after.visits>=100||d.metric==='attribution'&&after.attributableClicks>0||d.metric==='eligible_clicks'&&after.clicks>0)state='criterion_met';
    if(d.metric==='demand_evidence'){const evidence=await records<Evidence>(env,'growth_evidence');if(evidence.some(e=>e.hypothesisId===d.hypothesisId&&evidenceIsFresh(e,now)&&actualDemand(e)))state='criterion_met';}
    d.outcome={status:state,measuredAt:now.toISOString(),after,beforeRate,afterRate,note:'変更前30日と変更後の観測値の比較です。期間・流入・承認遅延の影響があり、施策の因果効果や再現性を証明しません。母数不足の場合は結論を出しません。'};
  }
  const previous=d.status;d.status=status==='evaluated'&&d.outcome?.status==='insufficient_data'?'applied':status as GrowthDecision['status'];d.note=note;d.updatedAt=now.toISOString();
  const saved=await env.DB.prepare('UPDATE growth_decisions SET status=?,payload_json=?,updated_at=? WHERE id=? AND status=?').bind(d.status,JSON.stringify(d),d.updatedAt,d.id,previous).run();if(!saved.meta.changes)throw new GrowthError('decision_changed_retry',409);return{decision:d};
}
export async function growthOverview(env:Env,now=new Date()){
  const [hyps,camps,evidence,observations,decisions]=await Promise.all([hypotheses(env),campaigns(env),records<Evidence>(env,'growth_evidence'),records<Observation>(env,'growth_observations'),records<GrowthDecision>(env,'growth_decisions',100)]);
  return{hypotheses:hyps,evidence:evidence.map(item=>({...item,fresh:evidenceIsFresh(item,now)})),campaigns:camps.map(c=>({...c,url:campaignUrl(c,env)})),observations,decisions,thresholds:GROWTH_THRESHOLDS,note:'根拠の登録は需要の証明ではありません。数値の判断基準は運用上の目安です。'};
}
export async function handleGrowth(request:Request,env:Env):Promise<Response|null>{
  const url=new URL(request.url);const path=url.pathname.replace(/\/$/,'');if(path!=='/api/admin/growth'&&!path.startsWith('/api/admin/growth/'))return null;
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32)return json({error:'not_configured'},503);
  const token=/^Bearer ([^\s]{1,512})$/.exec(request.headers.get('authorization')??'')?.[1]??'';if(!await tokenMatches(token,env.ADMIN_TOKEN))return json({error:'unauthorized'},401);
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'cross_origin'},403);
  try{
    const now=new Date();if(path==='/api/admin/growth'&&request.method==='GET')return json(await growthOverview(env,now));
    const endpoint=path.slice('/api/admin/growth/'.length);
    if(request.method==='PATCH'&&['hypotheses','campaigns'].includes(endpoint)){
      const input=await body(request),key=id(input.id),status=plain(input.status,'status');if(!['active','paused'].includes(status))throw new GrowthError('Invalid status');
      const table=endpoint==='hypotheses'?'growth_hypotheses':'growth_campaigns';const changed=await env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(status,key).run();if(!changed.meta.changes)throw new GrowthError('not_found',404);return json({ok:true,id:key,status});
    }
    if(endpoint==='decisions'&&request.method==='PATCH')return json(await updateDecision(env,await body(request),now));
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const input=await body(request);
    if(endpoint==='evaluate')return json(await evaluateGrowth(env,now));
    const handlers:Record<string,(env:Env,input:Record<string,unknown>,now:Date)=>Promise<{created:boolean}>>={hypotheses:saveHypothesis,evidence:saveEvidence,campaigns:saveCampaign,observations:saveObservation};
    const handler=handlers[endpoint];if(!handler)return json({error:'not_found'},404);const result=await handler(env,input,now);return json(result,result.created?201:200);
  }catch(error){if(error instanceof GrowthError)return json({error:error.message,...(error.detail?{message:error.detail}:{})},error.status);return json({error:'growth_storage_unavailable'},503);}
}
