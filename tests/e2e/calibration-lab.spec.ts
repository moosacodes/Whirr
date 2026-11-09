import { expect, test, type Page } from '@playwright/test';
import { loadConfig } from '../../apps/api/src/config.ts';

const LAB_OBJECT_NAME = 'Calibration Lab UI test object';

async function signInAsOperator(page: Page): Promise<void> {
  const config = loadConfig();
  await page.goto('/operator/login');
  await page.getByLabel('Operator key').fill(config.operatorKey);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

async function ensureLabObject(page: Page): Promise<string> {
  const response = await page.request.get('/api/operator/objects');
  expect(response.ok()).toBeTruthy();
  const list = (await response.json()) as { objects: Array<{ object: { id: string; name: string } }> };
  const existing = list.objects.find((entry) => entry.object.name === LAB_OBJECT_NAME);
  if (existing) return existing.object.id;
  const created = await page.request.post('/api/operator/objects', {
    headers: { 'x-whirr-csrf': '1' },
    data: {
      name: LAB_OBJECT_NAME,
      category: 'fan',
      glyph: 'fan',
      description: 'Automated browser-test object. Not physical field-validation evidence.',
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { object: { id: string } };
  return body.object.id;
}

test('calibration lab is microphone-closed and does not start any payment flow', async ({ page }) => {
  await signInAsOperator(page);
  const objectId = await ensureLabObject(page);
  const paymentRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/paypal') || url.includes('/api/sessions')) paymentRequests.push(url);
  });

  await page.goto(`/studio/objects/${objectId}/calibration-lab`);
  await expect(page.getByRole('heading', { name: 'Prove it on a real object.' })).toBeVisible();
  await expect(page.getByText('MIC CLOSED').first()).toBeVisible();
  await expect(page.getByText(/No audio is being captured/)).toBeVisible();
  await expect(page.getByText(/Field test not run/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Record three-cycle trial/ })).toBeDisabled();
  await expect(page.getByText(/no payment action/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(paymentRequests, paymentRequests.join('\n')).toEqual([]);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});

test('synthetic Judge Mode object is explicitly excluded from real-world validation', async ({ page }) => {
  await signInAsOperator(page);
  await page.goto('/studio/objects/obj_reference_fan/calibration-lab');
  await expect(page.getByRole('heading', { name: 'Prove it on a real object.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This object is the Judge Mode demo.' })).toBeVisible();
  await expect(page.getByText('FIELD VALIDATION DOES NOT APPLY')).toBeVisible();
  await expect(page.getByRole('button', { name: /Record three-cycle trial/ })).toBeDisabled();

  const gateLayout = await page.locator('.gate-row').first().evaluate((row) => {
    const threshold = row.querySelector('.gate-row__threshold');
    const observed = row.querySelector('.gate-row__observed');
    if (!threshold || !observed) return null;
    const thresholdBox = threshold.getBoundingClientRect();
    const observedBox = observed.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return {
      thresholdAboveObserved: thresholdBox.bottom <= observedBox.top + 1,
      observedInsideRow: observedBox.right <= rowBox.right + 1 && observedBox.left >= rowBox.left - 1,
    };
  });
  expect(gateLayout).toEqual({ thresholdAboveObserved: true, observedInsideRow: true });
});

test('calibration lab requires the operator session', async ({ page }) => {
  await page.goto('/studio/objects/obj_reference_fan/calibration-lab');
  await expect(page).toHaveURL(/\/operator\/login/);
});
