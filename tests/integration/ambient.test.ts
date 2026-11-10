import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type {
  AmbientAgreementView,
  AmbientCatalogView,
  AmbientProofView,
  AmbientSessionView,
} from '../../packages/contracts/src/types.ts';
import type { CompiledAmbientAgreement } from '../../packages/ambient-engine/src/types.ts';
import { verifyAmbientProofDocument } from '../../packages/verify/src/ambient.ts';

const TEST_KEY = 'ambient-operator-key-0123456789abcdef';
const TEST_SECRET = 'ambient-cookie-secret-0123456789abcdef0123456789abcdef';
const OBJECT_ID = 'obj_reference_fan';

let tempDir: string;
let app: FastifyInstance;
let ctx: AppContext;
let renterCookie: string;
let operatorCookie: string;

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

async function compile(priceMinor = 200): Promise<CompiledAmbientAgreement> {
  const response = await call('POST', '/api/ambient/compile', {
    cookie: renterCookie,
    body: {
      objectId: OBJECT_ID,
      text: `I need a 30 second quiet window without the reference desk fan running. I will pay $${(priceMinor / 100).toFixed(2)}.`,
      durationSeconds: 30,
      fixedPriceMinor: priceMinor,
      currency: 'USD',
    },
  });
  expect(response.statusCode).toBe(200);
  const compiled = response.json<CompiledAmbientAgreement>();
  expect(compiled.executable).toBe(true);
  return compiled;
}

async function offered(priceMinor = 200): Promise<AmbientAgreementView> {
  const compiled = await compile(priceMinor);
  const created = await call('POST', '/api/ambient/agreements', {
    cookie: renterCookie,
    body: { terms: compiled.terms, termsHash: compiled.hash, approved: true },
  });
  expect(created.statusCode).toBe(201);
  return created.json<AmbientAgreementView>();
}

async function accepted(): Promise<AmbientAgreementView> {
  const agreement = await offered();
  const provider = await call('POST', `/api/operator/ambient/agreements/${agreement.id}/respond`, {
    cookie: operatorCookie,
    body: { action: 'ACCEPT', termsHash: agreement.termsHash },
  });
  expect(provider.statusCode).toBe(200);
  const buyer = await call('POST', `/api/ambient/agreements/${agreement.id}/decision`, {
    cookie: renterCookie,
    body: { action: 'ACCEPT', termsHash: agreement.termsHash },
  });
  expect(buyer.statusCode).toBe(200);
  return buyer.json<AmbientAgreementView>();
}

async function demoSession(
  agreementId: string,
  observationMode: 'LIVE' | 'REPLAY' = 'REPLAY',
): Promise<AmbientSessionView> {
  const created = await call('POST', `/api/ambient/agreements/${agreementId}/sessions`, {
    cookie: renterCookie,
    body: { demo: true, observationMode },
  });
  expect(created.statusCode).toBe(201);
  const session = created.json<AmbientSessionView>();
  expect(session.demo).toBe(true);
  return session;
}

const QUIET_INTERVALS = [
  { seq: 1, startMs: 0, endMs: 4_200, sourceState: 'ACTIVE', confidence: 0.94, qualityFlags: [] },
  { seq: 2, startMs: 4_200, endMs: 36_200, sourceState: 'INACTIVE', confidence: 0.9, qualityFlags: [] },
];

