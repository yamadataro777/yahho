import { CATEGORIES, TOOLS, type CategoryId, type Tool } from './content';
export interface RecommendationInput {useCase:CategoryId;budget:'free'|'paid';team:'solo'|'team'}
export interface Recommendation {tool:Tool;score:number;reasons:string[]}
export function parseRecommendationInput(value:unknown):RecommendationInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid input');
 const v=value as Record<string,unknown>;
 if(!CATEGORIES.some(c=>c.id===v.useCase)||typeof v.budget!=='string'||typeof v.team!=='string'||!['free','paid'].includes(v.budget)||!['solo','team'].includes(v.team))throw new Error('Invalid selection');
 return {useCase:v.useCase as CategoryId,budget:v.budget as RecommendationInput['budget'],team:v.team as RecommendationInput['team']};
}
export function recommendTools(input:RecommendationInput):Recommendation[]{
 const valid=parseRecommendationInput(input);
 const adjacent:Record<CategoryId,CategoryId[]>={writing:['knowledge'],meeting:['knowledge','writing'],design:['writing'],automation:['knowledge'],knowledge:['writing']};
 return TOOLS.filter(t=>t.category===valid.useCase||adjacent[valid.useCase].includes(t.category)).map(tool=>{
  const direct=tool.category===valid.useCase;
  const reasons=[direct?`「${CATEGORIES.find(c=>c.id===valid.useCase)!.label}」という目的に合う機能を持つ候補です。`:'主目的を補う、整理・下書きのための候補です。専門ツールの代わりになるとは限りません。'];
  reasons.push(valid.budget==='free'?'無料枠・試用の対象範囲を公式ページで確認してから、小さな仕事で試してください。':'必要な機能と利用量を整理し、有料プランの条件と費用を照合してください。');
  const teamMatch=['notion','canva','make','zapier','notta'].includes(tool.id);
  reasons.push(valid.team==='team'?'共同作業の権限・共有方法・メンバー単位の課金条件を確認しましょう。':'普段の作業をひとつ選び、設定と確認にかかる手間まで含めて試しましょう。');
  return {tool,score:(direct?100:35)+(valid.team==='team'&&teamMatch?8:0),reasons};
 }).sort((a,b)=>b.score-a.score||a.tool.id.localeCompare(b.tool.id)).slice(0,3);
}
