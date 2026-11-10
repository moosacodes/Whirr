import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type {
  AgreementView,
  EventModelDetailView,
  PromiseCatalogView,
  PromiseExecutionView,
  PromiseJudgeView,
  PromiseLabView,
  PromiseProofView,
} from '../../packages/contracts/src/types.ts';
import type { CompiledAgreement } from '../../packages/promise/src/types.ts';
import { verifyPhysicalProofDocument } from '../../packages/verify/src/physical.ts';

const TEST_KEY = 'promise-operator-key-0123456789abcdef';
const TEST_SECRET = 'promise-cookie-secret-0123456789abcdef0123456789abcdef';
const OBJECT_ID = 'obj_reference_fan';

let tempDir: string;
let app: FastifyInstance;
let ctx: AppContext;
let renterCookie: string;
let operatorCookie: string;
let agreement: AgreementView;

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('No set-cookie header');
  return first.split(';')[0]!;
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  options: { cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-whirr-csrf'] = '1';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload: options.body as never });
}

async function createDemoExecution(): Promise<PromiseExecutionView> {
  const created = await call('POST', `/api/promises/${agreement.id}/executions`, {
    cookie: renterCookie,
    body: { termsHash: agreement.termsHash, accepted: true, demo: true, observationMode: 'LIVE' },
  });
  expect(created.statusCode).toBe(201);
  return created.json<PromiseExecutionView>();
}

async function observe(executionId: string, intervals: unknown[]): Promise<PromiseExecutionView> {
  const started = await call('POST', `/api/promises/executions/${executionId}/start`, {
    cookie: renterCookie,
    body: {},
  });
  expect(started.statusCode).toBe(200);
  const appended = await call('POST', `/api/promises/executions/${executionId}/observations`, {
    cookie: renterCookie,
    body: { clientSeq: 1, intervals },
  });
  expect(appended.statusCode).toBe(200);
  const stopped = await call('POST', `/api/promises/executions/${executionId}/stop`, {
    cookie: renterCookie,
    body: { reason: 'USER_STOP' },
  });
  expect(stopped.statusCode).toBe(200);
  return stopped.json<PromiseExecutionView>();
}

