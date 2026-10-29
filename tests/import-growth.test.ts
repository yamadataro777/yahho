import { describe, it, expect, vi } from 'vitest';
import { evidenceUrl, validateRecord, normalizeRecords, parseCsv, fromSearchConsole, fromResearchSuggestions, importOrigin, submitRecords } from '../scripts/import-growth.mjs';

const now = new Date('2026-10-28T12:00:00Z');
const base = { hypothesisId: 'automate-small-team', kind: 'search_console', sourceUrl: 'https://search.google.com/search-console/performance/search-analytics?resource_id=https%3A%2F%2Fshigoto.workers.dev', observedAt: '2026-10-28T10:00:00Z', summary: 'Search Console の同じ検索クエリの表示回数とクリック数を、期間指定でエクスポートしました。', query: 'Make Zapier 比較', periodStart: '2026-10-01', periodEnd: '2026-10-27', metrics: { impressions: 1234, clicks: 12 } };

describe('growth evidence import', () => {
  it('keeps provenance and deterministic identity while rejecting changed record collisions server-side', () => {
    const first = validateRecord(base, 'evidence', now);
    expect(first.id).toMatch(/^imp-[a-f0-9]{40}$/);
    expect(validateRecord({ ...base, metrics: { impressions: 1300, clicks: 13 } }, 'evidence', now).id).toBe(first.id);
    expect(first).toMatchObject({ sourceUrl: base.sourceUrl, query: base.query, metrics: base.metrics });
  });
  it('rejects future, malformed dates, reversed periods and impossible metrics', () => {
    for (const extra of [
      { observedAt: '2026-10-29T00:00:00Z' }, { observedAt: '2026-02-30T00:00:00Z' }, { periodStart: '2026-02-30' },
      { periodStart: '2026-10-28' }, { periodEnd: '2026-10-29' }, { metrics: { impressions: 1, clicks: 2 } },
      { metrics: { impressions: -1, clicks: 0 } }, { metrics: { impressions: 3.5, clicks: 0 } },
    ]) expect(() => validateRecord({ ...base, ...extra }, 'evidence', now)).toThrow();
  });
  it('refuses credentials, private sources and ambiguous origins before sending any token', () => {
    for (const url of ['https://user:password@www.google.com/', 'http://www.google.com/', 'https://127.0.0.1/', 'https://www.google.com/#token', 'https://docs.internal/', 'https://www.google.com:8443/']) expect(() => evidenceUrl(url)).toThrow();
    expect(importOrigin('https://shigoto.workers.dev/')).toBe('https://shigoto.workers.dev');
    expect(importOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    for (const url of ['https://example.com/', 'http://shigoto.workers.dev/', 'https://user:password@shigoto.workers.dev/', 'https://shigoto.workers.dev/path', 'https://shigoto.workers.dev/?target=x', 'http://127.0.0.2:8787']) expect(() => importOrigin(url)).toThrow();
  });
  it('rejects duplicate IDs and overlapping periods without conflating separate queries', () => {
    expect(() => normalizeRecords([base, base], 'evidence', now)).toThrow('Duplicate');
    expect(() => normalizeRecords([base, { ...base, periodStart: '2026-10-15', periodEnd: '2026-10-20' }], 'evidence', now)).toThrow('overlap');
    expect(normalizeRecords([base, { ...base, query: '別の検索語' }], 'evidence', now)).toHaveLength(2);
  });
  it('parses actual quoted Search Console CSV with an explicit date range and exact query', () => {
    const csv = '\uFEFFTop queries,Clicks,Impressions,CTR,Position\r\n"Make Zapier 比較",12,"1,234",0.97%,5.2\r\nOther,2,20,10%,2\r\n';
    const records = fromSearchConsole(csv, base, now);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'search_console', query: base.query, metrics: { impressions: 1234, clicks: 12 }, periodStart: base.periodStart });
    expect(fromSearchConsole('上位のクエリ,クリック数,表示回数\nMake Zapier 比較,12,1234\n', base, now)[0].id).toBe(records[0].id);
  });
  it('rejects ambiguous CSV and missing exact query without manufacturing an aggregate', () => {
    expect(() => parseCsv('a,b\n"broken,quote')).toThrow('Unclosed');
    expect(() => parseCsv('a,b\n1,2,3')).toThrow('consistent');
    expect(() => fromSearchConsole('query,clicks,impressions\nOther,1,2\n', base, now)).toThrow('exactly one');
    expect(() => fromSearchConsole('query,clicks,impressions\nMake Zapier 比較,1,2\nMake Zapier 比較,2,3\n', base, now)).toThrow('exactly one');
    expect(() => fromSearchConsole('query,clicks,impressions\nMake Zapier 比較,1,2K\n', base, now)).toThrow('whole');
  });
  it('requires real successful suggestion observation and never produces volume metrics', () => {
    const report = { schemaVersion: 1, suggestions: [{ query: base.query, requestedUrl: 'https://suggestqueries.google.com/complete/search?client=firefox&q=Make+Zapier+%E6%AF%94%E8%BC%83', checkedAt: base.observedAt, fetchStatus: 'fetched', suggestions: ['Make Zapier 比較 無料', 'Make Zapier 比較 無料'] }] };
    const [record] = fromResearchSuggestions(report, base, now);
    expect(record.kind).toBe('suggestion'); expect(record.metrics).toBeUndefined();
    expect(record.summary).toContain('検索数・購買意欲・売上を示す測定値ではありません');
    for (const extra of [{ fetchStatus: 'unavailable' }, { suggestions: [] }, { requestedUrl: 'https://www.google.com/' }]) {
      expect(() => fromResearchSuggestions({ ...report, suggestions: [{ ...report.suggestions[0], ...extra }] }, base, now)).toThrow();
    }
    expect(() => validateRecord({ ...record, metrics: { impressions: 100, clicks: 1 } }, 'evidence', now)).toThrow();
  });
  it('keeps campaign observations separate and prevents overlap even if source URLs differ', () => {
    const record = { campaignId: 'threads-workflow', sourceUrl: 'https://www.threads.net/', observedAt: base.observedAt, periodStart: base.periodStart, periodEnd: base.periodEnd, impressions: 100, clicks: 3 };
    expect(validateRecord(record, 'observations', now)).toMatchObject({ campaignId: record.campaignId, impressions: 100, clicks: 3 });
    expect(() => normalizeRecords([record, { ...record, sourceUrl: 'https://www.threads.com/' }], 'observations', now)).toThrow('overlap');
  });
  it('stops a partial import on server conflict and never follows a redirect', async () => {
    const records = normalizeRecords([base, { ...base, query: '違う検索語' }], 'evidence', now);
    const send = vi.fn().mockResolvedValueOnce({ status: 201 }).mockResolvedValueOnce({ status: 409 });
    await expect(submitRecords(records, 'evidence', send)).rejects.toThrow('HTTP 409');
    expect(send).toHaveBeenCalledTimes(2);
    const redirect = vi.fn(async () => ({ status: 302 }));
    await expect(submitRecords(records, 'evidence', redirect)).rejects.toThrow('HTTP 302');
    expect(redirect).toHaveBeenCalledTimes(1);
  });
  it('reports duplicates separately from newly imported records', async () => {
    const result = await submitRecords([{}, {}], 'evidence', vi.fn().mockResolvedValueOnce({ status: 201 }).mockResolvedValueOnce({ status: 200 }));
    expect(result).toEqual({ imported: 1, duplicate: 1 });
  });
});
