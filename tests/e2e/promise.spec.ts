import { expect, test, type Page } from '@playwright/test';

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    return {
      document: document.documentElement.scrollWidth - width,
      body: document.body.scrollWidth - width,
    };
  });
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

test('teaches, consents and opens a real microphone-closed observation', async ({ page }) => {
  await page.goto('/promise');
  await expect(page.getByRole('heading', { name: /Teach the world/i })).toBeVisible();
  await expect(page.getByText('synthetic reference').first()).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('link', { name: /One qualified fan cycle/i }).click();
  await expect(page).toHaveURL(/\/promise\/prm_reference_fan/);
  await expect(page.getByRole('heading', { name: 'One qualified fan cycle' }).first()).toBeVisible();
  await expect(page.getByText('Qualifies', { exact: true })).toBeVisible();
  await expect(page.getByText('Does not qualify', { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('checkbox').check();
  const begin = page.getByRole('button', { name: /Begin demo observation/i });
  await expect(begin).toBeEnabled();
  await begin.click();

  await page.waitForURL(/\/promise\/run\//);
  await expect(page.getByText('Required sequence').first()).toBeVisible();
  await expect(page.getByText('MIC CLOSED').first()).toBeVisible();
  await expect(page.getByText(/Demo observations cannot capture/i)).toBeVisible();
  await expectNoPageOverflow(page);
});
