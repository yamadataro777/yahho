import { test, expect, type Locator } from '@playwright/test';

async function readability(locator: Locator, minimumSize: number) {
  const results = await locator.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const rgb = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).map(Number);
    const foreground = rgb(style.color);
    let background: number[] = [255, 255, 255];
    let current: Element | null = element;
    while (current) {
      const candidate = rgb(getComputedStyle(current).backgroundColor);
      if (candidate.length === 3 || candidate[3] === 1) { background = candidate; break; }
      current = current.parentElement;
    }
    const luminance = (values: number[]) => values.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const fg = luminance(foreground), bg = luminance(background);
    return { text: element.textContent?.trim().slice(0, 50), size: Number.parseFloat(style.fontSize), contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
  }));
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.size, `${result.text}: font size`).toBeGreaterThanOrEqual(minimumSize);
    expect(result.contrast, `${result.text}: text contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

test('home descriptions and labels are readable on desktop', async ({ page }) => {
  await page.goto('/');
  await readability(page.locator('.hero-lead, .category-card p, .tool-card p, .article-card>p, .promise p'), 14);
  await readability(page.locator('.micro, .selection-note, .article-meta, .affiliate-note'), 12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [320, 390]) {
  test(`mobile ${width}px preserves body size, contrast and page reflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await readability(page.locator('.hero-lead, .category-card p, .tool-card p, .article-card>p'), 14);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/diagnosis');
    await readability(page.locator('.radio-card b'), 16);
    await readability(page.locator('.radio-card small'), 13);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/guides/choose-ai-writing');
    await readability(page.locator('.reading section p'), 16);
    await readability(page.locator('.byline, .article-disclosure'), 12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('keyboard entry exposes a visible, high-contrast focus indicator', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '本文へスキップ' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const focus = await skip.evaluate(element => {
    const style = getComputedStyle(element);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle, offset: Number.parseFloat(style.outlineOffset) };
  });
  expect(focus.width).toBeGreaterThanOrEqual(3);
  expect(focus.style).toBe('solid');
  expect(focus.offset).toBeGreaterThanOrEqual(3);
});