beforeAll(async () => {
  const seeded = path.resolve(process.cwd(), 'data/whirr.db');
  if (!existsSync(seeded)) throw new Error('Run `npm run setup` before the ambient integration test.');
  tempDir = mkdtempSync(path.join(tmpdir(), 'whirr-ambient-'));
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
    port: 8791,
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
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Whirr Ambient lifecycle', () => {
  it('lists the published reference object as a Wish source even without a seeded agreement', async () => {
    const response = await call('GET', '/api/ambient');
    expect(response.statusCode).toBe(200);
    const catalog = response.json<AmbientCatalogView>();
    const source = catalog.sources.find((candidate) => candidate.target.objectId === OBJECT_ID);
    expect(source).toBeDefined();
    expect(source?.model.status).toBe('READY');
    expect(source?.model.provenance).toBe('SYNTHETIC_REFERENCE');
    expect(source?.publishedVia).toBe('PUBLISHED_TERMS');
  });

  it('rejects an unsupported physical claim before any negotiation or payment', async () => {
    const response = await call('POST', '/api/ambient/compile', {
      cookie: renterCookie,
      body: {
        objectId: OBJECT_ID,
        text: 'Stop the fan to reduce electricity consumption by 50 percent. I will pay $2.',
        durationSeconds: 30,
        fixedPriceMinor: 200,
        currency: 'USD',
      },
    });
    expect(response.statusCode).toBe(200);
    const compiled = response.json<CompiledAmbientAgreement>();
    expect(compiled.executable).toBe(false);
    expect(compiled.issues.some((issue) => issue.code === 'UNSUPPORTED_PHYSICAL_CLAIM')).toBe(true);
    expect(compiled.interpretation.unsupportedClaims).toContain('electricity or power consumption');
  });

  it('keeps a counteroffer immutable and requires the buyer to accept the exact final revision', async () => {
    const agreement = await offered();
    expect(agreement.status).toBe('OFFERED');

    const counter = await call('POST', `/api/operator/ambient/agreements/${agreement.id}/respond`, {
      cookie: operatorCookie,
      body: {
        action: 'COUNTER',
        termsHash: agreement.termsHash,
        priceMinor: 250,
        durationSeconds: 30,
        note: 'A longer continuous pause needs a little more compensation.',
      },
    });
    expect(counter.statusCode).toBe(200);
    const countered = counter.json<AmbientAgreementView>();
    expect(countered.status).toBe('COUNTERED');
    expect(countered.revision).toBe(2);
    expect(countered.financial.fixedPriceMinor).toBe(250);
    expect(countered.termsHash).not.toBe(agreement.termsHash);
    expect(countered.currentOffer?.status).toBe('COUNTERED');
    expect(countered.offers.find((offer) => offer.revision === 1)?.status).toBe('SUPERSEDED');

    const stale = await call('POST', `/api/ambient/agreements/${agreement.id}/decision`, {
      cookie: renterCookie,
      body: { action: 'ACCEPT', termsHash: agreement.termsHash },
    });
    expect(stale.statusCode).toBe(409);

    const acceptedCounter = await call('POST', `/api/ambient/agreements/${agreement.id}/decision`, {
      cookie: renterCookie,
      body: { action: 'ACCEPT', termsHash: countered.termsHash },
    });
    expect(acceptedCounter.statusCode).toBe(200);
    expect(acceptedCounter.json<AmbientAgreementView>().status).toBe('ACCEPTED');

    const session = await call('POST', `/api/ambient/agreements/${agreement.id}/sessions`, {
      cookie: renterCookie,
      body: { demo: true, observationMode: 'REPLAY' },
    });
    expect(session.statusCode).toBe(201);
    expect(session.json<AmbientSessionView>().agreementHash).toBe(countered.termsHash);
  });

  it('builds a labelled replay ladder for a new demo session', async () => {
    const agreement = await accepted();
    const session = await demoSession(agreement.id);
    expect(session.observationMode).toBe('REPLAY');
    expect(session.state).toBe('OBSERVING');
    expect(session.observations.length).toBeGreaterThanOrEqual(2);
    expect(session.observations[0]?.sourceState).toBe('ACTIVE');
    expect(session.observations[1]?.sourceState).toBe('INACTIVE');

    const stopped = await call('POST', `/api/ambient/sessions/${session.id}/stop`, {
      cookie: renterCookie,
      body: { reason: 'WINDOW_QUALIFIED' },
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json<AmbientSessionView>().evaluation?.outcome).toBe('QUALIFIED');
  });

  it('qualifies a continuous window, records human acceptance, and verifies the signed proof', async () => {
    const agreement = await accepted();
    const session = await demoSession(agreement.id, 'LIVE');

    const started = await call('POST', `/api/ambient/sessions/${session.id}/start`, {
      cookie: renterCookie,
      body: {},
    });
    expect(started.statusCode).toBe(200);

    const observations = await call('POST', `/api/ambient/sessions/${session.id}/observations`, {
      cookie: renterCookie,
      body: { clientSeq: 1, intervals: QUIET_INTERVALS },
    });
    expect(observations.statusCode).toBe(200);

    const stopped = await call('POST', `/api/ambient/sessions/${session.id}/stop`, {
      cookie: renterCookie,
      body: { reason: 'WINDOW_QUALIFIED' },
    });
    expect(stopped.statusCode).toBe(200);
    const qualified = stopped.json<AmbientSessionView>();
    expect(qualified.evaluation?.outcome).toBe('QUALIFIED');
    expect(qualified.evaluation?.inactiveMs).toBe(32_000);
    expect(qualified.state).toBe('QUALIFIED_AWAITING_ACCEPTANCE');
    expect(qualified.flags.canCapture).toBe(false);

    const acceptedResult = await call('POST', `/api/ambient/sessions/${session.id}/acceptance`, {
      cookie: renterCookie,
      body: {
        accepted: true,
        termsHash: agreement.termsHash,
        note: 'The interval ledger shows the full approved window.',
      },
    });
    expect(acceptedResult.statusCode).toBe(200);
    const complete = acceptedResult.json<AmbientSessionView>();
    expect(complete.state).toBe('DEMO_COMPLETE');
    expect(complete.acceptance?.accepted).toBe(true);
    expect(complete.flags.canCapture).toBe(false);
    expect(complete.payment.captureId).toBeNull();

    const proofResponse = await call('GET', `/api/ambient/sessions/${session.id}/proof`, {
      cookie: renterCookie,
    });
    expect(proofResponse.statusCode).toBe(200);
    const proof = proofResponse.json<AmbientProofView>();
    expect(proof.verification.valid).toBe(true);
    expect(proof.verification.signatureValid).toBe(true);
    expect(proof.verification.evaluationMatches).toBe(true);
    expect(proof.verification.consentOrderValid).toBe(true);
    expect(proof.verification.checks.every((check) => check.pass)).toBe(true);
    expect(proofResponse.headers['cache-control']).toBe('no-store');
    expect(proofResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(String(proofResponse.headers['content-security-policy'])).toContain("default-src 'self'");
    const serializedPublic = JSON.stringify(proof.publicDocument);
    expect(serializedPublic).not.toMatch(/"(?:frames|features|rawAudio|audioBase64)"/i);

    const publicProof = await call('GET', `/api/ambient/proofs/${proof.id}`);
    expect(publicProof.statusCode).toBe(200);
    expect(publicProof.json<AmbientProofView>().verification.valid).toBe(true);

    const document = JSON.parse(JSON.stringify(proof.publicDocument)) as {
      payload: { observations: Array<{ sourceState: string }> };
    };
    document.payload.observations[1]!.sourceState = 'ACTIVE';
    const tampered = await verifyAmbientProofDocument(document);
    expect(tampered.valid).toBe(false);
    expect(tampered.signatureValid).toBe(false);
  });

  it('withholds qualification on an interruption and cannot capture the failed demo', async () => {
    const agreement = await accepted();
    const session = await demoSession(agreement.id, 'LIVE');
    const started = await call('POST', `/api/ambient/sessions/${session.id}/start`, {
      cookie: renterCookie,
      body: {},
    });
    expect(started.statusCode).toBe(200);

    const failed = await call('POST', `/api/ambient/sessions/${session.id}/observations`, {
      cookie: renterCookie,
      body: {
        clientSeq: 1,
        intervals: [
          { seq: 1, startMs: 0, endMs: 4_200, sourceState: 'ACTIVE', confidence: 0.94, qualityFlags: [] },
          { seq: 2, startMs: 4_200, endMs: 12_000, sourceState: 'INACTIVE', confidence: 0.9, qualityFlags: [] },
          { seq: 3, startMs: 12_000, endMs: 13_000, sourceState: 'ACTIVE', confidence: 0.9, qualityFlags: [] },
          { seq: 4, startMs: 13_000, endMs: 24_000, sourceState: 'INACTIVE', confidence: 0.9, qualityFlags: [] },
        ],
      },
    });
    expect(failed.statusCode).toBe(200);

    const stopped = await call('POST', `/api/ambient/sessions/${session.id}/stop`, {
      cookie: renterCookie,
      body: { reason: 'INTERRUPTED' },
    });
    const result = stopped.json<AmbientSessionView>();
    expect(result.evaluation?.outcome).toBe('INTERRUPTED');
    expect(result.state).toBe('NOT_QUALIFIED');
    expect(result.flags.canCapture).toBe(false);
    expect(result.payment.captureId).toBeNull();

    const capture = await call('POST', `/api/ambient/sessions/${session.id}/capture`, {
      cookie: renterCookie,
      body: { confirmed: true, termsHash: agreement.termsHash },
    });
    expect(capture.statusCode).not.toBe(200);
    expect(ctx.store.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ambient_sessions WHERE id = ? AND paypal_capture_id IS NOT NULL',
      session.id,
    )?.count).toBe(0);
  });

  it('serves seeded replays without credentials but scopes live sessions to participants', async () => {
    const anonymous = await call('GET', '/api/ambient/judge/sessions/ase_reference_qualified');
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json<AmbientSessionView>().demo).toBe(true);

    const secondRenter = await call('POST', '/api/auth/renter', { body: {} });
    const foreignCookie = cookieOf(secondRenter);
    const foreign = await call('GET', '/api/ambient/sessions/ase_reference_qualified', {
      cookie: foreignCookie,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('scopes private agreement terms and model artifacts to participants', async () => {
    const agreement = await offered();
    const secondRenter = await call('POST', '/api/auth/renter', { body: {} });
    const foreignCookie = cookieOf(secondRenter);

    const anonymous = await call('GET', `/api/ambient/agreements/${agreement.id}`);
    expect(anonymous.statusCode).toBe(404);
    const foreign = await call('GET', `/api/ambient/agreements/${agreement.id}`, {
      cookie: foreignCookie,
    });
    expect(foreign.statusCode).toBe(404);
    const buyer = await call('GET', `/api/ambient/agreements/${agreement.id}`, {
      cookie: renterCookie,
    });
    expect(buyer.statusCode).toBe(200);
    expect(buyer.json<AmbientAgreementView>().roles.buyer).toBe(true);
    const provider = await call('GET', `/api/operator/ambient/agreements/${agreement.id}`, {
      cookie: operatorCookie,
    });
    expect(provider.statusCode).toBe(200);
    expect(provider.json<AmbientAgreementView>().roles.provider).toBe(true);

    const anonymousModel = await call('GET', `/api/ambient/agreements/${agreement.id}/model`);
    expect(anonymousModel.statusCode).toBe(404);
    const foreignModel = await call('GET', `/api/ambient/agreements/${agreement.id}/model`, {
      cookie: foreignCookie,
    });
    expect(foreignModel.statusCode).toBe(404);
    const buyerModel = await call('GET', `/api/ambient/agreements/${agreement.id}/model`, {
      cookie: renterCookie,
    });
    expect(buyerModel.statusCode).toBe(200);
    expect(buyerModel.json<{ artifact: unknown }>().artifact).toBeDefined();

    const publicAgreement = await call('GET', '/api/ambient/agreements/amb_reference_window');
    expect(publicAgreement.statusCode).toBe(200);
    const publicModel = await call('GET', '/api/ambient/agreements/amb_reference_window/model');
    expect(publicModel.statusCode).toBe(200);
  });

  it('enforces buyer/provider separation and rejects cross-renter session access', async () => {
    const agreement = await accepted();
    const secondRenter = await call('POST', '/api/auth/renter', { body: {} });
    const foreignCookie = cookieOf(secondRenter);

    const operatorDecision = await call('POST', `/api/ambient/agreements/${agreement.id}/decision`, {
      cookie: operatorCookie,
      body: { action: 'ACCEPT', termsHash: agreement.termsHash },
    });
    expect(operatorDecision.statusCode).toBe(401);
    const renterResponse = await call('POST', `/api/operator/ambient/agreements/${agreement.id}/respond`, {
      cookie: renterCookie,
      body: { action: 'ACCEPT', termsHash: agreement.termsHash },
    });
    expect(renterResponse.statusCode).toBe(401);

    const session = await demoSession(agreement.id);
    const foreignStop = await call('POST', `/api/ambient/sessions/${session.id}/stop`, {
      cookie: foreignCookie,
      body: { reason: 'INTERRUPTED' },
    });
    expect(foreignStop.statusCode).toBe(404);
    const foreignAcceptance = await call('POST', `/api/ambient/sessions/${session.id}/acceptance`, {
      cookie: foreignCookie,
      body: { accepted: true, termsHash: agreement.termsHash },
    });
    expect(foreignAcceptance.statusCode).toBe(404);
    const operatorCapture = await call('POST', `/api/ambient/sessions/${session.id}/capture`, {
      cookie: operatorCookie,
      body: { confirmed: true, termsHash: agreement.termsHash },
    });
    expect(operatorCapture.statusCode).toBe(401);

    const anonymousSession = await call('GET', `/api/ambient/sessions/${session.id}`);
    expect(anonymousSession.statusCode).toBe(401);
    const buyerView = await call('GET', `/api/ambient/sessions/${session.id}`, {
      cookie: renterCookie,
    });
    expect(buyerView.statusCode).toBe(200);
    expect(buyerView.headers['cache-control']).toBe('no-store');
    expect(buyerView.headers['x-content-type-options']).toBe('nosniff');
    expect(String(buyerView.headers['content-security-policy'])).toContain("default-src 'self'");
  });

  it('rejects Ambient mutations without CSRF or from a foreign origin', async () => {
    const body = {
      objectId: OBJECT_ID,
      text: 'I need a 30 second quiet window without the reference desk fan running. I will pay $2.00.',
      durationSeconds: 30,
      fixedPriceMinor: 200,
      currency: 'USD',
    };
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/ambient/compile',
      headers: { cookie: renterCookie, 'content-type': 'application/json' },
      payload: body,
    });
    expect(missingCsrf.statusCode).toBe(403);
    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/ambient/compile',
      headers: {
        cookie: renterCookie,
        'x-whirr-csrf': '1',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      payload: body,
    });
    expect(foreignOrigin.statusCode).toBe(403);
  });
});
