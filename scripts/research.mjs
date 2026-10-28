#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 512_000;
export const OFFICIAL_TARGETS = [
  { id: 'make', url: 'https://www.make.com/en/affiliate', purpose: 'affiliate candidate page; program and eligibility unverified' },
  { id: 'notta', url: 'https://www.notta.ai/en/affiliate', purpose: 'affiliate candidate page; program and eligibility unverified' },
  { id: 'adobe-express', url: 'https://www.adobe.com/affiliates.html', purpose: 'Adobe program candidate; Express eligibility must be checked separately' },
  { id: 'notion', url: 'https://www.notion.com/affiliates', purpose: 'check whether enrollment exists or is paused' },
  { id: 'canva', url: 'https://www.canva.com/affiliates/', purpose: 'check current program; creator programs are not automatically affiliate programs' },
  { id: 'zapier', url: 'https://zapier.com/partner-program', purpose: 'check program type; solution partnerships are not automatically publisher commissions' },
  { id: 'chatgpt', url: 'https://chatgpt.com/overview/', purpose: 'official product reference only; no affiliate program assumed' },
  { id: 'claude', url: 'https://claude.com/product/overview', purpose: 'official product reference only; no affiliate program assumed' },
];
export const QUERIES = ['Make Zapier 比較', 'Canva Adobe Express 比較', 'ChatGPT Claude 使い分け', 'Notta 議事録 同意', 'Notion チーム 情報整理'];
const allowedHosts = new Set([...OFFICIAL_TARGETS.map(target => new URL(target.url).hostname), 'suggestqueries.google.com']);

export function allowedUrl(value, initialUrl) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && allowedHosts.has(url.hostname) && (!initialUrl || url.hostname === new URL(initialUrl).hostname);
  } catch { return false; }
}
export function cleanText(html) {
  return html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 20_000);
}
export function evidenceSnippet(body) {
  const text = cleanText(body);
  const match = /affiliat|referral|commission|partner|紹介|提携|報酬/i.exec(text);
  return text.slice(match ? Math.max(0, match.index - 100) : 0, match ? match.index + 1400 : 1500);
}
export function parseSuggestions(body, query) {
  if (Buffer.byteLength(body, 'utf8') > 64_000) throw new Error('suggestions_too_large');
  const value = JSON.parse(body);
  if (!Array.isArray(value) || value[0] !== query || !Array.isArray(value[1]) || value[1].length > 100) throw new Error('invalid_suggestion_response');
  if (value[1].some(item => typeof item !== 'string' || item.length > 200 || /[\u0000-\u001f]/.test(item))) throw new Error('invalid_suggestion_text');
  return [...new Set(value[1])].slice(0, 20);
}
export function classifyFetch(result) {
  if (result.error) return { fetchStatus: 'unavailable', reason: result.error };
  if (result.status === 403 || result.status === 407) return { fetchStatus: 'unavailable', reason: 'http_access_denied' };
  if (result.status === 404) return { fetchStatus: 'unavailable', reason: 'page_not_found' };
  if (result.status < 200 || result.status >= 300) return { fetchStatus: 'unavailable', reason: 'http_' + result.status };
  if (!/^text\/(html|plain)\b/i.test(result.contentType || '')) return { fetchStatus: 'unavailable', reason: 'unexpected_content_type' };
  return { fetchStatus: 'fetched', reason: null };
}

