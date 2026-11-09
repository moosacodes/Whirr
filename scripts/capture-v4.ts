import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.WHIRR_WEB_URL ?? 'http://127.0.0.1:5173';
const out = 'docs/v4';

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /Borrow the tool/i }).waitFor();
  await page.screenshot({ path: `${out}/landing-desktop.png`, fullPage: false });
  await page.screenshot({ path: `${out}/landing-desktop-full.png`, fullPage: true });

  await page.goto(`${base}/shelf`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /Tools with a sound tag/i }).waitFor();
  await page.screenshot({ path: `${out}/bench-desktop.png`, fullPage: true });

  await page.goto(`${base}/s/obj_reference_fan`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Reference desk fan' }).waitFor();
  await page.screenshot({ path: `${out}/bench-card-desktop.png`, fullPage: true });

  const checkbox = page.getByRole('checkbox');
  await checkbox.check();
  await page.getByRole('button', { name: /Authorize cap|Open the demo meter/ }).click();
  await page.waitForURL(/\/session\//);
  await page.getByRole('heading', { name: 'Reference desk fan' }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/listening-room-desktop.png`, fullPage: false });
  await page.screenshot({ path: `${out}/listening-room-desktop-full.png`, fullPage: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();

  await mobilePage.goto(`${base}/`, { waitUntil: 'networkidle' });
  await mobilePage.getByRole('heading', { name: /Borrow the tool/i }).waitFor();
  await mobilePage.screenshot({ path: `${out}/landing-mobile.png`, fullPage: false });

  await mobilePage.goto(`${base}/shelf`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: `${out}/bench-mobile.png`, fullPage: false });

  await mobilePage.goto(`${base}/s/obj_reference_fan`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: `${out}/bench-card-mobile.png`, fullPage: false });

  await browser.close();
  console.log(`Captured Whirr 4.0 surfaces in ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
