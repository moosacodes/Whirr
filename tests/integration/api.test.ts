import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type { SessionView } from '../../packages/contracts/src/types.ts';

const TEST_KEY = 'test-operator-key-0123456789abcdef';
const TEST_SECRET = 'test-cookie-secret-0123456789abcdef0123456789abcdef';

let tempDir: string;
let app: FastifyInstance;
let ctx: AppContext;
let renterCookie: string;
let operatorCookie: string;
let sessionId: string;

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('No set-cookie header');
  return first.split(';')[0]!;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; body?: unknown; csrf?: boolean; origin?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-whirr-csrf'] = '1';
  if (options.csrf === false) delete headers['x-whirr-csrf'];
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload: options.body as never });
}

beforeAll(async () => {
  const seeded = path.resolve(process.cwd(), 'data/whirr.db');
  if (!existsSync(seeded)) throw new Error('Run `npm run setup` before the integration test (data/whirr.db is missing).');
  tempDir = mkdtempSync(path.join(tmpdir(), 'whirr-api-'));
  mkdirSync(path.join(tempDir, 'data'), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${seeded}${suffix}`;
    if (existsSync(source)) copyFileSync(source, path.join(tempDir, 'data', `whirr.db${suffix}`));
  }
  const config: Config = loadConfig({
    rootDir: tempDir,
    operatorKey: TEST_KEY,
    cookieSecret: TEST_SECRET,
    serveStatic: false,
    publicOrigins: ['http://localhost:5173'],
    primaryPublicOrigin: 'http://localhost:5173',
    port: 8788,
    paypal: {
      configured: false,
      env: 'sandbox',
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: '',
      clientSecret: '',
      webhookId: null,
      webhookConfigured: false,
    },
  });
  const created = await createApp(config, { logger: false });
  app = created.app;
  ctx = created.ctx;

  // The fixture database is copied from the developer's installation. Remove
  // its runtime history so a genuine local capture cannot change test outcomes;
  // the seeded object, model and terms remain available.
  ctx.store.run('DELETE FROM sessions');
  ctx.store.run('DELETE FROM paypal_webhook_events');

  const renter = await call('POST', '/api/auth/renter', { body: {} });
  expect(renter.statusCode).toBe(200);
  renterCookie = cookieOf(renter);

  const login = await call('POST', '/api/auth/operator', { body: { key: TEST_KEY } });
  expect(login.statusCode).toBe(200);
  operatorCookie = cookieOf(login);
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('security plumbing', () => {
  it('enforces CSRF, origin and operator guards', async () => {
    const noCsrf = await call('POST', '/api/auth/renter', { body: {}, csrf: false });
    expect(noCsrf.statusCode).toBe(403);

    const foreign = await call('POST', '/api/sessions', {
      origin: 'https://evil.example',
      body: { objectId: 'obj_reference_fan' },
    });
    expect(foreign.statusCode).toBe(403);

    const unauth = await call('GET', '/api/operator/objects');
    expect(unauth.statusCode).toBe(401);

    const operator = await call('GET', '/api/operator/objects', { cookie: operatorCookie });
    expect(operator.statusCode).toBe(200);

    const artifact = await call('GET', '/api/operator/objects/obj_reference_fan/model-artifact', {
      cookie: operatorCookie,
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json<{ artifact: { status: string } }>().artifact.status).toBe('READY');
  });

  it('publishes an acoustic passport without authentication and does not invent one for unknown objects', async () => {
    const response = await call('GET', '/api/passport/obj_reference_fan');
    expect(response.statusCode).toBe(200);
    const passport = response.json<{
      object: { id: string; name: string };
      model: { status: string; soundprint: { status: string; gateEnabled: boolean; matchThreshold: number } | null };
      soundprint: { status: string; gateEnabled: boolean; bands: unknown[]; matchThreshold: number } | null;
      shareUrl: string;
    }>();
    expect(passport.object.id).toBe('obj_reference_fan');
    expect(passport.object.name).toContain('Reference');
    expect(passport.model.soundprint).not.toBeNull();
    expect(passport.soundprint).not.toBeNull();
    expect(passport.soundprint?.gateEnabled).toBe(true);
    expect(passport.soundprint?.bands).toHaveLength(8);
    expect(passport.soundprint?.matchThreshold).toBeGreaterThan(0.5);
    expect(passport.shareUrl).toContain('/s/obj_reference_fan');

    const missing = await call('GET', '/api/passport/obj_does_not_exist');
    expect(missing.statusCode).toBe(404);
  });

  it('refuses PayPal order creation without Sandbox credentials', async () => {
    const service = await call('GET', '/api/service/obj_reference_fan');
    expect(service.statusCode).toBe(200);
    const created = await call('POST', '/api/sessions', {
      cookie: renterCookie,
      body: { objectId: 'obj_reference_fan' },
    });
    expect(created.statusCode).toBe(201);
    const view = created.json<SessionView>();
    await call('POST', `/api/sessions/${view.id}/consent`, {
      cookie: renterCookie,
      body: { termsHash: view.termsHash, accepted: true },
    });
    const order = await call('POST', `/api/sessions/${view.id}/paypal/order`, {
      cookie: renterCookie,
      body: {},
    });
    expect(order.statusCode).toBe(503);
  });
});

describe('complete demo-mode metering and settlement', () => {
  it('meters only confident active time, reviews it, and produces a verified no-payment receipt', async () => {
    const service = await call('GET', '/api/service/obj_reference_fan');
    const serviceView = service.json<{ termsHash: string }>();

    const created = await call('POST', '/api/sessions', {
      cookie: renterCookie,
      body: { objectId: 'obj_reference_fan' },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<SessionView>();
    sessionId = session.id;

    const consent = await call('POST', `/api/sessions/${sessionId}/consent`, {
      cookie: renterCookie,
      body: { termsHash: serviceView.termsHash, accepted: true, displayName: 'Test renter' },
    });
    expect(consent.statusCode).toBe(200);

    const demo = await call('POST', `/api/sessions/${sessionId}/demo-mode`, { cookie: renterCookie, body: {} });
    expect(demo.statusCode).toBe(200);
    expect(demo.json<SessionView>().paymentState).toBe('DEMO_MODE');

    const started = await call('POST', `/api/sessions/${sessionId}/start`, { cookie: renterCookie, body: {} });
    expect(started.statusCode).toBe(200);
    const active = started.json<SessionView>();
    expect(active.state).toBe('ACTIVE');

    // Move the authoritative clock back so the test can submit 80 seconds of evidence.
    ctx.store.run(
      'UPDATE sessions SET started_at = ? WHERE id = ?',
      new Date(Date.now() - 120_000).toISOString(),
      sessionId,
    );

    const intervalBody = {
      token: active.sessionToken,
      clientSeq: 1,
      intervals: [
        { startMs: 0, endMs: 60_000, state: 'ACTIVE_CONFIDENT', confidence: 0.97, modelVersion: active.model.version },
        { startMs: 60_000, endMs: 70_000, state: 'IDLE', confidence: 0.9, modelVersion: active.model.version },
        { startMs: 70_000, endMs: 80_000, state: 'UNCERTAIN', confidence: 0.52, qualityFlags: ['CLIPPED'], modelVersion: active.model.version },
        { startMs: 80_000, endMs: 85_000, state: 'UNCERTAIN', confidence: 0.88, qualityFlags: ['SOUNDPRINT_MISMATCH'], modelVersion: active.model.version },
      ],
    };
    const intervals = await call('POST', `/api/sessions/${sessionId}/intervals`, {
      cookie: renterCookie,
      body: intervalBody,
    });
    expect(intervals.statusCode).toBe(200);
    expect(intervals.json<{ billableMs: number }>().billableMs).toBe(60_000);

    const duplicate = await call('POST', `/api/sessions/${sessionId}/intervals`, {
      cookie: renterCookie,
      body: intervalBody,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json<{ duplicate: boolean }>().duplicate).toBe(true);

    const outOfOrder = await call('POST', `/api/sessions/${sessionId}/intervals`, {
      cookie: renterCookie,
      body: { ...intervalBody, clientSeq: 3, intervals: [{ ...intervalBody.intervals[0], startMs: 80_000, endMs: 81_000 }] },
    });
    expect(outOfOrder.statusCode).toBe(409);

    const overlap = await call('POST', `/api/sessions/${sessionId}/intervals`, {
      cookie: renterCookie,
      body: { ...intervalBody, clientSeq: 2, intervals: [{ ...intervalBody.intervals[0], startMs: 59_000, endMs: 61_000 }] },
    });
    expect(overlap.statusCode).toBe(409);

    const stopped = await call('POST', `/api/sessions/${sessionId}/stop`, { cookie: renterCookie, body: {} });
    expect(stopped.statusCode).toBe(200);
    const stoppedView = stopped.json<SessionView>();
    expect(stoppedView.billableMs).toBe(60_000);
    expect(stoppedView.excludedMs).toBe(15_000);
    expect(stoppedView.quote.quoteMinor).toBe(20);

    const accepted = await call('POST', `/api/sessions/${sessionId}/review/accept`, {
      cookie: renterCookie,
      body: { quoteHash: stoppedView.quote.quoteHash, accepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<SessionView>().state).toBe('REVIEWED');

    const completed = await call('POST', `/api/sessions/${sessionId}/demo-complete`, {
      cookie: renterCookie,
      body: {},
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<SessionView>().state).toBe('DEMO_COMPLETED');

    const receipt = await call('GET', `/api/sessions/${sessionId}/receipt`, { cookie: renterCookie });
    expect(receipt.statusCode).toBe(200);
    const receiptBody = receipt.json<{
      receipt: {
        payment: { mode: string; state: string };
        pricing: { quoteMinor: number };
        passport: { status: string; gateEnabled: boolean; mismatchIntervals: number; mismatchMs: number };
        finalized: boolean;
      };
      verification: {
        quoteMatches: boolean;
        capRespected: boolean;
        evidenceMatches: boolean;
        receiptHashMatches: boolean;
        intervalsConsistent: boolean;
        passportConsistent: boolean;
        providerAmountMatches: boolean | null;
        auditChainValid: boolean;
      };
    }>();
    expect(receiptBody.receipt.payment.mode).toBe('DEMO_NO_PAYMENT');
    expect(receiptBody.receipt.payment.state).toBe('DEMO_MODE');
    expect(receiptBody.receipt.pricing.quoteMinor).toBe(20);
    expect(receiptBody.receipt.finalized).toBe(true);
    expect(receiptBody.receipt.passport).toMatchObject({
      status: 'ENROLLED',
      gateEnabled: true,
      mismatchIntervals: 1,
      mismatchMs: 5_000,
    });
    expect(receiptBody.verification).toMatchObject({
      quoteMatches: true,
      capRespected: true,
      evidenceMatches: true,
      receiptHashMatches: true,
      intervalsConsistent: true,
      passportConsistent: true,
      providerAmountMatches: null,
      auditChainValid: true,
    });

    const judge = await call('GET', '/api/judge/status');
    expect(judge.statusCode).toBe(200);
    const checks = judge.json<{ checks: Array<{ id: string; status: string }> }>().checks;
    expect(checks.find((check) => check.id === 'audit_chain')?.status).toBe('PASS');
    expect(checks.find((check) => check.id === 'capture')?.status).toBe('OPEN');
  });

  it('does not expose a renter session to a different renter cookie', async () => {
    const secondRenter = await call('POST', '/api/auth/renter', { body: {} });
    const secondCookie = cookieOf(secondRenter);
    const response = await call('GET', `/api/sessions/${sessionId}`, { cookie: secondCookie });
    expect(response.statusCode).toBe(404);
  });
});
