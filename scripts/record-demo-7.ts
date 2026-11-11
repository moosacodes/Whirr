import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

const execFileAsync = promisify(execFile);
const BASE = process.env.WHIRR_WEB_URL ?? 'http://localhost:5173';
const ROOT = path.resolve('recordings/whirr-7.0');
const CLIPS = path.join(ROOT, 'clips');
const FRAMES_ROOT = path.join(ROOT, '.frames');
const AUTH_STATE = path.join(ROOT, '.recording-auth.json');
const MANIFEST_PATH = path.join(ROOT, 'scene-manifest.json');
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const WISH_TEXT =
  'I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00.';
const QUALIFIED_ID = 'ase_reference_qualified';
const INTERRUPTED_ID = 'ase_reference_interrupted';

type CdpSession = Awaited<ReturnType<BrowserContext['newCDPSession']>>;

interface SceneResult {
  id: string;
  title: string;
  status: 'RECORDED' | 'NOT_RECORDED';
  file: string | null;
  url: string;
  recordedAt: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioStreams: number;
  whatItDemonstrates: string[];
  provenance: string;
  notes: string[];
}

interface RecordingAgreement {
  id: string;
  termsHash: string;
}

const CURSOR_SCRIPT = String.raw`
(() => {
  // The capture script is bundled by tsx; expose its helper name in the page context.
  window.__name = window.__name || ((fn) => fn);
  const install = () => {
    if (!document.body || document.getElementById('whirr-recording-cursor')) return;
    const style = document.createElement('style');
    style.textContent = [
      'html { scrollbar-width: none !important; }',
      '::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }',
      '#whirr-recording-cursor { position: fixed; left: 0; top: 0; width: 24px; height: 32px; z-index: 2147483647; pointer-events: none; transform-origin: 3px 3px; filter: drop-shadow(0 3px 3px rgba(0,0,0,.38)); will-change: transform; }',
      '#whirr-recording-cursor svg { display: block; width: 24px; height: 32px; }',
      '#whirr-recording-cursor.is-down { transform: var(--cursor-position) scale(.9); }',
    ].join('\n');
    const cursor = document.createElement('div');
    cursor.id = 'whirr-recording-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<svg viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2.5L20.5 18.2L12.4 19.4L16.9 28.2L13.4 30L8.7 21.1L3 26.1V2.5Z" fill="#fffdf7" stroke="#16120f" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(style);
    document.body.appendChild(cursor);
    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let down = false;
    const place = () => {
      const position = 'translate3d(' + (x - 3) + 'px,' + (y - 3) + 'px,0)';
      cursor.style.setProperty('--cursor-position', position);
      cursor.style.transform = position;
    };
    const onMove = (event) => {
      x = event.clientX;
      y = event.clientY;
      place();
    };
    const onDown = () => {
      down = true;
      cursor.classList.add('is-down');
      const position = 'translate3d(' + (x - 3) + 'px,' + (y - 3) + 'px,0)';
      cursor.style.setProperty('--cursor-position', position);
    };
    const onUp = () => {
      down = false;
      cursor.classList.remove('is-down');
      place();
    };
    addEventListener('mousemove', onMove, { passive: true });
    addEventListener('mousedown', onDown, { passive: true });
    addEventListener('mouseup', onUp, { passive: true });
    addEventListener('blur', onUp);
    place();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
`;

class CdpRecorder {
  private readonly client: CdpSession;
  private readonly frameDir: string;
  private latest: Buffer | null = null;
  private firstFrame: Promise<void>;
  private resolveFirstFrame: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writes: Promise<void> = Promise.resolve();
  private frameIndex = 0;
  private stopped = false;
  private lastTick = 0;

  constructor(client: CdpSession, frameDir: string) {
    this.client = client;
    this.frameDir = frameDir;
    this.firstFrame = new Promise((resolve) => {
      this.resolveFirstFrame = resolve;
    });
    this.client.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
      if (this.stopped) return;
      this.latest = Buffer.from(event.data, 'base64');
      if (this.resolveFirstFrame) {
        this.resolveFirstFrame();
        this.resolveFirstFrame = null;
      }
      void this.client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
  }

