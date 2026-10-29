import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../src/types';

vi.mock('../src/content', () => ({
  SOURCES: [
    { id: 'alpha', label: 'Alpha official', url: 'https://alpha.test/product' },
    { id: 'beta', label: 'Beta official', url: 'https://beta.test/product' },
  ],
  TOOLS: [{ id: 'alpha', sourceId: 'alpha', category: 'writing' }, { id: 'beta', sourceId: 'beta', category: 'knowledge' }],
  ARTICLES: [{ slug: 'choose-tools', description: '毎日の仕事に合う道具を選ぶために、用途と運用を整理します。' }],
}));

import { robotsAllows, runAutomation, validateGeneratedArticle } from '../src/automation';

const alphaQuote = 'Alpha provides a workspace for planning and organizing work.';
const betaQuote = 'Beta supports creating documents and sharing them with a team.';
const sourceTexts = new Map([
  ['alpha', alphaQuote + ' '.repeat(1) + 'Detailed information about workflows and collaboration. '.repeat(8)],
  ['beta', betaQuote + ' '.repeat(1) + 'Product features should be checked before selecting a service. '.repeat(8)],
]);

function article() {
  const sections = [
    { heading: '仕事の詰まりを言葉にする', paragraphs: ['道具を増やす前に、いま手間がかかっている作業を整理しましょう。資料を探す時間なのか、作成した内容を共有する手間なのかで、確認する機能は変わります。サービス名だけで選ぶと、使い始めてから期待した役割と異なることに気づきます。担当者が迷う場面を具体的に書き、試す作業を決めると比較しやすくなります。', '情報をまとめる仕事では、入力する場所だけでなく、誰が更新するかも大切です。複数の場所に似た資料があるなら、まず正しい版を確認する手順を決めましょう。道具に作業を合わせる前に、チームが守れる運用を考えると、選択肢を絞る理由がはっきりします。今の方法で困っていない部分まで急いで変える必要はありません。'] },
    { heading: '用途に合う比較軸を作る', paragraphs: ['個人で下書きを進める場合と、チームで承認する場合では、必要な確認項目が異なります。公式ページの機能説明を読み、作成から共有までの流れに必要な役割を書き出してください。便利そうな機能が多く見えても、実際の作業で使うかは別の問題です。普段の資料に近い小さなサンプルを使い、迷う箇所を確かめると判断できます。', '連携を重視するなら、普段使うサービスの名称だけでなく、連携できる操作の範囲を確認しましょう。情報の受け渡しが片方向か、修正した内容が反映されるかでも使い勝手は変わります。想定した操作が使えることを確かめてから、運用に組み込むかを決めてください。公式資料に記載がない部分を、使える前提で見積もらないことが大切です。'] },
    { heading: '試す範囲を小さく決める', paragraphs: ['最初から仕事全体を移さず、失敗しても戻せる作業を選びましょう。公開しても問題のないサンプルを用意し、担当者が同じ手順を試せる状態にします。操作が完了したかだけでなく、出来上がったものを次の人が理解できるかも確認してください。使う人の役割が異なる場合は、作成する側と確認する側の両方から感想を集めると判断しやすくなります。', '試した後は、よかった点と手間が増えた点を同じ場所に記録してください。新しさだけで導入を決めると、運用が始まってから管理の負担に気づくことがあります。現在のやり方を続ける選択肢も残し、改善したい作業が実際に進めやすくなったかで比較しましょう。道具を選ぶことより、仕事を無理なく進められることを優先してください。'] },
    { heading: '注意点と導入前に確認する条件', paragraphs: ['契約前には、最新の仕様や利用条件を公式サイトで確認してください。この記事は実際に各サービスを利用した検証結果を示すものではありません。機能や提供条件は変更されることがあるため、必要な項目を自分たちの作業に照らして確かめる必要があります。機密情報や個人情報を扱う場合は、組織の方針や提供元の説明に沿って利用の可否を判断しましょう。', '導入を決めた後も、担当者が不在になった場合の引き継ぎや、利用をやめるときのデータの扱いを確認しておくと安心です。管理の仕組みが合わなければ、便利な機能があっても使い続けることが難しくなります。比較した理由を記録しておけば、条件が変わったときも見直しやすくなります。まずは困っている作業を整理し、公式の情報と照らし合わせてください。'] },
  ];
  return { title: '仕事の道具を増やす前に、用途と運用の違いを整理する', description: '個人と小規模チームで道具を選ぶときに、作業の詰まり、共有方法、運用負担を整理するためのガイドです。', offerCategory: 'knowledge', sourceIds: ['alpha', 'beta'], evidenceQuotes: [{ sourceId: 'alpha', quote: alphaQuote }, { sourceId: 'beta', quote: betaQuote }], sections };
}