beforeAll(async () => {
  const seeded = path.resolve(process.cwd(), 'data/whirr.db');
  if (!existsSync(seeded)) throw new Error('Run `npm run setup` before the promise integration test.');
  tempDir = mkdtempSync(path.join(tmpdir(), 'whirr-promise-'));
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
    port: 8790,
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

  const renter = await call('POST', '/api/auth/renter', { body: {} });
  expect(renter.statusCode).toBe(200);
  renterCookie = cookieOf(renter);
  const operator = await call('POST', '/api/auth/operator', { body: { key: TEST_KEY } });
  expect(operator.statusCode).toBe(200);
  operatorCookie = cookieOf(operator);

  const lab = await call('GET', `/api/operator/promises/lab?objectId=${OBJECT_ID}`, { cookie: operatorCookie });
  expect(lab.statusCode).toBe(200);
  const labView = lab.json<PromiseLabView>();
  expect(labView.selected?.eventModel?.status).toBe('READY');
  expect(labView.selected?.eventModel?.provenance).toBe('SYNTHETIC_REFERENCE');

  const compiled = await call('POST', '/api/operator/promises/compile', {
    cookie: operatorCookie,
    body: {
      objectId: OBJECT_ID,
      eventModelId: labView.selected!.eventModel!.id,
      serviceName: 'Integration qualified fan cycle',
      text:
        'Charge $2 for one complete cycle. The machine must run for at least 15 seconds and return to idle. Do not charge if it stops early or the microphone disconnects.',
    },
  });
  expect(compiled.statusCode).toBe(200);
  const compiledView = compiled.json<CompiledAgreement>();
  expect(compiledView.executable).toBe(true);

  const published = await call('POST', '/api/operator/promises/publish', {
    cookie: operatorCookie,
    body: {
      objectId: OBJECT_ID,
      eventModelId: labView.selected!.eventModel!.id,
      serviceName: compiledView.terms.serviceName,
      text: compiledView.proposal.text,
      termsHash: compiledView.hash,
      terms: compiledView.terms,
      approved: true,
    },
  });
  expect([201, 200]).toContain(published.statusCode);
  agreement = published.json<AgreementView>();
  expect(agreement.termsHash).toBe(compiledView.hash);
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('physical promise API lifecycle', () => {
  it('publishes a synthetic reference model without presenting it as field evidence', async () => {
    const catalog = await call('GET', '/api/promises');
    expect(catalog.statusCode).toBe(200);
    const catalogView = catalog.json<PromiseCatalogView>();
    expect(catalogView.items.some((item) => item.agreement.id === agreement.id)).toBe(true);
    expect(catalogView.limitations.join(' ')).toMatch(/do not prove|not prove|field/i);

    const judge = await call('GET', '/api/promises/judge');
    expect(judge.statusCode).toBe(200);
    const judgeView = judge.json<PromiseJudgeView>();
    expect(judgeView.seed.provenance).toBe('SYNTHETIC_REFERENCE');
    expect(judgeView.evidence.physicalFieldTrial).toBe('OPEN_NOT_RUN');
  });

  it('serves the operator model review only to the owning operator', async () => {
    const lab = await call('GET', `/api/operator/promises/lab?objectId=${OBJECT_ID}`, { cookie: operatorCookie });
    const modelId = lab.json<PromiseLabView>().selected!.eventModel!.id;
    const detail = await call('GET', `/api/operator/promises/model/${modelId}`, { cookie: operatorCookie });
    expect(detail.statusCode).toBe(200);
    const view = detail.json<EventModelDetailView>();
    expect(view.id).toBe(modelId);
    expect(view.artifact).toBeTruthy();
    expect(view.takeCount).toBeGreaterThan(0);

    const forbidden = await call('GET', `/api/operator/promises/model/${modelId}`, { cookie: renterCookie });
    expect(forbidden.statusCode).toBe(401);
    const anonymous = await call('GET', `/api/operator/promises/model/${modelId}`);
    expect(anonymous.statusCode).toBe(401);
  });

  it('qualifies a complete sequence and produces an independently rechecked proof', async () => {
    const execution = await createDemoExecution();
    expect(execution.demo).toBe(true);
    expect(execution.quote.fixedPriceMinor).toBe(200);

    const resolved = await observe(execution.id, [
      { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
      { seq: 2, startMs: 5_000, endMs: 22_000, state: 'ACTIVE_CONFIDENT', confidence: 0.96, qualityFlags: [], eventMatch: 0.9 },
      { seq: 3, startMs: 22_000, endMs: 27_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
    ]);
    expect(resolved.outcome).toBe('QUALIFIED');
    expect(resolved.eligibleForCapture).toBe(true);
    expect(resolved.runMs).toBe(17_000);
    expect(resolved.proofId).toBeNull();

    const capture = await call('POST', `/api/promises/executions/${execution.id}/capture`, {
      cookie: renterCookie,
      body: {},
    });
    expect(capture.statusCode).toBe(409);
    expect(capture.json<{ error: { code: string } }>().error.code).toBe('DEMO_EXECUTION');

    const proofResponse = await call('GET', `/api/promises/executions/${execution.id}/proof`, { cookie: renterCookie });
    expect(proofResponse.statusCode).toBe(200);
    const proof = proofResponse.json<PromiseProofView>();
    expect(proof.verification.valid).toBe(true);
    expect(proof.verification.evaluationMatches).toBe(true);
    expect(proof.verification.agreementHashValid).toBe(true);
    expect(proof.verification.paymentConsistent).toBe(true);

    const publicVerify = await call('GET', `/api/promises/proofs/${proof.id}/verify`);
    expect(publicVerify.statusCode).toBe(200);
    expect(publicVerify.json<PromiseProofView>().verification.valid).toBe(true);

    const tampered = JSON.parse(JSON.stringify(proof.publicDocument)) as {
      payload: { observations: Array<{ state: string }> };
    };
    tampered.payload.observations[0]!.state = 'DISCONNECTED';
    const tamperResult = await verifyPhysicalProofDocument(tampered);
    expect(tamperResult.valid).toBe(false);
    expect(tamperResult.signatureValid).toBe(false);
  });

  it('withholds eligibility for an interrupted attempt', async () => {
    const execution = await createDemoExecution();
    const resolved = await observe(execution.id, [
      { seq: 1, startMs: 0, endMs: 4_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
      { seq: 2, startMs: 4_000, endMs: 14_000, state: 'ACTIVE_CONFIDENT', confidence: 0.93, qualityFlags: [] },
      { seq: 3, startMs: 14_000, endMs: 20_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
    ]);
    expect(resolved.outcome).toBe('INTERRUPTED');
    expect(resolved.eligibleForCapture).toBe(false);
    expect(resolved.flags.canCapture).toBe(false);

    const proofResponse = await call('GET', `/api/promises/executions/${execution.id}/proof`, { cookie: renterCookie });
    expect(proofResponse.statusCode).toBe(200);
    expect(proofResponse.json<PromiseProofView>().verification.valid).toBe(true);
  });

  it('rejects stale observation sequences and a repeated stop cannot capture', async () => {
    const execution = await createDemoExecution();
    const started = await call('POST', `/api/promises/executions/${execution.id}/start`, {
      cookie: renterCookie,
      body: {},
    });
    expect(started.statusCode).toBe(200);
    const first = await call('POST', `/api/promises/executions/${execution.id}/observations`, {
      cookie: renterCookie,
      body: {
        clientSeq: 1,
        intervals: [{ seq: 1, startMs: 0, endMs: 2_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] }],
      },
    });
    expect(first.statusCode).toBe(200);
    const duplicate = await call('POST', `/api/promises/executions/${execution.id}/observations`, {
      cookie: renterCookie,
      body: {
        clientSeq: 2,
        intervals: [{ seq: 1, startMs: 2_000, endMs: 4_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] }],
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const stopped = await call('POST', `/api/promises/executions/${execution.id}/stop`, {
      cookie: renterCookie,
      body: { reason: 'USER_STOP' },
    });
    expect(stopped.statusCode).toBe(200);
    const again = await call('POST', `/api/promises/executions/${execution.id}/stop`, {
      cookie: renterCookie,
      body: { reason: 'USER_STOP' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<PromiseExecutionView>().eligibleForCapture).toBe(false);
    expect(ctx.store.get<{ count: number }>('SELECT COUNT(*) AS count FROM promise_proofs WHERE execution_id = ?', execution.id)?.count).toBe(0);
  });
});
