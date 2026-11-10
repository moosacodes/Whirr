import { expect, test } from '@playwright/test';

test('invisible checkout is public, microphone-closed and read-only', async ({ page }) => {
  const financialRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/sessions') || url.includes('/paypal')) financialRequests.push(url);
  });

  await page.goto('/invisible-checkout');
  await expect(page.getByRole('heading', { name: /There is nothing to scan/ })).toBeVisible();
  await expect(page.getByText('MIC CLOSED').first()).toBeVisible();
  await expect(page.getByText('NOT RUN').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen for an object' })).toBeEnabled();
  await expect(page.getByText(/does not prove which physical unit is present/i).first()).toBeVisible();

  await page.waitForTimeout(300);
  expect(financialRequests, financialRequests.join('\n')).toEqual([]);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});

test('discovery studio requires the operator session', async ({ page }) => {
  await page.goto('/studio/discovery');
  await expect(page).toHaveURL(/\/operator\/login/);
});