  async start(): Promise<void> {
    await mkdir(this.frameDir, { recursive: true });
    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyNthFrame: 1,
    });
    await Promise.race([this.firstFrame, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (!this.latest) throw new Error('Chrome did not provide a screencast frame.');
    this.lastTick = performance.now();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.stopped) return;
    const interval = 1000 / FPS;
    this.lastTick += interval;
    const delay = Math.max(0, this.lastTick - performance.now());
    this.timer = setTimeout(() => {
      this.captureTick();
      this.scheduleTick();
    }, delay);
  }

  private captureTick(): void {
    if (this.stopped || !this.latest) return;
    const frame = this.latest;
    const index = this.frameIndex++;
    this.writes = this.writes.then(() =>
      writeFile(path.join(this.frameDir, `frame-${String(index).padStart(6, '0')}.jpg`), frame),
    );
  }

  async stop(): Promise<{ frames: number; durationSeconds: number }> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.writes;
    await this.client.send('Page.stopScreencast').catch(() => {});
    await this.writes;
    if (this.frameIndex < 5) throw new Error(`Only ${this.frameIndex} frames were captured.`);
    return { frames: this.frameIndex, durationSeconds: this.frameIndex / FPS };
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayForChar(character: string): number {
  if (character === ' ') return 38 + Math.floor(Math.random() * 28);
  if ('.,;:'.includes(character)) return 150 + Math.floor(Math.random() * 90);
  return 42 + Math.floor(Math.random() * 44);
}

async function smoothScroll(page: Page, targetY: number, duration = 950): Promise<void> {
  await page.evaluate(
    async ({ targetY: destination, duration: scrollDuration }) => {
      const start = window.scrollY;
      const change = destination - start;
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / scrollDuration);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          window.scrollTo(0, start + change * eased);
          if (progress < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    },
    { targetY, duration },
  );
  await page.waitForTimeout(350);
}

async function scrollToLocator(page: Page, locator: Locator, topOffset = 170): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  const targetY = await locator.evaluate(
    (element, offset) => {
      const rect = element.getBoundingClientRect();
      return Math.max(0, window.scrollY + rect.top - offset);
    },
    topOffset,
  );
  await smoothScroll(page, targetY);
}

