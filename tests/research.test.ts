import { describe, it, expect, vi } from 'vitest';
import { allowedUrl, cleanText, evidenceSnippet, parseSuggestions, classifyFetch, fetchBounded, collectOfficial, collectSuggestions } from '../scripts/research.mjs';

describe('public research evidence boundaries', () => {
 it('limits fetches to known HTTPS domains without credentials or ports', () => {
  expect(allowedUrl('https://www.make.com/en/affiliate')).toBe(true);
  for (const url of ['http://www.make.com/en','https://localhost/','https://www.make.com.attacker.test/','https://user:password@www.make.com/','https://www.make.com:444/']) expect(allowedUrl(url)).toBe(false);
 });
 it('blocks unknown and cross-domain redirects before a second request', async () => {
  const request = vi.fn(async () => ({ status: 302, location: 'https://127.0.0.1/admin', body: '' }));
  expect((await fetchBounded('https://www.make.com/en/affiliate', request)).error).toBe('redirect_not_allowed');
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('caps allowed same-host redirects at two hops', async () => {
  const request = vi.fn(async () => ({ status: 302, location: '/next', body: '' }));
  expect((await fetchBounded('https://www.make.com/en/affiliate', request)).error).toBe('redirect_limit');
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('never labels a blocked or nonexistent page as verified', async () => {
  const failed = await collectOfficial({id:'make',url:'https://www.make.com/en/affiliate'}, async () => ({status:null,error:'proxy_access_denied',body:'denied'}));
  expect(failed).toMatchObject({fetchStatus:'unavailable',programStatus:'unverified',commission:null,evidenceSnippet:null});
  expect(classifyFetch({status:404,contentType:'text/html'}).fetchStatus).toBe('unavailable');
 });
 it('distinguishes fetched marketing text from program acceptance', async () => {
  const result = await collectOfficial({id:'make',url:'https://www.make.com/en/affiliate'}, async () => ({status:200,contentType:'text/html',body:'<script>secret()</script><h1>Affiliate information</h1>'}));
  expect(result).toMatchObject({fetchStatus:'fetched',programStatus:'unverified',eligibility:'unverified',commission:null});
  expect(result.evidenceSnippet).toBe('Affiliate information');
 });
 it('bounds text and does not retain script or style contents', () => {
  expect(cleanText('<style>hidden</style><p>Public &amp; useful</p>')).toBe('Public & useful');
  expect(evidenceSnippet('a'.repeat(30_000)).length).toBeLessThanOrEqual(1500);
 });
 it('parses autocomplete without inventing volume or empty-result demand', async () => {
  const query = 'Make Zapier 比較';
  expect(parseSuggestions(JSON.stringify([query,['Make Zapier 比較','Make Zapier 比較']]),query)).toEqual(['Make Zapier 比較']);
  const response = await collectSuggestions(query, async () => ({status:200,body:JSON.stringify([query,[]])}));
  expect(response).toMatchObject({fetchStatus:'fetched',suggestions:[],searchVolume:null});
 });
 it('rejects malformed and excessive autocomplete data', () => {
  expect(()=>parseSuggestions(JSON.stringify(['different query',[]]),'query')).toThrow();
  expect(()=>parseSuggestions('x'.repeat(65_000),'query')).toThrow();
  expect(()=>parseSuggestions(JSON.stringify(['query',[{value:'x'}]]),'query')).toThrow();
 });
});