class MemoryDb {
  locks = new Set<string>();
  insertedArticles: unknown[][] = [];
  sourceChecks: unknown[][] = [];
  retentionCutoffs: unknown[] = [];
  diagnosisTotals: { variant: string; diagnoses: number }[] = [];
  prepare(sql: string) {
    let args: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) { args = values; return this; },
      async run() {
        if (sql.startsWith('INSERT OR IGNORE INTO automation_runs')) {
          const id = String(args[0]); const changes = self.locks.has(id) ? 0 : 1; self.locks.add(id); return { meta: { changes } };
        }
        if (sql.startsWith('DELETE FROM events')) self.retentionCutoffs.push(args[0]);
        if (sql.startsWith('INSERT INTO articles')) self.insertedArticles.push(args);
        if (sql.startsWith('INSERT INTO source_checks')) self.sourceChecks.push(args);
        return { meta: { changes: 1 } };
      },
      async all() { return { results: sql.startsWith('SELECT variant, SUM(count)') ? self.diagnosisTotals : [] }; },
      async first() { return { total: self.insertedArticles.length }; },
    };
  }
}
function sourceFetcher() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'Content-Type': 'text/plain' } });
    return new Response(sourceTexts.get(url.hostname.startsWith('alpha') ? 'alpha' : 'beta'), { headers: { 'Content-Type': 'text/html' } });
  }) as unknown as typeof fetch;
}
function environment(db: MemoryDb, additions: Partial<Env> = {}): Env { return { DB: db as unknown as D1Database, ASSETS: {} as Fetcher, ...additions }; }
const now = new Date('2026-10-28T03:00:00Z');

describe('official crawler policy', () => {
  it('honors allow precedence and a crawler-specific disallow', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/help', '/private/help')).toBe(true);
    expect(robotsAllows('User-agent: *\nAllow: /\nUser-agent: ShigotoDouguBot\nDisallow: /', '/product')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*?secret=', '/x?secret=hello')).toBe(false);
  });
});

describe('grounded article validation', () => {
  it('accepts a substantial guide with genuine quotes from both checked sources', () => {
    const result = validateGeneratedArticle(article(), sourceTexts, '2026-10-28');
    expect(result.reasons).toEqual([]);
    expect(result.article?.slug).toBe('guide-2026-10-28-knowledge');
  });
  it('rejects unknown sources, invented quotes, thin prose, and performance promises', () => {
    const unknown = article(); unknown.sourceIds[0] = 'untrusted';
    expect(validateGeneratedArticle(unknown, sourceTexts, '2026-10-28').reasons).toContain('unverified_source');
    const invented = article(); invented.evidenceQuotes[0].quote = 'A fabricated quotation not present on the official page';
    expect(validateGeneratedArticle(invented, sourceTexts, '2026-10-28').reasons).toContain('evidence_quote_missing');
    const price = article(); price.sections[0].paragraphs[0] += '月額100円で導入できます。';
    expect(validateGeneratedArticle(price, sourceTexts, '2026-10-28').reasons).toContain('unsupported_price_performance_or_testimonial');
    expect(validateGeneratedArticle({ title: 'small' }, sourceTexts, '2026-10-28').article).toBeUndefined();
    expect(validateGeneratedArticle(null, sourceTexts, '2026-10-28').reasons).toEqual(['invalid_json_object']);
  });
});

