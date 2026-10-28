import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { preflight, productionConfig, publicOrigin } from '../scripts/deploy.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'not-a-real-api-token',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  D1_DATABASE_ID: '12345678-1234-1234-1234-123456789abc',
  SITE_URL: 'https://example.workers.dev',
  OPERATOR_NAME: 'Operator fixture for local tests',
  CONTACT_EMAIL: 'support@shigoto-dougu.jp',
  ADMIN_TOKEN: 'a'.repeat(40), CONVERSION_TOKEN: 'b'.repeat(40),
};
describe('deployment boundaries', () => {
  it('requires all credentials before any remote operation', () => {
    const result = preflight({}, []);
    expect(result.errors.length).toBe(8);
    expect(preflight(env, []).errors).toEqual([]);
  });
  it('requires explicit provisioning when there is no existing database', () => {
    expect(preflight({ ...env, D1_DATABASE_ID: undefined }, []).errors).toHaveLength(1);
    expect(preflight({ ...env, D1_DATABASE_ID: undefined }, ['--provision']).provision).toBe(true);
    expect(preflight({ ...env, D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000' }, ['--provision']).errors).toHaveLength(1);
  });
  it('rejects local or credential-bearing canonical URLs', () => {
    for (const value of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://foo.local', 'https://shigoto.test', 'https://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=abc']) expect(publicOrigin(value)).toBeNull();
    expect(publicOrigin('https://shigoto.workers.dev/')).toBe('https://shigoto.workers.dev');
  });
  it('never serializes secret values into deploy configuration', () => {
    const config = productionConfig({ vars: {}, d1_databases: [{ binding: 'DB' }] }, env, env.D1_DATABASE_ID);
    const json = JSON.stringify(config);
    expect(json).not.toContain(env.ADMIN_TOKEN);
    expect(json).not.toContain(env.CONVERSION_TOKEN);
    expect(json).not.toContain(env.CLOUDFLARE_API_TOKEN);
    expect(config.vars.ENABLE_AUTOPUBLISH).toBe('false');
    expect(config.ai).toBeUndefined();
  });
  it('fails closed if autopublishing lacks the AI binding', () => {
    expect(preflight({ ...env, ENABLE_AUTOPUBLISH: 'true' }, []).errors).toHaveLength(1);
  });
  it('requires the real public operator and a reachable-formatted contact before deploying', () => {
    expect(preflight({ ...env, OPERATOR_NAME: '' }, []).errors).toHaveLength(1);
    expect(preflight({ ...env, CONTACT_EMAIL: undefined }, []).errors).toHaveLength(1);
    expect(preflight({ ...env, CONTACT_EMAIL: undefined, PUBLIC_CONTACT_URL: 'https://www.notion.com/contact-us' }, []).errors).toEqual([]);
    expect(preflight({ ...env, CONTACT_EMAIL: 'support@example.com' }, []).errors.join(' ')).toContain('CONTACT_EMAIL');
    expect(preflight({ ...env, PUBLIC_CONTACT_URL: 'https://127.0.0.1/help' }, []).errors).toHaveLength(1);
  });
  it('includes validated public contact and Search Console values without preserving stale fields', () => {
    const settings = { ...env, GOOGLE_SITE_VERIFICATION: 'search-console-test-token_123', PUBLIC_CONTACT_URL: 'https://www.notion.com/contact-us' };
    const config = productionConfig({ vars: {}, d1_databases: [{ binding: 'DB' }] }, settings, env.D1_DATABASE_ID);
    expect(config.vars.OPERATOR_NAME).toBe(env.OPERATOR_NAME);
    expect(config.vars.CONTACT_EMAIL).toBe(env.CONTACT_EMAIL);
    expect(config.vars.PUBLIC_CONTACT_URL).toBe(settings.PUBLIC_CONTACT_URL);
    expect(config.vars.GOOGLE_SITE_VERIFICATION).toBe(settings.GOOGLE_SITE_VERIFICATION);
    const reset = productionConfig({ vars: { PUBLIC_CONTACT_URL: 'https://stale.support.jp/', GOOGLE_SITE_VERIFICATION: 'stale-token' }, d1_databases: [{ binding: 'DB' }] }, env, env.D1_DATABASE_ID);
    expect(reset.vars.PUBLIC_CONTACT_URL).toBeUndefined();
    expect(reset.vars.GOOGLE_SITE_VERIFICATION).toBeUndefined();
    expect(preflight({ ...env, GOOGLE_SITE_VERIFICATION: '<meta name="token">' }, []).errors).toHaveLength(1);
  });
  it('preserves the emergency generation pause in production configuration', () => {
    const paused = { ...env, MAX_DAILY_ARTICLES: '0' };
    expect(preflight(paused, []).errors).toEqual([]);
    expect(productionConfig({ vars: { MAX_DAILY_ARTICLES: '1' }, d1_databases: [{ binding: 'DB' }] }, paused, env.D1_DATABASE_ID).vars.MAX_DAILY_ARTICLES).toBe('0');
    expect(productionConfig({ vars: {}, d1_databases: [{ binding: 'DB' }] }, env, env.D1_DATABASE_ID).vars.MAX_DAILY_ARTICLES).toBe('1');
  });
  it('rejects invalid article budgets rather than silently enabling generation', () => {
    for (const value of ['', '2', '-1', '1.5', 'false', ' 0']) expect(preflight({ ...env, MAX_DAILY_ARTICLES: value }, []).errors).toHaveLength(1);
    expect(preflight({ ...env, MAX_DAILY_ARTICLES: '1' }, []).errors).toEqual([]);
  });
  it('--check validates offline and reports no credential values', () => {
    const run = spawnSync(process.execPath, ['scripts/deploy.mjs', '--check'], { env: { ...process.env, ...env }, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('No network requests');
    expect(run.stdout + run.stderr).not.toContain(env.CLOUDFLARE_API_TOKEN);
  });
  it('does not echo an accidentally supplied secret in an unsupported command argument', () => {
    const accidental = 'local-test-secret-supplied-in-wrong-place';
    const run = spawnSync(process.execPath, ['scripts/deploy.mjs', '--check', accidental], { env: { ...process.env, ...env }, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(accidental);
    expect(run.stderr).toContain('pass credentials through environment settings');
  });
  it('CLI exits nonzero before publishing with missing credentials', () => {
    const empty = { ...process.env };
    for (const key of Object.keys(env)) delete empty[key];
    const run = spawnSync(process.execPath, ['scripts/deploy.mjs', '--check'], { env: empty, encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('No remote resources were changed');
  });
});