// curl receives inherited HTTPS_PROXY and CA trust. No shell interpolation,
// alternate proxy, credential headers, TLS bypass, or automatic redirects.
async function singleRequest(url) {
  const dir = await mkdtemp(join(tmpdir(), 'shigoto-research-'));
  const bodyPath = join(dir, 'body'); const headerPath = join(dir, 'headers');
  try {
    const args = ['--silent', '--show-error', '--proto', '=https', '--connect-timeout', '10', '--max-time', '20', '--max-filesize', String(MAX_BYTES), '--user-agent', 'ShigotoDouguResearch/1.0', '--dump-header', headerPath, '--output', bodyPath, '--write-out', '%{http_code}', url];
    // The cloud environment's trust bundle must remain in use.
    if (process.env.SSL_CERT_FILE) args.unshift('--cacert', process.env.SSL_CERT_FILE);
    let stdout;
    try { ({ stdout } = await exec('curl', args, { env: process.env, timeout: 21_000, maxBuffer: 32_000, encoding: 'utf8' })); }
    catch (error) {
      const stderr = typeof error.stderr === 'string' ? error.stderr : '';
      const reason = /CONNECT tunnel failed.*403|Tunnel connection failed.*403|proxy.*403/i.test(stderr) ? 'proxy_access_denied'
        : error.code === 63 ? 'response_too_large' : error.code === 28 || error.killed ? 'request_timeout' : 'network_request_failed';
      return { status: null, error: reason, contentType: '', body: '' };
    }
    const headers = await readFile(headerPath, 'utf8');
    const blocks = headers.split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
    const finalHeaders = blocks.at(-1) || '';
    const get = name => new RegExp('^' + name + ':\\s*(.+)$', 'im').exec(finalHeaders)?.[1].trim() || '';
    const bytes = await readFile(bodyPath);
    if (bytes.length > MAX_BYTES) return { status: Number(stdout), error: 'response_too_large', contentType: '', body: '' };
    return { status: Number(stdout), contentType: get('content-type'), location: get('location'), body: bytes.toString('utf8') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function fetchBounded(url, requester = singleRequest) {
  if (!allowedUrl(url)) return { status: null, error: 'unapproved_url', body: '', finalUrl: url };
  const start = url; let current = url;
  for (let step = 0; step <= 2; step++) {
    const response = await requester(current);
    if (response.error || ![301,302,303,307,308].includes(response.status)) return { ...response, finalUrl: current };
    if (!response.location || step === 2) return { status: response.status, error: 'redirect_limit', body: '', finalUrl: current };
    let next;
    try { next = new URL(response.location, current).href; } catch { return { status: response.status, error: 'invalid_redirect', body: '', finalUrl: current }; }
    if (!allowedUrl(next, start)) return { status: response.status, error: 'redirect_not_allowed', body: '', finalUrl: current };
    current = next;
  }
}
export async function collectOfficial(target, fetcher = fetchBounded) {
  const result = await fetcher(target.url);
  const state = classifyFetch(result);
  return { id: target.id, requestedUrl: target.url, finalUrl: result.finalUrl || target.url, checkedAt: new Date().toISOString(), ...state,
    httpStatus: result.status ?? null, programStatus: 'unverified', eligibility: 'unverified', commission: null, purpose: target.purpose,
    evidenceSnippet: state.fetchStatus === 'fetched' ? evidenceSnippet(result.body) : null };
}
export async function collectSuggestions(query, fetcher = fetchBounded) {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.search = new URLSearchParams({ client: 'firefox', hl: 'ja', q: query }).toString();
  const result = await fetcher(url.href);
  const base = { query, requestedUrl: url.href, checkedAt: new Date().toISOString(), searchVolume: null, meaning: 'Suggestions are query wording evidence, not search volume, traffic or revenue.' };
  if (result.error || result.status !== 200) return { ...base, fetchStatus: 'unavailable', reason: result.error || 'http_' + result.status, suggestions: [] };
  try { return { ...base, fetchStatus: 'fetched', reason: null, suggestions: parseSuggestions(result.body, query) }; }
  catch { return { ...base, fetchStatus: 'unavailable', reason: 'invalid_suggestion_response', suggestions: [] }; }
}
async function mapLimit(items, mapper) {
  const results = new Array(items.length); let cursor = 0;
  await Promise.all([0,1].map(async () => { while(cursor < items.length) { const i = cursor++; results[i] = await mapper(items[i]); } }));
  return results;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--official', '--suggest'].includes(arg))) throw new Error('Use --dry-run, --official, or --suggest.');
  const both = !args.includes('--official') && !args.includes('--suggest');
  const official = both || args.includes('--official'); const suggest = both || args.includes('--suggest');
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ mode: 'dry-run', officialTargets: official ? OFFICIAL_TARGETS : [], suggestionQueries: suggest ? QUERIES : [], requiredDomains: [...allowedHosts], networkRequests: 0 }, null, 2)); return;
  }
  const report = { schemaVersion: 1, collectedAt: new Date().toISOString(), programs: official ? await mapLimit(OFFICIAL_TARGETS, collectOfficial) : [], suggestions: suggest ? await mapLimit(QUERIES, collectSuggestions) : [] };
  const dir = join(root, '.research'); await mkdir(dir, { recursive: true });
  const path = join(dir, 'research-' + report.collectedAt.replace(/[:.]/g, '-') + '.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const all = [...report.programs, ...report.suggestions]; const fetched = all.filter(item => item.fetchStatus === 'fetched').length;
  console.log(`Saved evidence report: ${path}\nFetched ${fetched}/${all.length}. Program acceptance, commission and search volumes remain unverified.`);
  if (fetched !== all.length) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error('Research failed:', error.message); process.exitCode = 1; });
