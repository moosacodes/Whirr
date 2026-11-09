import path from 'node:path';
import { expect, test } from '@playwright/test';
import { Store } from '../../apps/api/src/db/index.ts';

function latestProofId(): string | null {
  try {
    const store = new Store(path.resolve('data/whirr.db'));
    const row = store.get<{ id: string }>('SELECT id FROM proof_bundles ORDER BY created_at DESC LIMIT 1');
    store.close();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

const proofId = latestProofId();

async function expectNoPageOverflow(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test.describe('public proof surfaces', () => {
  test.skip(!proofId, 'Run npm run setup and open a receipt to create a proof bundle first.');

  test('proof page renders without page-level horizontal overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/proof/${proofId}`);
    await expect(page.getByRole('heading', { name: 'Portable proof of use.' })).toBeVisible();
    await expect(page.getByText('offline verification passes')).toBeVisible();
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Tamper Lab accepts the bundle and rejects an interval edit', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByRole('heading', { name: 'Check the seal, not the story.' })).toBeVisible();

    await page.evaluate(async (id) => {
      const bundle = await fetch(`/api/proof-bundles/${id}`).then((response) => response.json());
      const textarea = document.querySelector('textarea')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, JSON.stringify(bundle, null, 2));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }, proofId);
    await page.getByRole('button', { name: 'Verify pasted JSON' }).click();
    await expect(page.getByText('signature + semantics pass')).toBeVisible();
    await page.getByRole('button', { name: 'Edit an interval' }).click();
    await expect(page.getByText('does not verify')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('standalone single-file verifier works without application imports', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/verify-offline.html');
    await expect(page.getByRole('heading', { name: 'Check the bytes, not the server.' })).toBeVisible();
    const outcome = await page.evaluate(async (id) => {
      const bundle = await fetch(`/api/proof-bundles/${id}`).then((response) => response.json());
      const verifier = window as unknown as { check: (value: unknown) => Promise<void> };
      await verifier.check(bundle);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        verdict: document.getElementById('verdict')?.textContent ?? '',
        failed: document.querySelectorAll('.check.fail').length,
        passed: document.querySelectorAll('.check.pass').length,
      };
    }, proofId);
    expect(outcome.verdict).toBe('ALL CHECKS PASS');
    expect(outcome.failed).toBe(0);
    expect(outcome.passed).toBeGreaterThanOrEqual(15);
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
  });
});
