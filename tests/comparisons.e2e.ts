import {test,expect} from '@playwright/test';
test('comparison landing pages connect from index to guides and official tool pages',async({page})=>{
 await page.goto('/compare');await page.locator('main a[href="/compare/make-vs-zapier"]').first().click();
 await expect(page.locator('h1')).toHaveCount(1);await expect(page.locator('h1')).toContainText('MakeとZapier');
 await expect(page.locator('table')).toContainText('Make');await expect(page.locator('table')).toContainText('Zapier');
 await page.getByRole('link',{name:'導入前の確認手順を詳しく読む'}).click();await expect(page).toHaveURL(/\/guides\/make-zapier-workflow/);
});
test('mobile comparison scroll is contained; contact is honest without public identity',async({page,request})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/compare/canva-vs-adobe-express');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('link',{name:'お問い合わせ',exact:true}).click();await expect(page.locator('h1')).toHaveText('お問い合わせ');await expect(page.locator('main')).toContainText('準備中');await expect(page.locator('main a[href^="mailto:"]')).toHaveCount(0);
 const image=await request.get('/og-image.png');expect(image.status()).toBe(200);expect(image.headers()['content-type']).toContain('image/png');
});
