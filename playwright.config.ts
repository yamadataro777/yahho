import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'tests', testMatch:'**/*.e2e.ts', fullyParallel:false, workers:1,
 use:{baseURL:'http://127.0.0.1:8791',trace:'off',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false npx wrangler d1 migrations apply affiliate-lab --local --persist-to .wrangler/e2e && WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false npx wrangler dev --local --port 8791 --persist-to .wrangler/e2e',url:'http://127.0.0.1:8791/api/health',reuseExistingServer:false,timeout:120000,stdout:'pipe',stderr:'pipe'}
});
