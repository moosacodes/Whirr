import { expect, test, type Page } from '@playwright/test';

const CORE_ROUTES = ['/ambient', '/ambient/wish', '/ambient/judge'] as const;

async function expectCoreSemantics(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Skip to content/i })).toHaveCount(1);

  const unnamedImages = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).filter(
      (image) => !image.hasAttribute('alt') && !image.hasAttribute('aria-label'),
    ).length,
  );
  expect(unnamedImages, `${route} has images without an accessible name`).toBe(0);

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(horizontalOverflow, `${route} has page-level horizontal overflow`).toBe(false);
}

test.describe('core accessibility smoke', () => {
  for (const route of CORE_ROUTES) {
    test(`${route} exposes landmarks, a single heading, and accessible images`, async ({ page }) => {
      await expectCoreSemantics(page, route);
    });
  }

  test('the skip link is the first keyboard target and reaches the main landmark', async ({ page }) => {
    await page.goto('/ambient');
    const skip = page.getByRole('link', { name: /Skip to content/i });
    // Wait for the lazy app shell before sending the first key. A cold Vite
    // transform can otherwise mount the skip link after Tab has already fired.
    await expect(skip).toBeAttached();
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });
});
