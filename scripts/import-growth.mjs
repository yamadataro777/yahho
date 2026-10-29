#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSiteOrigin } from '../src/site-config.ts';

const MAX_BYTES = 512_000;
const MAX_ROWS = 200;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const KINDS = new Set(['customer_quote', 'search_console', 'suggestion', 'competitor', 'official_page']);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = message => { throw new Error(message); };
function plain(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u001f\u007f<>]/.test(value)) fail(`Invalid ${label}.`);
  return value.trim();
}
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`Invalid ${label}.`); return value; }
function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`Invalid ${label}.`);
  return value;
}
function observed(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now.getTime()) fail('observedAt must be a real, nonfuture ISO timestamp.');
  isoDate(value.slice(0, 10), 'observedAt calendar date');
  return new Date(value).toISOString();
}
export function evidenceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) fail('Invalid sourceUrl.');
  let url; try { url = new URL(value); } catch { fail('Invalid sourceUrl.'); }
  if (!publicSiteOrigin(url.origin) || url.username || url.password || url.hash || url.port) fail('sourceUrl must be a public HTTPS reference without credentials or fragments.');
  return url.href;
}
function counts(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)
    || !Number.isSafeInteger(metrics.impressions) || !Number.isSafeInteger(metrics.clicks)
    || metrics.impressions < 0 || metrics.clicks < 0 || metrics.clicks > metrics.impressions || metrics.impressions > 1_000_000_000) fail('Counts must be integers with 0 <= clicks <= impressions <= 1000000000.');
  return { impressions: metrics.impressions, clicks: metrics.clicks };
}
function period(input, observedAt) {
  const periodStart = isoDate(input.periodStart, 'periodStart'), periodEnd = isoDate(input.periodEnd, 'periodEnd');
  if (periodStart > periodEnd || periodEnd > observedAt.slice(0, 10) || (Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000 > 365) fail('Invalid or overlapping reporting period; maximum inclusive period is 366 days.');
  return { periodStart, periodEnd };
}
function stableId(record, route) {
  // Identity is independent of reported counts: changed exports conflict on the server
  // instead of creating a second observation for the same period.
  const key = route === 'observations'
    ? [record.campaignId, record.sourceUrl, record.periodStart, record.periodEnd]
    : [record.hypothesisId, record.kind, record.sourceUrl, record.query || '', record.periodStart || '', record.periodEnd || '', record.periodStart ? '' : record.observedAt, record.periodStart ? '' : record.summary];
  return 'imp-' + createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 40);
}
export function validateRecord(input, route = 'evidence', now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['evidence', 'observations'].includes(route)) fail('Invalid import record.');
  const record = { sourceUrl: evidenceUrl(input.sourceUrl), observedAt: observed(input.observedAt, now) };
  if (route === 'observations') {
    record.campaignId = id(input.campaignId, 'campaignId');
    Object.assign(record, period(input, record.observedAt), counts(input));
  } else {
    record.hypothesisId = id(input.hypothesisId, 'hypothesisId');
    if (!KINDS.has(input.kind)) fail('Invalid evidence kind.');
    record.kind = input.kind;
    record.summary = plain(input.summary, 'summary', 20, 2000);
    if (input.query !== undefined) record.query = plain(input.query, 'query', 1, 200);
    if (record.kind === 'search_console') {
      if (!record.query) fail('search_console requires the observed query.');
      Object.assign(record, period(input, record.observedAt));
      record.metrics = counts(input.metrics);
    } else if (input.metrics !== undefined || input.periodStart !== undefined || input.periodEnd !== undefined) fail('Only search_console evidence accepts count metrics and reporting periods.');
  }
  record.id = input.id === undefined ? stableId(record, route) : id(input.id, 'id');
  return record;
}
export function normalizeRecords(records, route = 'evidence', now = new Date()) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_ROWS) fail(`Import must contain 1–${MAX_ROWS} records.`);
  const result = records.map(record => validateRecord(record, route, now));
  const seen = new Map();
  for (const record of result) {
    if (seen.has(record.id)) fail('Duplicate record ID in import.');
    seen.set(record.id, true);
  }
  for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) {
    const left = result[a], right = result[b];
    const sameKey = route === 'observations' ? left.campaignId === right.campaignId
      : left.kind === 'search_console' && right.kind === 'search_console' && left.hypothesisId === right.hypothesisId && left.query === right.query;
    if (sameKey && left.periodStart <= right.periodEnd && right.periodStart <= left.periodEnd) fail('Reporting periods overlap within this import.');
  }
  return result;
}
export function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('CSV exceeds 512000 bytes.');
  const rows = []; let row = [], field = '', quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  function emitField() { row.push(field); field = ''; afterQuote = false; }
  function emitRow() { emitField(); if (row.some(value => value !== '')) rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) fail('CSV has too many rows.'); }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === ',') emitField();
    else if (char === '\n') emitRow();
    else if (char === '\r') { if (text[i + 1] === '\n') i++; emitRow(); }
    else if (char === '"' && field === '' && !afterQuote) quoted = true;
    else if (afterQuote || char === '"') fail('Malformed CSV quoting.');
    else field += char;
  }
  if (quoted) fail('Unclosed CSV quote.');
  if (field || row.length || afterQuote) emitRow();
  if (!rows.length || rows.some(row => row.length !== rows[0].length)) fail('CSV rows must have consistent columns.');
  return rows;
}
function csvInteger(value) {
  const original = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(original)) fail('CSV counts must be whole numbers; abbreviations are unsupported.');
  return Number(original.replace(/,/g, ''));
}
export function fromSearchConsole(text, options, now = new Date()) {
  const rows = parseCsv(text), headers = rows.shift().map(value => value.trim().toLowerCase());
  const index = names => headers.findIndex(header => names.includes(header));
  const queryIndex = index(['top queries', 'query', 'queries', '上位のクエリ', 'クエリ']);
  const impressionsIndex = index(['impressions', '表示回数']); const clicksIndex = index(['clicks', 'クリック数']);
  if ([queryIndex, impressionsIndex, clicksIndex].some(value => value < 0)) fail('CSV requires query, impressions, and clicks columns.');
  const query = plain(options.query, 'exact --query filter', 1, 200);
  const matches = rows.filter(row => row[queryIndex].trim() === query);
  if (matches.length !== 1) fail('CSV must contain exactly one row matching --query. Export a query summary for the supplied period.');
  const row = matches[0];
  return normalizeRecords([{ hypothesisId: options.hypothesisId, kind: 'search_console', sourceUrl: options.sourceUrl,
    observedAt: options.observedAt, periodStart: options.periodStart, periodEnd: options.periodEnd, query,
    summary: `Search Console のクエリ別エクスポート。対象クエリ「${query}」の表示回数とクリック数。期間・プロパティは提出者が指定した値。`,
    metrics: { impressions: csvInteger(row[impressionsIndex]), clicks: csvInteger(row[clicksIndex]) } }], 'evidence', now);
}
export function fromResearchSuggestions(report, options, now = new Date()) {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.suggestions) || report.suggestions.length > MAX_ROWS) fail('Invalid research suggestion report.');
  const query = plain(options.query, 'exact --query filter', 1, 200);
  const rows = report.suggestions.filter(item => item.query === query);
  if (rows.length !== 1 || rows[0].fetchStatus !== 'fetched') fail('Requested query was not successfully fetched exactly once.');
  const entry = rows[0];
  if (!Array.isArray(entry.suggestions) || entry.suggestions.length > 20 || entry.suggestions.some(value => typeof value !== 'string' || value.length > 200)) fail('Invalid suggestion entries.');
  const source = new URL(evidenceUrl(entry.requestedUrl));
  if (source.hostname !== 'suggestqueries.google.com' || source.pathname !== '/complete/search' || source.searchParams.get('q') !== query) fail('Suggestion evidence must reference the matching original Google autocomplete request.');
  if (entry.suggestions.length === 0) fail('No suggestions were returned; empty output is not demand evidence.');
  return normalizeRecords([{ hypothesisId: options.hypothesisId, kind: 'suggestion', sourceUrl: source.href,
    observedAt: entry.checkedAt, query, summary: `検索候補の観測。検索語「${query}」に対する候補: ${[...new Set(entry.suggestions)].join(' / ')}。検索数・購買意欲・売上を示す測定値ではありません。` }], 'evidence', now);
}
export function importOrigin(value) {
  if (typeof value !== 'string') fail('Set SITE_URL to the intended site origin.');
  const publicOrigin = publicSiteOrigin(value); if (publicOrigin) return publicOrigin;
  let url; try { url = new URL(value); } catch { fail('Invalid SITE_URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('SITE_URL must be the public HTTPS origin or an explicit local development origin.');
  return url.origin;
}
export async function submitRecords(records, route, send) {
  let imported = 0, duplicate = 0;
  for (const record of records) {
    const result = await send(`/api/admin/growth/${route}`, record);
    if (result.status !== 200 && result.status !== 201) fail(`Import stopped at record ${imported + duplicate + 1}: HTTP ${result.status}. Earlier accepted records remain saved; rerun uses the same IDs.`);
    if (result.status === 201) imported++; else duplicate++;
  }
  return { imported, duplicate };
}
function sender(env) {
  const origin = importOrigin(env.SITE_URL), token = env.ADMIN_TOKEN;
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(token)) fail('ADMIN_TOKEN must be supplied through the environment, not CLI arguments.');
  return async (path, record) => {
    if (!['/api/admin/growth/evidence', '/api/admin/growth/observations'].includes(path)) fail('Unsupported import endpoint.');
    const temporary = mkdtempSync(join(tmpdir(), 'shigoto-import-'));
    try {
      const bodyPath = join(temporary, 'request.json'), responsePath = join(temporary, 'response.json');
      writeFileSync(bodyPath, JSON.stringify(record), { mode: 0o600 });
      // Keep credential out of argv, stdout and temporary files. curl inherits the
      // managed proxy and CA trust; redirects are deliberately never followed.
      const config = 'header = "Authorization: Bearer ' + token.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"\n';
      const args = ['--silent', '--show-error', '--config', '-', '--proto', '=http,https', '--max-redirs', '0', '--connect-timeout', '10', '--max-time', '20', '--max-filesize', '65536', '--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@' + bodyPath, '--output', responsePath, '--write-out', '%{http_code}', origin + path];
      if (env.SSL_CERT_FILE) args.unshift('--cacert', env.SSL_CERT_FILE);
      const childEnv = { ...env }; delete childEnv.ADMIN_TOKEN;
      const result = spawnSync('curl', args, { input: config, env: childEnv, encoding: 'utf8', timeout: 22_000, maxBuffer: 65_536 });
      if (result.error || result.status !== 0 || !/^\d{3}$/.test(result.stdout || '')) fail('Import connection failed; no response content or credentials were logged.');
      return { status: Number(result.stdout) };
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  };
}
function argumentsFor(args) {
  const parsed = { dryRun: false, apply: false };
  const names = { '--file': 'file', '--format': 'format', '--hypothesis': 'hypothesisId', '--query': 'query', '--source-url': 'sourceUrl', '--observed-at': 'observedAt', '--period-start': 'periodStart', '--period-end': 'periodEnd' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--apply') parsed.apply = true;
    else if (has(names, arg) && args[i + 1] && !args[i + 1].startsWith('--') && parsed[names[arg]] === undefined) parsed[names[arg]] = args[++i];
    else fail('Unsupported or repeated option. Use --file, --format, --dry-run/--apply and documented mapping options.');
  }
  if (parsed.apply && parsed.dryRun) fail('Choose --dry-run or --apply, not both.');
  if (!parsed.file || !['evidence-json', 'observations-json', 'research-suggest', 'search-console'].includes(parsed.format)) fail('Provide --file and --format evidence-json|observations-json|research-suggest|search-console.');
  return parsed;
}
async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (statSync(options.file).size > MAX_BYTES) fail('Input exceeds 512000 bytes.');
  const contents = readFileSync(options.file, 'utf8');
  let records; const route = options.format === 'observations-json' ? 'observations' : 'evidence';
  if (options.format === 'search-console') records = fromSearchConsole(contents, options);
  else {
    let data; try { data = JSON.parse(contents); } catch { fail('Input must be valid JSON.'); }
    records = options.format === 'research-suggest' ? fromResearchSuggestions(data, options) : normalizeRecords(data, route);
  }
  if (!options.apply) { console.log(JSON.stringify({ mode: 'dry-run', endpoint: `/api/admin/growth/${route}`, networkRequests: 0, records }, null, 2)); return; }
  const result = await submitRecords(records, route, sender(process.env));
  console.log(`Imported ${result.imported}; already present ${result.duplicate}. Evidence provenance recorded; demand and revenue are not automatically verified.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error && !error.code ? error.message : 'Import failed; check file path, permissions, and options.'); process.exitCode = 1; });
