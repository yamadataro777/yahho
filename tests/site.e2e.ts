import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const localVars=readFileSync('.dev.vars','utf8');
const token=/^ADMIN_TOKEN=(.+)$/m.exec(localVars)![1];
const adminHeaders={authorization:`Bearer ${token}`};
test('home, diagnosis and contextual comparison work end to end',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await expect(page).toHaveTitle(/しごと道具/);await expect(page.locator('h1')).toContainText('もっと');
 await page.getByRole('link',{name:'自分に合う道具を見つける'}).click();
 await page.locator('input[name=useCase][value=automation]').check();
 await page.locator('input[name=budget][value=paid]').check();
 await page.locator('input[name=team][value=team]').check();
 await page.getByRole('button',{name:'ぴったりの候補を見る'}).click();
 await expect(page.locator('#diagnosis-results')).toContainText('Make');
 await expect(page.locator('#diagnosis-results')).toContainText('Zapier');
 await page.getByRole('link',{name:'この候補を並べて比較する'}).click();
 await expect(page.locator('table')).toContainText('Make');await expect(page.locator('table')).toContainText('注意したいこと');
 expect(errors).toEqual([]);
});
test('catalog filters, no results, and comparison selection cap',async({page})=>{
 await page.goto('/tools?category=design');await expect(page.locator('.tool-card')).toHaveCount(2);
 await page.goto('/tools?q=nonexistent-xyz');await expect(page.locator('main')).toContainText('見つかりませんでした');
 await page.goto('/tools');const boxes=page.locator('input[name=compare]');
 await boxes.nth(0).check();await boxes.nth(1).check();await boxes.nth(2).check();await expect(boxes.nth(3)).toBeDisabled();
 await page.getByRole('button',{name:'選択をクリア'}).click();await expect(boxes.nth(3)).toBeEnabled();await expect(page.locator('#compare-bar')).toBeHidden();
});
test('guides render full content, source links and real 404; user input escaped',async({page,request})=>{
 await page.goto('/guides');expect(await page.locator('.article-card').count()).toBeGreaterThanOrEqual(6);
 await page.locator('.article-card h3 a').first().click();expect(await page.locator('.reading section').count()).toBeGreaterThanOrEqual(4);
 await expect(page.locator('.reading')).toContainText('参照先と情報の確認');
 const unknown=await request.get('/not-a-real-page');expect(unknown.status()).toBe(404);
 await page.goto('/tools?q='+encodeURIComponent('"><script>window.xss=1</script>'));
 expect(await page.evaluate(()=>Object.hasOwn(window,'xss'))).toBe(false);
});
test('mobile navigation and layout fit viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/home-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'ぴったりの道具を診断'}).click();await expect(page.locator('h1')).toContainText('合う道具');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('desktop screenshot',async({page})=>{await page.goto('/');await page.screenshot({path:'test-results/home-desktop.png',fullPage:true});});
test('API rejects unauthorized and invalid data; metrics record real diagnosis only',async({request})=>{
 expect((await request.get('/api/admin/status')).status()).toBe(401);
 expect((await request.post('/api/recommend',{data:{useCase:'unknown',budget:'free',team:'solo'}})).status()).toBe(400);
 expect((await request.post('/api/events',{data:{kind:'affiliate_click',offerId:'not-enabled'}})).status()).toBe(400);
 expect((await request.post('/api/recommend',{headers:{origin:'https://attacker.invalid'},data:{useCase:'writing',budget:'free',team:'solo'}})).status()).toBe(403);
 const status=await request.get('/api/admin/status',{headers:adminHeaders});expect(status.ok()).toBe(true);expect((await status.json()).metrics.diagnoses).toBeGreaterThan(0);
 await expect((await request.get('/robots.txt')).text()).resolves.toContain('Disallow: /');
});
test('admin login and signed affiliate link persist; confirmed conversions are idempotent',async({page,request})=>{
 await page.goto('/admin');await page.locator('input[type=password]').fill(token);await page.getByRole('button',{name:'運用状況を読み込む'}).click();
 await expect(page.locator('#admin-private')).toBeVisible();
 const offer={id:'canva',name:'Canva',category:'design',description:'Local integration test fixture',url:'https://www.canva.com/?fixture=local%2Bonly&x=2',enabled:true,allowedHosts:['www.canva.com'],verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:null};
 try{
  const save=await request.put('/api/admin/offers',{headers:adminHeaders,data:offer});expect(save.ok()).toBe(true);
  await page.goto('/tools/canva');const link=page.locator('a[data-offer=canva]');await expect(link).toHaveAttribute('href',offer.url);await expect(link).toHaveAttribute('rel',/sponsored/);
  const click=await request.post('/api/events',{data:{kind:'affiliate_click',offerId:'canva'}});expect(click.ok()).toBe(true);
  const conversion={externalId:`fixture-${Date.now()}`,offerId:'canva',commissionJpy:123,occurredAt:new Date(Date.now()-1000).toISOString()};
  const a=await request.post('/api/admin/conversions',{headers:adminHeaders,data:conversion});expect(a.status()).toBe(201);
  const b=await request.post('/api/admin/conversions',{headers:adminHeaders,data:conversion});expect((await b.json()).created).toBe(false);
 }finally{await request.put('/api/admin/offers',{headers:adminHeaders,data:{...offer,enabled:false}});}
});