describe('daily automation orchestration', () => {
  it('checks sources without AI and reports skipped generation honestly', async () => {
    const db = new MemoryDb();
    const result = await runAutomation(environment(db), { now, fetcher: sourceFetcher() });
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every(s => s.ok)).toBe(true);
    expect(result.generation.status).toBe('skipped');
    expect(result.generation.reasons).toContain('workers_ai_not_configured');
    expect(db.insertedArticles).toHaveLength(0);
    expect(db.retentionCutoffs).toEqual(['2025-09-23']);
    expect(result.socialDrafts).toEqual([]);
  });
  it('creates an editorial social draft only after explicit opt-in, without social requests', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1', 'true']) {
      const fetcher = sourceFetcher();
      const result = await runAutomation(environment(new MemoryDb(), { ENABLE_SOCIAL_DRAFTS: flag, MAX_DAILY_ARTICLES: '0' }), { now, fetcher });
      expect(result.socialDrafts).toHaveLength(flag === 'true' ? 1 : 0);
      if (flag === 'true') expect(result.socialDrafts[0]).toMatchObject({ articleSlug: 'choose-tools', link: '/guides/choose-tools' });
      expect(result.checks).toHaveLength(2);
      expect(fetcher).toHaveBeenCalledTimes(4); // two robots files and two source pages only
      expect(result.generation.status).toBe('skipped');
    }
  });
  it('uses sufficiently observed reader needs to choose sources, without using revenue', async () => {
    const db = new MemoryDb();
    db.diagnosisTotals = [{ variant: 'knowledge', diagnoses: 44 }];
    const result = await runAutomation(environment(db), { now, fetcher: sourceFetcher() });
    expect(result.editorial).toEqual({ basis: 'diagnoses_30d', category: 'knowledge', diagnoses: 44, sourceIds: ['beta', 'alpha'] });
    expect(result.checks.map(check => check.sourceId)).toEqual(['beta', 'alpha']);
    const sparse = new MemoryDb();
    sparse.diagnosisTotals = [{ variant: 'writing', diagnoses: 29 }];
    const fallback = await runAutomation(environment(sparse), { now, fetcher: sourceFetcher() });
    expect(fallback.editorial.basis).toBe('rotation');
  });
  it('defaults to draft and cannot generate twice on the same UTC date', async () => {
    const db = new MemoryDb(); const ai = vi.fn(async () => ({ response: JSON.stringify(article()) })); const fetcher = sourceFetcher();
    const env = environment(db, { AI: { run: ai } });
    const first = await runAutomation(env, { now, fetcher });
    expect(first.generation.status).toBe('draft');
    expect(db.insertedArticles[0][2]).toBe('draft');
    const second = await runAutomation(env, { now, fetcher });
    expect(second.status).toBe('duplicate');
    expect(ai).toHaveBeenCalledTimes(1);
    expect(db.insertedArticles).toHaveLength(1);
  });
  it('publishes only when explicitly enabled and all quality gates pass', async () => {
    const db = new MemoryDb();
    const result = await runAutomation(environment(db, { ENABLE_AUTOPUBLISH: 'true', AI: { run: async () => ({ response: article() }) } }), { now, fetcher: sourceFetcher() });
    expect(result.generation.status).toBe('published');
    expect(db.insertedArticles[0][2]).toBe('published');
  });
  it('does not call the model if robots disallows collection', async () => {
    const db = new MemoryDb(); const ai = vi.fn();
    const fetcher = vi.fn(async () => new Response('User-agent: *\nDisallow: /', { headers: { 'Content-Type': 'text/plain' } })) as unknown as typeof fetch;
    const result = await runAutomation(environment(db, { AI: { run: ai } }), { now, fetcher });
    expect(result.generation.reasons).toContain('insufficient_fresh_sources');
    expect(result.checks.every(s => s.error === 'robots_disallowed')).toBe(true);
    expect(ai).not.toHaveBeenCalled();
  });
  it('blocks cross-host redirects before they can be fetched', async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requested.push(input);
      return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } });
    }) as unknown as typeof fetch;
    const result = await runAutomation(environment(new MemoryDb()), { now, fetcher });
    expect(result.checks.every(s => s.error === 'source_redirect_blocked')).toBe(true);
    expect(requested.every(s => !s.includes('169.254'))).toBe(true);
  });
  it('does not follow same-host redirects into paths disallowed by robots', async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requested.push(input);
      if (input.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private');
      return new Response(null, { status: 302, headers: { Location: '/private' } });
    }) as unknown as typeof fetch;
    const result = await runAutomation(environment(new MemoryDb()), { now, fetcher });
    expect(result.checks.every(s => s.error === 'robots_redirect_disallowed')).toBe(true);
    expect(requested.some(s => s.endsWith('/private'))).toBe(false);
  });
  it('bounds model waiting and records timeout without publishing', async () => {
    vi.useFakeTimers();
    try {
      const started = Promise.withResolvers<void>();
      const db = new MemoryDb();
      const pending = runAutomation(environment(db, { ENABLE_AUTOPUBLISH: 'true', AI: { run: () => { started.resolve(); return new Promise(() => {}); } } }), { now, fetcher: sourceFetcher() });
      await started.promise;
      await vi.advanceTimersByTimeAsync(45_000);
      const result = await pending;
      expect(result.status).toBe('failed');
      expect(result.generation.reasons).toEqual(['workers_ai_timeout']);
      expect(db.insertedArticles).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it('rejects malformed AI output and honors a disabled article budget', async () => {
    const malformed = await runAutomation(environment(new MemoryDb(), { AI: { run: async () => ({ response: 'not valid JSON' }) }, ENABLE_AUTOPUBLISH: 'true' }), { now, fetcher: sourceFetcher() });
    expect(malformed.generation.status).toBe('rejected');
    const ai = vi.fn();
    const disabled = await runAutomation(environment(new MemoryDb(), { MAX_DAILY_ARTICLES: '0', AI: { run: ai } }), { now, fetcher: sourceFetcher() });
    expect(disabled.generation.reasons).toContain('daily_article_budget_disabled');
    expect(ai).not.toHaveBeenCalled();
  });
});