async function clickLocator(page: Page, locator: Locator, label: string): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await scrollToLocator(page, locator);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${label}.`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 30 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(110);
  await page.mouse.up();
  await page.waitForTimeout(650);
}

async function typeNaturally(page: Page, locator: Locator, text: string): Promise<void> {
  await clickLocator(page, locator, 'the buyer wish field');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(450);
  for (const character of text) {
    await page.keyboard.type(character);
    await page.waitForTimeout(delayForChar(character));
  }
  await page.waitForTimeout(800);
}

async function openPage(
  context: BrowserContext,
  route: string,
  options: { heading?: RegExp; requireSignedIn?: boolean } = {},
): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  if (options.heading && !(await page.getByRole('heading', { name: options.heading }).count())) {
    throw new Error(`Expected heading ${options.heading} at ${route}.`);
  }
  if (options.requireSignedIn) {
    const operatorStudio = page.getByRole('link', { name: 'Studio' });
    if (!(await operatorStudio.count())) throw new Error(`The recording context is not signed in as operator at ${route}.`);
  }
  (page as Page & { __recordingErrors?: string[] }).__recordingErrors = errors;
  return page;
}

function getPageErrors(page: Page): string[] {
  return (page as Page & { __recordingErrors?: string[] }).__recordingErrors ?? [];
}

async function encodeFrames(frameDir: string, output: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    path.join(frameDir, 'frame-%06d.jpg'),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ]);
}

async function probe(output: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  audioStreams: number;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of',
    'json',
    output,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height || !video.r_frame_rate) throw new Error(`No video stream in ${output}.`);
  const [numerator, denominator] = video.r_frame_rate.split('/').map(Number);
  return {
    duration: Number(parsed.format?.duration ?? 0),
    width: video.width,
    height: video.height,
    fps: numerator / denominator,
    codec: video.codec_name ?? 'unknown',
    audioStreams: parsed.streams?.filter((stream) => stream.codec_type === 'audio').length ?? 0,
  };
}

async function setupAgreement(browser: Browser): Promise<RecordingAgreement> {
  const key =
    process.env.WHIRR_OPERATOR_KEY ?? (await readFile(path.resolve('.whirr/operator-key'), 'utf8')).trim();
  if (!key) throw new Error('The local operator key is empty.');
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  try {
    await context.request.post(`${BASE}/api/auth/renter`, { headers: { 'x-whirr-csrf': '1' } });
    const compileResponse = await context.request.post(`${BASE}/api/ambient/compile`, {
      headers: { 'x-whirr-csrf': '1' },
      data: {
        objectId: 'obj_reference_fan',
        text: WISH_TEXT,
        durationSeconds: 30,
        fixedPriceMinor: 200,
        currency: 'USD',
      },
    });
    if (!compileResponse.ok()) throw new Error(`Compile failed: ${await compileResponse.text()}`);
    const compiled = (await compileResponse.json()) as { terms: unknown; hash: string; executable: boolean };
    if (!compiled.executable) throw new Error('The recording wish did not compile as executable.');
    const agreementResponse = await context.request.post(`${BASE}/api/ambient/agreements`, {
      headers: { 'x-whirr-csrf': '1' },
      data: { terms: compiled.terms, termsHash: compiled.hash, approved: true },
    });
    if (!agreementResponse.ok()) throw new Error(`Agreement creation failed: ${await agreementResponse.text()}`);
    const agreement = (await agreementResponse.json()) as { id: string; termsHash: string };
    const loginResponse = await context.request.post(`${BASE}/api/auth/operator`, {
      headers: { 'x-whirr-csrf': '1' },
      data: { key },
    });
    if (!loginResponse.ok()) throw new Error(`Operator sign-in failed: ${await loginResponse.text()}`);
    await context.storageState({ path: AUTH_STATE });
    return { id: agreement.id, termsHash: agreement.termsHash };
  } finally {
    await context.close();
  }
}

async function recordScene(
  browser: Browser,
  scene: {
    id: string;
    title: string;
    route: string;
    truth: string[];
    provenance: string;
    notes?: string[];
    auth?: boolean;
    run: (page: Page, agreement: RecordingAgreement) => Promise<void>;
  },
  agreement: RecordingAgreement,
): Promise<SceneResult> {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    storageState: scene.auth ? AUTH_STATE : undefined,
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const frameDir = path.join(FRAMES_ROOT, scene.id);
  await rm(frameDir, { recursive: true, force: true });
  const page = await openPage(context, scene.route, {
    requireSignedIn: scene.auth,
  });
  const client = await context.newCDPSession(page);
  const recorder = new CdpRecorder(client, frameDir);
  const startedAt = new Date().toISOString();
  let captureResult: { frames: number; durationSeconds: number } | null = null;
  try {
    await page.mouse.move(1780, 880);
    await page.waitForTimeout(500);
    await recorder.start();
    await page.waitForTimeout(700);
    await scene.run(page, agreement);
    captureResult = await recorder.stop();
    const errors = getPageErrors(page);
    if (errors.length > 0) throw new Error(`Runtime errors during ${scene.id}:\n${errors.join('\n')}`);
    await context.close();
    const file = path.join(CLIPS, `${scene.id}.mp4`);
    await encodeFrames(frameDir, file);
    const info = await probe(file);
    if (info.width !== WIDTH || info.height !== HEIGHT) throw new Error(`Unexpected dimensions for ${scene.id}.`);
    if (info.fps !== FPS) throw new Error(`Unexpected frame rate ${info.fps} for ${scene.id}.`);
    if (info.audioStreams !== 0) throw new Error(`Unexpected audio stream in ${scene.id}.`);
    await rm(frameDir, { recursive: true, force: true });
    return {
      id: scene.id,
      title: scene.title,
      status: 'RECORDED',
      file: path.relative(ROOT, file).replaceAll('\\', '/'),
      url: `${BASE}${scene.route}`,
      recordedAt: startedAt,
      durationSeconds: Number(info.duration.toFixed(3)),
      width: info.width,
      height: info.height,
      fps: info.fps,
      videoCodec: info.codec,
      audioStreams: info.audioStreams,
      whatItDemonstrates: scene.truth,
      provenance: scene.provenance,
      notes: scene.notes ?? [],
    };
  } finally {
    if (!captureResult) await recorder.stop().catch(() => {});
    await context.close().catch(() => {});
    if (!captureResult) await rm(frameDir, { recursive: true, force: true });
  }
}

function scenes() {
  return [
    {
      id: '01-product-introduction',
      title: 'Product introduction — the negotiated world',
      route: '/ambient',
      auth: false,
      truth: [
        'The current Whirr 7.0 Ambient overview and the redesigned witness field.',
        'The four-movement model is Whirr’s product thesis, not a recorded physical trial.',
      ],
      provenance: 'PRODUCT UI — live local application',
      run: async (page: Page) => {
        await pause(2_200);
        await smoothScroll(page, 720, 1_200);
        await pause(2_600);
        await smoothScroll(page, 1_180, 1_100);
        await pause(2_400);
        await smoothScroll(page, 0, 1_300);
        await pause(1_800);
      },
    },
    {
      id: '02-wish',
      title: 'The Wish — a buyer states a bounded request',
      route: '/ambient/wish',
      auth: false,
      truth: [
        'A buyer’s request is entered into the actual Wish field character by character.',
        'The deterministic compiler turns the request into a measurable source-specific condition.',
        'The selected source is the synthetic reference model; no physical fan is observed.',
      ],
      provenance: 'PRODUCT UI — live local application; synthetic reference source',
      notes: ['The request text is typed into the real textarea, not pasted.'],
      run: async (page: Page) => {
        const wish = page.locator('#ambient-text');
        await scrollToLocator(page, wish, 260);
        await pause(1_200);
        await typeNaturally(page, wish, WISH_TEXT);
        await pause(1_000);
        await clickLocator(page, page.getByRole('button', { name: 'Translate the wish' }), 'Translate the wish');
        await page.getByRole('heading', { name: /This is what Whirr can observe|This wish cannot be executed/ }).waitFor({
          state: 'visible',
          timeout: 10_000,
        });
        await pause(1_500);
        await scrollToLocator(page, page.locator('.wish-result'), 150);
        await pause(2_800);
        await scrollToLocator(page, page.locator('.wish-result .terms-sheet'), 160);
        await pause(3_200);
      },
    },
    {
      id: '03-exchange',
      title: 'The Exchange — provider acceptance and exact buyer consent',
      route: `/ambient/exchange/__AGREEMENT__`,
      auth: true,
      truth: [
        'The real local operator account accepts the buyer’s exact offer revision.',
        'The buyer separately approves the final terms hash before any session can begin.',
        'No PayPal order or capture is created by this clip.',
      ],
      provenance: 'PRODUCT UI — live local agreement created through the real API',
      notes: [
        'The provider is the local operator account; this is not two independent people.',
        'The agreement was created from the same request text used in clip 02.',
        'After provider acceptance, the local operator cookie is cleared and the page reloads to the buyer-only view, matching a separate buyer browser. No agreement, provider decision or consent is fabricated.',
      ],
      run: async (page: Page, agreement: RecordingAgreement) => {
        await scrollToLocator(page, page.getByText('Provider decision').first(), 180);
        await pause(1_300);
        await clickLocator(page, page.getByRole('button', { name: 'Accept exact terms' }), 'Accept exact terms');
        await page.getByText('The provider accepted the exact terms.').waitFor({ state: 'visible', timeout: 10_000 });
        await pause(1_600);
        await page.context().clearCookies({ name: 'whirr_op' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1_000);
        await scrollToLocator(page, page.getByText('Buyer approval').first(), 180);
        await pause(1_500);
        await clickLocator(page, page.getByRole('button', { name: 'Accept final terms' }), 'Accept final terms');
        await page.getByText('The exact final terms are accepted.').waitFor({ state: 'visible', timeout: 10_000 });
        await pause(1_600);
        await scrollToLocator(page, page.getByText('Current terms hash').first(), 180);
        await pause(2_400);
        await smoothScroll(page, 190, 800);
        await pause(1_400);
        void agreement;
      },
    },
    {
      id: '04-window-interrupted',
      title: 'The Window — interrupted replay, no capture',
      route: `/ambient/window/${INTERRUPTED_ID}?replay=1`,
      auth: false,
      truth: [
        'The labelled synthetic interrupted replay: the source returns during the quiet window and resets it.',
        'The evaluator returns INTERRUPTED and marks the session ineligible for capture.',
        'No microphone is open and no PayPal payment exists for this replay.',
      ],
      provenance: 'SYNTHETIC REPLAY — not physical evidence',
      notes: ['The replay is explicitly labelled SYNTHETIC REPLAY on screen.'],
      run: async (page: Page) => {
        await pause(1_400);
        await scrollToLocator(page, page.locator('.window-instrument'), 115);
        await pause(2_600);
        const pauseButton = page.getByRole('button', { name: 'Pause replay' });
        if (await pauseButton.count()) await clickLocator(page, pauseButton, 'Pause replay');
        await pause(900);
        const range = page.locator('.window-scrub input[type="range"]');
        if (await range.count()) {
          await scrollToLocator(page, range, 520);
          const box = await range.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 24 });
            await page.waitForTimeout(350);
            await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
          }
        }
        await pause(1_800);
        await scrollToLocator(page, page.getByText('Deterministic result').first(), 180);
        await pause(3_400);
        await scrollToLocator(page, page.getByText('What this instrument does not prove.').first(), 180);
        await pause(2_200);
      },
    },
    {
      id: '05-window-qualified',
      title: 'The Window — qualified replay, eligible result',
      route: `/ambient/window/${QUALIFIED_ID}?replay=1`,
      auth: false,
      truth: [
        'The labelled synthetic qualified replay: the source remains undetected for the full approved interval.',
        'The evaluator returns QUALIFIED and marks the result eligible for the contract.',
        'This is replay, not a live microphone measurement or a financial capture.',
      ],
      provenance: 'SYNTHETIC REPLAY — not physical evidence',
      notes: ['The replay is explicitly labelled SYNTHETIC REPLAY on screen.'],
      run: async (page: Page) => {
        await pause(1_400);
        await scrollToLocator(page, page.locator('.window-instrument'), 115);
        await pause(3_000);
        const pauseButton = page.getByRole('button', { name: 'Pause replay' });
        if (await pauseButton.count()) await clickLocator(page, pauseButton, 'Pause replay');
        await pause(800);
        const range = page.locator('.window-scrub input[type="range"]');
        if (await range.count()) {
          await scrollToLocator(page, range, 520);
          const box = await range.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 24 });
            await page.waitForTimeout(350);
            await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
          }
        }
        await pause(2_000);
        await scrollToLocator(page, page.getByText('Deterministic result').first(), 180);
        await pause(3_600);
        await scrollToLocator(page, page.getByText('What this instrument does not prove.').first(), 180);
        await pause(2_000);
      },
    },
    {
      id: '07-accord',
      title: 'The Accord — evidence, exact terms, payment status and verification',
      route: `/ambient/accord/${QUALIFIED_ID}?replay=1`,
      auth: false,
      truth: [
        'The qualified synthetic history is presented as a record, with DEMO_NO_PAYMENT on screen.',
        'The exact terms hash, interval ledger, buyer acceptance and open evidence boundary are inspectable.',
        'The signed proof independently recomputes integrity and contract checks; it does not prove physical silence.',
      ],
      provenance: 'SYNTHETIC REPLAY + SIGNED PROOF — no PayPal transaction',
      notes: ['The financial record explicitly says DEMO_NO_PAYMENT; no order, authorization or capture exists.'],
      run: async (page: Page) => {
        await pause(1_300);
        await scrollToLocator(page, page.locator('.accord-hero'), 100);
        await pause(2_600);
        await scrollToLocator(page, page.getByText('02 · The interval ledger').first(), 165);
        await pause(2_800);
        await scrollToLocator(page, page.getByText('03 · Consent and acceptance').first(), 165);
        await pause(2_600);
        await scrollToLocator(page, page.getByText('The financial record').first(), 165);
        await pause(3_000);
        await scrollToLocator(page, page.getByText('Verification').first(), 165);
        await pause(2_000);
        await clickLocator(page, page.getByRole('link', { name: /Inspect signed proof/ }), 'Inspect signed proof');
        await page.getByRole('heading', { name: /The record verifies/ }).waitFor({ state: 'visible', timeout: 10_000 });
        await pause(2_400);
        await scrollToLocator(page, page.getByText('The signed payload').first(), 165);
        await pause(2_800);
        await scrollToLocator(page, page.locator('.proof-domains').first(), 165);
        await pause(2_000);
      },
    },
    {
      id: '08-closing',
      title: 'Closing — the thesis and the quiet window',
      route: '/ambient',
      auth: false,
      truth: [
        'The closing statement returns to Whirr’s product thesis: cooperation as the product, not a dashboard.',
        'The thirty-second window is the visual signature; it is a product surface, not evidence of a physical event.',
      ],
      provenance: 'PRODUCT UI — live local application',
      run: async (page: Page) => {
        await pause(2_400);
        await smoothScroll(page, 240, 1_300);
        await pause(2_500);
        await smoothScroll(page, 0, 1_100);
        await pause(3_000);
      },
    },
  ];
}

async function main(): Promise<void> {
  const only = process.argv
    .find((argument) => argument.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .filter(Boolean);
  await mkdir(CLIPS, { recursive: true });
  await mkdir(FRAMES_ROOT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--force-device-scale-factor=1', '--font-render-hinting=none'],
  });
  const results: SceneResult[] = [];
  try {
    const health = await fetch(`${BASE}/api/health`).then((response) => response.json() as Promise<{
      status: string;
      paypal: { configured: boolean; env: string };
    }>);
    if (health.status !== 'ok') throw new Error('The Whirr API is not healthy.');
    const agreement = await setupAgreement(browser);
    const selected = scenes().filter((scene) => !only || only.includes(scene.id.slice(0, 2)));
    if (selected.length === 0) throw new Error(`No scenes matched --only=${only?.join(',')}.`);
    for (const scene of selected) {
      const route = scene.route.replace('__AGREEMENT__', agreement.id);
      const title = scene.title;
      process.stdout.write(`\n[${scene.id}] ${title}\n`);
      try {
        const result = await recordScene(browser, { ...scene, route }, agreement);
        results.push(result);
        process.stdout.write(
          `  recorded ${result.file} · ${result.durationSeconds?.toFixed(2)}s · ${result.width}x${result.height} · ${result.fps}fps\n`,
        );
      } catch (error) {
        process.stderr.write(`  FAILED: ${(error as Error).message}\n`);
        throw error;
      }
      const manifest = {
        generatedAt: new Date().toISOString(),
        browser: 'Google Chrome — page-only CDP screencast',
        viewport: `${WIDTH}x${HEIGHT}`,
        displayScale: '100%',
        fps: FPS,
        audio: 'none',
        cursor:
          'Presentation-only pointer overlay driven by real Playwright mouse events; all controls were clicked in the browser.',
        agreement: { id: agreement.id, request: WISH_TEXT },
        scenes: [
          ...results,
          {
            id: '06-paypal',
            title: 'PayPal Sandbox approval and capture',
            status: 'NOT_RECORDED',
            file: null,
            url: `${BASE}/ambient/window/<live-session>`,
            recordedAt: null,
            durationSeconds: null,
            width: null,
            height: null,
            fps: null,
            videoCodec: null,
            audioStreams: null,
            whatItDemonstrates: [],
            provenance: 'MISSING — no human buyer authorization',
            notes: [
              'No genuine 7.0 Sandbox order, buyer approval, authorization or capture was performed in this recording session.',
              'Per the recording brief, no PayPal checkout was fabricated and no older transaction was reused.',
              'A genuine clip can only be recorded after a human buyer completes the official Sandbox approval flow.',
            ],
          },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      };
      await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`\nManifest: ${MANIFEST_PATH}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
