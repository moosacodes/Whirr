import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Store } from '../../apps/api/src/db/index.ts';
import { loadConfig } from '../../apps/api/src/config.ts';

function latestSession(states: string[]): string | null {
  try {
    const store = new Store(path.resolve('data/whirr.db'));
    const placeholders = states.map(() => '?').join(',');
    const row = store.get<{ id: string }>(
      `SELECT id FROM sessions WHERE state IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
      ...states,
    );
    store.close();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

const reviewableSession = latestSession(['STOPPED', 'REVIEWED', 'SETTLEMENT_PENDING', 'SETTLED', 'NO_CHARGE', 'DEMO_COMPLETED']);
const replayableSession = latestSession(['ACTIVE', 'PAUSED', 'STOPPED', 'REVIEWED', 'SETTLED', 'DEMO_COMPLETED']);

async function expectNoPageOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${String(element.className).split(' ').filter(Boolean).slice(0, 2).join('.')}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          text: (element.textContent ?? '').trim().slice(0, 60),
        };
      })
      .filter((item) => item.right > clientWidth + 1 || item.scrollWidth > item.width + 1)
      .slice(0, 8);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth, offenders };
  });
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function visit(page: Page, url: string, settleMs = 350): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(settleMs);
  await expect(page.locator('h1').first()).toBeVisible();
  await expectNoPageOverflow(page);
  return errors;
}

async function signInAsOperator(page: Page): Promise<void> {
  const config = loadConfig();
  await page.goto('/operator/login');
  await page.getByLabel('Operator key').fill(config.operatorKey);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/studio$/);
}

test.describe('public pages', () => {
  const pages = [
    ['/', 'landing'],
    ['/shelf', 'shelf'],
    ['/s/obj_reference_fan', 'service card'],
    ['/passport/obj_reference_fan', 'passport'],
    ['/judge', 'judge'],
    ['/verify', 'tamper lab'],
    ['/demo/offline', 'offline demo'],
    ['/verify-offline.html', 'standalone verifier'],
  ] as const;

  for (const [url, label] of pages) {
    test(`${label} renders without overflow or runtime errors`, async ({ page }) => {
      const errors = await visit(page, url);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test.describe('v4 bench experience', () => {
  test('bench story, sound tag and ticket surfaces render cleanly', async ({ page }) => {
    await visit(page, '/');
    await expect(page.getByRole('heading', { name: /Borrow the tool/i })).toBeVisible();
    await expect(page.getByText('A timer bills the clock.')).toBeVisible();
    await expect(page.getByText('PayPal is the handshake')).toBeVisible();

    await visit(page, '/shelf');
    await expect(page.getByRole('heading', { name: /Tools with a sound tag/i })).toBeVisible();
    await expect(page.getByText('Sound tag').first()).toBeVisible();
    await expect(page.getByText('Pay for the run, not the clock.')).toBeVisible();

    await visit(page, '/s/obj_reference_fan');
    await expect(page.getByRole('heading', { name: 'Reference desk fan' })).toBeVisible();
    await expect(page.getByText('Authorize the cap. Then use the tool.')).toBeVisible();
    await expect(page.getByText('Sound tag').first()).toBeVisible();
  });
});

test.describe('operator pages', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsOperator(page);
  });

  test('all operator and evidence surfaces render without overflow or runtime errors', async ({ page }) => {
    const pages = [
      ['/operator', 'operator console'],
      ['/studio', 'studio'],
      ['/studio/objects/obj_reference_fan', 'capture lab'],
      ['/studio/objects/obj_reference_fan/model', 'model review'],
      ['/studio/objects/obj_reference_fan/pricing', 'pricing'],
      ['/studio/objects/obj_reference_fan/card', 'service card studio'],
      ['/studio/objects/obj_reference_fan/poster', 'poster'],
      ['/studio/objects/obj_reference_fan/gate-a', 'Gate A trials'],
    ] as const;

    for (const [url, label] of pages) {
      const errors = await visit(page, url);
      expect(errors, `${label}: ${errors.join('\n')}`).toEqual([]);
    }

    await visit(page, '/studio/objects/obj_reference_fan/gate-a');
    await expect(page.getByText('Three live ON/OFF trials.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start ON capture/ })).toBeVisible();
    await expect(page.getByText(/Gate A remains OPEN/)).toBeVisible();
    await expect(page.getByText(/live microphone only/)).toBeVisible();

    await visit(page, '/operator');
    await expect(page.getByRole('heading', { name: 'Disputes', exact: true })).toBeVisible();
    await expect(page.getByText(/Webhooks/i).first()).toBeVisible();

    if (reviewableSession) {
      const receiptErrors = await visit(page, `/receipt/${reviewableSession}`);
      expect(receiptErrors, `receipt: ${receiptErrors.join('\n')}`).toEqual([]);
      const reviewErrors = await visit(page, `/session/${reviewableSession}/review`);
      expect(reviewErrors, `review: ${reviewErrors.join('\n')}`).toEqual([]);
    }
    if (replayableSession) {
      const replayErrors = await visit(page, `/session/${replayableSession}/replay`);
      expect(replayErrors, `replay: ${replayErrors.join('\n')}`).toEqual([]);
    }
  });
});