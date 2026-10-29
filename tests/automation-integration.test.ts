import { it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { runAutomation } from '../src/automation';
import { listArticles, listOffers } from '../src/store';
import { SOURCES } from '../src/content';
import type { Env, Offer } from '../src/types';

const alphaQuote = 'The design workspace provides templates for creating and sharing visual documents.';
const betaQuote = 'The creative editor supports preparing images and other materials for communication.';

function article() {
  const sections = [
    { heading: '仕事の詰まりを言葉にする', paragraphs: ['道具を増やす前に、いま手間がかかっている作業を整理しましょう。資料を探す時間なのか、作成した内容を共有する手間なのかで、確認する機能は変わります。サービス名だけで選ぶと、使い始めてから期待した役割と異なることに気づきます。担当者が迷う場面を具体的に書き、試す作業を決めると比較しやすくなります。', '情報をまとめる仕事では、入力する場所だけでなく、誰が更新するかも大切です。複数の場所に似た資料があるなら、まず正しい版を確認する手順を決めましょう。道具に作業を合わせる前に、チームが守れる運用を考えると、選択肢を絞る理由がはっきりします。今の方法で困っていない部分まで急いで変える必要はありません。'] },
    { heading: '用途に合う比較軸を作る', paragraphs: ['個人で下書きを進める場合と、チームで承認する場合では、必要な確認項目が異なります。公式ページの機能説明を読み、作成から共有までの流れに必要な役割を書き出してください。便利そうな機能が多く見えても、実際の作業で使うかは別の問題です。普段の資料に近い小さなサンプルを使い、迷う箇所を確かめると判断できます。', '連携を重視するなら、普段使うサービスの名称だけでなく、連携できる操作の範囲を確認しましょう。情報の受け渡しが片方向か、修正した内容が反映されるかでも使い勝手は変わります。想定した操作が使えることを確かめてから、運用に組み込むかを決めてください。公式資料に記載がない部分を、使える前提で見積もらないことが大切です。'] },
    { heading: '試す範囲を小さく決める', paragraphs: ['最初から仕事全体を移さず、失敗しても戻せる作業を選びましょう。公開しても問題のないサンプルを用意し、担当者が同じ手順を試せる状態にします。操作が完了したかだけでなく、出来上がったものを次の人が理解できるかも確認してください。使う人の役割が異なる場合は、作成する側と確認する側の両方から感想を集めると判断しやすくなります。', '試した後は、よかった点と手間が増えた点を同じ場所に記録してください。新しさだけで導入を決めると、運用が始まってから管理の負担に気づくことがあります。現在のやり方を続ける選択肢も残し、改善したい作業が実際に進めやすくなったかで比較しましょう。道具を選ぶことより、仕事を無理なく進められることを優先してください。'] },
    { heading: '注意点と導入前に確認する条件', paragraphs: ['契約前には、最新の仕様や利用条件を公式サイトで確認してください。この記事は実際に各サービスを利用した検証結果を示すものではありません。機能や提供条件は変更されることがあるため、必要な項目を自分たちの作業に照らして確かめる必要があります。機密情報や個人情報を扱う場合は、組織の方針や提供元の説明に沿って利用の可否を判断しましょう。', '導入を決めた後も、担当者が不在になった場合の引き継ぎや、利用をやめるときのデータの扱いを確認しておくと安心です。管理の仕組みが合わなければ、便利な機能があっても使い続けることが難しくなります。比較した理由を記録しておけば、条件が変わったときも見直しやすくなります。まずは困っている作業を整理し、公式の情報と照らし合わせてください。'] },
  ];
  return { title: '仕事の道具を増やす前に、用途と運用の違いを整理する', description: '個人と小規模チームで道具を選ぶときに、作業の詰まり、共有方法、運用負担を整理するためのガイドです。', offerCategory: 'design', sourceIds: ['canva', 'adobe-express'], evidenceQuotes: [{ sourceId: 'canva', quote: alphaQuote }, { sourceId: 'adobe-express', quote: betaQuote }], sections };
}

it('runs the publication, maintenance and daily locking pipeline against the actual SQLite migration', async () => {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  function statement(query: string, values: unknown[] = []) {
    return {
      bind(...args: unknown[]) { return statement(query, args); },
      async first() { return db.prepare(query).get(...values as any[]) ?? null; },
      async all() { return { results: db.prepare(query).all(...values as any[]), success: true, meta: {} }; },
      async run() { const result = db.prepare(query).run(...values as any[]); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }
  try {
    const now = new Date('2026-10-28T03:00:00Z');
    const expired: Offer = {
      id: 'expired-partner', name: 'Expired affiliate', category: 'design', description: 'Previously verified partner offer.',
      url: 'https://px.a8.net/svt/ejp?a8mat=already-approved', enabled: true, allowedHosts: ['px.a8.net'],
      verifiedAt: '2025-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z',
    };
    db.prepare('INSERT INTO offers(id, category, enabled, offer_json, updated_at) VALUES(?, ?, ?, ?, ?)')
      .run(expired.id, expired.category, 1, JSON.stringify(expired), '2025-01-01T00:00:00Z');
    const insertEvent = db.prepare("INSERT INTO events(day, kind, variant, count) VALUES(?, 'diagnosis', ?, ?)");
    insertEvent.run('2025-09-22', 'writing', 80); // older than 400 days, must be deleted
    insertEvent.run('2025-09-23', 'writing', 2); // cutoff boundary, must be retained
    insertEvent.run('2026-10-27', 'design', 40); // observed reader need drives source selection
    insertEvent.run('2026-10-29', 'writing', 100); // future record must not affect the 30-day window

    const canva = SOURCES.find(source => source.id === 'canva')!;
    const adobe = SOURCES.find(source => source.id === 'adobe-express')!;
    const sourcePages = new Map([
      [canva.url, alphaQuote + ' Additional official information about preparation and collaboration. '.repeat(6)],
      [adobe.url, betaQuote + ' Product documentation describes supported creative workflows and sharing. '.repeat(6)],
    ]);
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(href);
      const parsed = new URL(href);
      if (![new URL(canva.url).hostname, new URL(adobe.url).hostname].includes(parsed.hostname)) throw new Error('Unexpected external destination');
      if (parsed.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
      const content = sourcePages.get(href);
      if (!content) throw new Error('Unexpected source URL');
      return new Response(content, { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    const ai = vi.fn(async () => ({ response: JSON.stringify(article()) }));
    const env = {
      DB: { prepare: (query: string) => statement(query) },
      AI: { run: ai }, ENABLE_AUTOPUBLISH: 'true', MAX_DAILY_ARTICLES: '1',
    } as unknown as Env;

    const first = await runAutomation(env, { now, fetcher });
    expect(first.status).toBe('completed');
    expect(first.generation).toEqual({ status: 'published', slug: 'guide-2026-10-28-design', reasons: [] });
    expect(first.editorial).toEqual({ basis: 'diagnoses_30d', category: 'design', diagnoses: 40, sourceIds: ['canva', 'adobe-express'] });
    expect(first.disabledOffers).toBe(1);
    expect(first.socialDrafts).toEqual([]);
    const published = (await listArticles(env)).find(item => item.slug === first.generation.slug);
    expect(published?.title).toBe(article().title);
    expect(published?.sourceIds).toEqual(['canva', 'adobe-express']);
    expect(db.prepare("SELECT status, origin FROM articles WHERE slug = ?").get(first.generation.slug!))
      .toMatchObject({ status: 'published', origin: 'automation' });
    expect(db.prepare('SELECT day FROM events ORDER BY day').all().map(row => row.day))
      .toEqual(['2025-09-23', '2026-10-27', '2026-10-29']);
    expect(db.prepare('SELECT enabled FROM offers WHERE id = ?').get(expired.id)?.enabled).toBe(0);
    expect((await listOffers(env))[0].enabled).toBe(false);
    expect(db.prepare('SELECT source_id, ok, content_hash FROM source_checks').all()).toHaveLength(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_checks WHERE ok = 1 AND length(content_hash) = 64').get()?.n).toBe(2);

    const second = await runAutomation(env, { now, fetcher });
    expect(second.status).toBe('duplicate');
    expect(ai).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM articles').get()?.n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM automation_runs').get()?.n).toBe(1);
    expect(db.prepare("SELECT status FROM automation_runs WHERE id = 'daily:2026-10-28'").get()?.status).toBe('completed');
    expect(requested).toHaveLength(4); // two robots and two source pages; no second run fetches
    expect(requested.some(url => url.includes('px.a8.net'))).toBe(false);
  } finally { db.close(); }
});
