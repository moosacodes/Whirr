import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

const base = process.env.WHIRR_WEB_URL ?? 'http://localhost:5173';
const api = process.env.WHIRR_API_URL ?? 'http://127.0.0.1:8787';
const out = 'docs/v7';

type JudgeSeed = {
  agreementId: string;
  qualifiedSessionId: string;
  interruptedSessionId: string;
};

type JudgeView = {
  available: boolean;
  seed?: JudgeSeed;
};

const viewports = [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'tablet', width: 834, height: 1112 },
  { label: 'mobile', width: 390, height: 844 },
];

async function seekReplayToEnd(page: Page): Promise<void> {
  const range = page.locator('.window-scrub input[type="range"]');
  if ((await range.count()) === 0) return;
  const max = await range.getAttribute('max');
  if (!max) return;
  await range.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, max);
  await page.waitForTimeout(250);
}

async function main(): Promise<void> {
  const judge = await fetch(`${api}/api/ambient/judge`).then((response) => response.json() as Promise<JudgeView>);
  if (!judge.available || !judge.seed) {
    throw new Error('Judge replay is unavailable. Start the seeded API before capturing v7.');
  }

  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const extra: Array<{ name: string; path: string; seek?: boolean }> = [
    {
      name: 'window-interrupted-1440',
      path: `/ambient/window/${judge.seed.interruptedSessionId}?replay=1`,
      seek: true,
    },
    {
      name: 'accord-interrupted-1440',
      path: `/ambient/accord/${judge.seed.interruptedSessionId}?replay=1`,
    },
  ];

  const surface = (name: string, path: string, seek = false) => ({ name, path, seek });

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    const surfaces = [
      surface('ambient', '/ambient'),
      surface('wish', '/ambient/wish'),
      surface('evidence', '/ambient/judge'),
      surface('exchange', `/ambient/exchange/${judge.seed.agreementId}`),
      surface('window', `/ambient/window/${judge.seed.qualifiedSessionId}?replay=1`, true),
      surface('accord', `/ambient/accord/${judge.seed.qualifiedSessionId}?replay=1`),
    ];

    for (const item of surfaces) {
      await page.goto(`${base}${item.path}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor();
      if (item.seek) await seekReplayToEnd(page);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (overflow) throw new Error(`${item.name}-${viewport.width} has horizontal overflow.`);
      await page.screenshot({
        path: `${out}/${item.name}-${viewport.width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
      console.log(`Captured ${item.name}-${viewport.width}.png`);
    }

    if (viewport.width === 1440) {
      for (const item of extra) {
        await page.goto(`${base}${item.path}`, { waitUntil: 'networkidle' });
        await page.locator('h1').first().waitFor();
        if (item.seek) await seekReplayToEnd(page);
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        if (overflow) throw new Error(`${item.name} has horizontal overflow.`);
        await page.screenshot({
          path: `${out}/${item.name}.png`,
          fullPage: false,
          animations: 'disabled',
        });
        console.log(`Captured ${item.name}.png`);
      }
    }

    if (errors.length > 0) throw new Error(`${viewport.label} runtime errors:\n${errors.join('\n')}`);
    await context.close();
  }

  await browser.close();
  console.log(`Captured 7.0 interface evidence in ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
