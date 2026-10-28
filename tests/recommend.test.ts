import {describe,it,expect} from 'vitest';
import {recommendTools,parseRecommendationInput} from '../src/recommend';
import {TOOLS,ARTICLES,SOURCES} from '../src/content';
describe('use case recommendations',()=>{
 it('puts actual workflow tools first for automation',()=>{expect(recommendTools({useCase:'automation',budget:'paid',team:'team'}).slice(0,2).map(r=>r.tool.id)).toEqual(['make','zapier']);});
 it('does not call a writing tool a meeting transcription service',()=>{const r=recommendTools({useCase:'meeting',budget:'free',team:'solo'});expect(r[0].tool.id).toBe('notta');expect(r[1].reasons[0]).toContain('専門ツールの代わりになるとは限りません');});
 it('explains budget and collaboration constraints without invented prices',()=>{expect(recommendTools({useCase:'design',budget:'free',team:'team'})[0].reasons.join('')).toContain('無料枠・試用');expect(recommendTools({useCase:'design',budget:'paid',team:'solo'})[0].reasons.join('')).toContain('有料プラン');});
 it.each([null,{},[],{useCase:'crypto',budget:'free',team:'solo'},{useCase:'writing',budget:'invalid',team:'solo'},{useCase:'writing',budget:['free'],team:'solo'},{useCase:'writing',budget:'free',team:['solo']}])('rejects malformed inputs %j',value=>expect(()=>parseRecommendationInput(value)).toThrow());
 it('all tools and original guides have valid official source references',()=>{const ids=new Set(SOURCES.map(s=>s.id));expect(ARTICLES.length).toBeGreaterThanOrEqual(6);expect(new Set(ARTICLES.map(a=>a.slug)).size).toBe(ARTICLES.length);for(const t of TOOLS)expect(ids.has(t.sourceId)).toBe(true);for(const a of ARTICLES){expect(a.sections.length).toBeGreaterThanOrEqual(4);for(const id of a.sourceIds)expect(ids.has(id)).toBe(true);}});
});
