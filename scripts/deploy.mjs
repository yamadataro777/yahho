#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorProfile, googleSiteVerification, publicSiteOrigin } from '../src/site-config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zeroId = '00000000-0000-0000-0000-000000000000';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicOrigin(value) {
  return publicSiteOrigin(value);
}

export function preflight(env, args = []) {
  const errors = [];
  const profile = operatorProfile(env);
  for (const arg of args) if (!['--check', '--provision'].includes(arg)) errors.push('Unknown option. Supported options are --check and --provision; pass credentials through environment settings.');
  if (!env.CLOUDFLARE_API_TOKEN) errors.push('CLOUDFLARE_API_TOKEN is required.');
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')) errors.push('CLOUDFLARE_ACCOUNT_ID must be the 32-character account ID.');
  if (!publicOrigin(env.SITE_URL)) errors.push('SITE_URL must be the public HTTPS origin, such as https://your-worker.your-subdomain.workers.dev.');
  if (!profile.name) errors.push('OPERATOR_NAME must be the real public operator name (1–100 characters, no markup or control characters).');
  if (!profile.email && !profile.contactUrl) errors.push('Set a valid public CONTACT_EMAIL or HTTPS PUBLIC_CONTACT_URL for the operator.');
  if (env.CONTACT_EMAIL && !profile.email) errors.push('CONTACT_EMAIL must be a public mailbox without display names, whitespace or mailto parameters.');
  if (env.PUBLIC_CONTACT_URL && !profile.contactUrl) errors.push('PUBLIC_CONTACT_URL must be a public HTTPS URL without credentials or a custom port.');
  if (env.GOOGLE_SITE_VERIFICATION && !googleSiteVerification(env)) errors.push('GOOGLE_SITE_VERIFICATION must be the verification token only, using letters, numbers, hyphens or underscores.');
  const databaseId = env.D1_DATABASE_ID;
  if ((!databaseId && !args.includes('--provision')) || (databaseId && (!uuid.test(databaseId) || databaseId === zeroId))) errors.push('Set a real D1_DATABASE_ID, or use --provision to create the first database.');
  for (const name of ['ADMIN_TOKEN', 'CONVERSION_TOKEN']) {
    if (!env[name] || env[name].length < 32 || env[name].length > 512 || /\s/.test(env[name])) errors.push(`${name} must contain 32–512 characters with no whitespace.`);
  }
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN === env.CONVERSION_TOKEN) errors.push('ADMIN_TOKEN and CONVERSION_TOKEN must be different.');
  if (env.ENABLE_AUTOPUBLISH === 'true' && env.ENABLE_AI !== 'true') errors.push('ENABLE_AUTOPUBLISH=true requires ENABLE_AI=true.');
  if (env.MAX_DAILY_ARTICLES !== undefined && !['0', '1'].includes(env.MAX_DAILY_ARTICLES)) errors.push('MAX_DAILY_ARTICLES must be 0 (pause generation) or 1 (one article per day).');
  return { errors, databaseId, origin: publicOrigin(env.SITE_URL), provision: !databaseId && args.includes('--provision') };
}

export function productionConfig(base, env, databaseId) {
  const config = structuredClone(base);
  const profile = operatorProfile(env);
  config.account_id = env.CLOUDFLARE_ACCOUNT_ID;
  config.vars = { ...config.vars, SITE_URL: publicOrigin(env.SITE_URL), ENABLE_AUTOPUBLISH: env.ENABLE_AUTOPUBLISH === 'true' ? 'true' : 'false', MAX_DAILY_ARTICLES: env.MAX_DAILY_ARTICLES ?? '1' };
  // Clear old optional display settings when omitted, so stale contact or verification
  // values cannot silently remain in a generated configuration.
  for (const key of ['OPERATOR_NAME', 'CONTACT_EMAIL', 'PUBLIC_CONTACT_URL', 'GOOGLE_SITE_VERIFICATION']) delete config.vars[key];
  if (profile.name) config.vars.OPERATOR_NAME = profile.name;
  if (profile.email) config.vars.CONTACT_EMAIL = profile.email;
  if (profile.contactUrl) config.vars.PUBLIC_CONTACT_URL = profile.contactUrl;
  const verification = googleSiteVerification(env);
  if (verification) config.vars.GOOGLE_SITE_VERIFICATION = verification;
  config.d1_databases = [{ ...base.d1_databases[0], database_id: databaseId }];
  config.workers_dev = true;
  if (env.ENABLE_AI === 'true') config.ai = { binding: 'AI' };
  else delete config.ai;
  return config;
}

function main() {
  const args = process.argv.slice(2);
  const env = process.env;
  const result = preflight(env, args);
  if (result.errors.length) {
    console.error('Deployment configuration is incomplete:');
    for (const error of result.errors) console.error(`- ${error}`);
    console.error('No remote resources were changed. See README.md for secure configuration.');
    process.exitCode = 1;
    return;
  }
  const base = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
  if (args.includes('--check')) {
    console.log(`Configuration is valid. Mode: ${result.provision ? 'create D1 then deploy' : 'existing D1'}. No network requests were made.`);
    return;
  }
  mkdirSync(resolve(root, '.wrangler/logs'), { recursive: true });
  const childEnv = { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(root, '.wrangler/logs') };
  const secrets = [env.CLOUDFLARE_API_TOKEN, env.ADMIN_TOKEN, env.CONVERSION_TOKEN].filter(Boolean);
  const redact = value => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  const run = (command, commandArgs, input) => {
    const completed = spawnSync(command, commandArgs, { cwd: root, env: childEnv, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 });
    if (completed.stdout) process.stdout.write(redact(completed.stdout));
    if (completed.stderr) process.stderr.write(redact(completed.stderr));
    if (completed.error || completed.status !== 0) throw new Error(`${commandArgs.slice(0, 3).join(' ')} failed (${completed.status ?? 'could not start'}).`);
    return completed.stdout ?? '';
  };
  const wrangler = (...args) => run(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args]);
  run('npm', ['run', 'check']);
  let databaseId = result.databaseId;
  if (result.provision) {
    const output = wrangler('d1', 'create', base.d1_databases[0].database_name, '--location', 'apac', '--update-config=false');
    const matches = [...output.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map(match => match[0]);
    databaseId = matches.find(value => value !== zeroId);
    if (!databaseId) throw new Error('D1 may have been created, but its ID was not detected. Retrieve the database ID from Cloudflare and rerun with D1_DATABASE_ID; do not repeatedly provision.');
    console.log(`D1_DATABASE_ID=${databaseId} (save this non-secret ID for future deploys)`);
  }
  const configPath = resolve(root, 'wrangler.production.json');
  writeFileSync(configPath, `${JSON.stringify(productionConfig(base, env, databaseId), null, 2)}\n`, { mode: 0o600 });
  wrangler('d1', 'migrations', 'apply', base.d1_databases[0].database_name, '--remote', '--config', configPath);
  wrangler('deploy', '--config', configPath);
  run(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk', '--config', configPath], JSON.stringify({ ADMIN_TOKEN: env.ADMIN_TOKEN, CONVERSION_TOKEN: env.CONVERSION_TOKEN }));
  console.log('Worker deployed and administration secrets uploaded. Verify the health endpoint, diagnosis page and /admin at the configured SITE_URL. Configure any custom domain in Cloudflare before expecting that hostname to resolve.');
  console.log('Keep D1_DATABASE_ID for updates. Affiliate links and conversion integration must be configured separately; deployment does not establish revenue.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Deployment stopped: ${error.message}`); process.exitCode = 1; }
}
