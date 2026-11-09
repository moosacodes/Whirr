import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type { PassportView, SessionView, SignedProofBundle, SignedReceiptProof } from '../../packages/contracts/src/types.ts';
import { verifyDocument } from '../../packages/verify/src/index.ts';
import {
  bytesToBase64,
  keyIdForPublicKey,
  signEnvelope,
  verifyEnvelope,
} from '../../packages/protocol/src/index.ts';

const TEST_KEY = 'v2-operator-key-0123456789abcdef';
const TEST_SECRET = 'v2-cookie-secret-0123456789abcdef0123456789abcdef';

let tempDir: string;
let app: FastifyInstance;
let ctx: AppContext;
let renterCookie: string;
let secondRenterCookie: string;
let operatorCookie: string;
let sessionId: string;
let proofId: string;
let receiptHash: string;

async function makeKey() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateKey = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)));
  const publicKey = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey)));
  return { privateKey, publicKey, keyId: await keyIdForPublicKey(publicKey) };
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('No set-cookie header');
  return first.split(';')[0]!;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-whirr-csrf'] = '1';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload: options.body as never });
}

beforeAll(async () => {
  const seeded = path.resolve(process.cwd(), 'data/whirr.db');
  if (!existsSync(seeded)) throw new Error('Run `npm run setup` before the integration test.');
  tempDir = mkdtempSync(path.join(tmpdir(), 'whirr-v2-'));
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
    port: 8789,
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
  ctx.store.run('DELETE FROM sessions');
  ctx.store.run('DELETE FROM paypal_webhook_events');
  ctx.store.run('DELETE FROM passport_versions');
  ctx.store.run('DELETE FROM object_holds');
  ctx.store.run('DELETE FROM fairness_credits');

  renterCookie = cookieOf(await call('POST', '/api/auth/renter', { body: {} }));
  secondRenterCookie = cookieOf(await call('POST', '/api/auth/renter', { body: {} }));
  operatorCookie = cookieOf(await call('POST', '/api/auth/operator', { body: { key: TEST_KEY } }));
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Whirr 2.0 acoustic protocol', () => {
  it('issues a stable signed passport and verifies it offline', async () => {
    const owner = await call('GET', '/api/operator/objects/obj_reference_fan', { cookie: operatorCookie });
    expect(owner.statusCode).toBe(200);
    expect(['SEPARABLE', 'TOO_SIMILAR', 'NOT_ENOUGH_DATA']).toContain(
      owner.json<{ calibrationPreview: { status: string } }>().calibrationPreview.status,
    );
    const first = await call('GET', '/api/passport/obj_reference_fan');
    expect(first.statusCode).toBe(200);
    const view = first.json<PassportView>();
    expect(view.signedPassport).not.toBeNull();
    expect(view.signedPassport?.payload.schema).toBe('whirr.passport.v2');
    expect(view.signedPassport?.payload.attestation).toContain('not a trusted timestamp');
    expect(await verifyEnvelope(view.signedPassport)).toMatchObject({ valid: true, signatureValid: true, keyIdMatches: true });
    expect(await verifyDocument(view.signedPassport)).toMatchObject({ valid: true, kind: 'passport' });
    expect(view.stamps.length).toBeGreaterThan(0);
    expect(view.passportHistory).toHaveLength(1);

    // A second read of unchanged facts must reuse the edition, not mint one per view.
    const second = await call('GET', '/api/passport/obj_reference_fan');
    const again = second.json<PassportView>();
    expect(again.signedPassport?.signature).toBe(view.signedPassport?.signature);
    expect(again.passportHistory).toHaveLength(1);
  });

  it('blocks a severe preflight, supports explanations, fairness and a redacted proof', async () => {
    const terms = await call('PUT', '/api/operator/objects/obj_reference_fan/terms', {
      cookie: operatorCookie,
      body: {
        currency: 'USD',
        minorPerMinute: 20,
        capMinor: 500,
        fairnessReserveMinor: 50,
        acknowledgeSandbox: true,
      },
    });
    expect(terms.statusCode).toBe(201);
    const termsBody = terms.json<{ terms: { hash: string } }>();

    const created = await call('POST', '/api/sessions', {
      cookie: renterCookie,
      body: { objectId: 'obj_reference_fan' },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<SessionView>();
    sessionId = session.id;
    await call('POST', `/api/sessions/${sessionId}/consent`, {
      cookie: renterCookie,
      body: { termsHash: termsBody.terms.hash, accepted: true },
    });
    expect((await call('POST', `/api/sessions/${sessionId}/demo-mode`, { cookie: renterCookie, body: {} })).statusCode).toBe(200);

    const severe = await call('POST', `/api/sessions/${sessionId}/preflight`, {
      cookie: renterCookie,
      body: {
        status: 'READY',
        frameCount: 0,
        durationMs: 4_000,
        noiseFloorLogRms: null,
        levelVariance: 0,
        clippedRatio: 0,
        silentRatio: 1,
        flags: ['SILENT'],
        detail: 'No usable signal.',
      },
    });
    expect(severe.statusCode).toBe(200);
    expect(severe.json<{ status: string }>().status).toBe('NO_SIGNAL');
    const blocked = await call('POST', `/api/sessions/${sessionId}/start`, { cookie: renterCookie, body: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('PREFLIGHT_BLOCKED');

    const ready = await call('POST', `/api/sessions/${sessionId}/preflight`, {
      cookie: renterCookie,
      body: {
        status: 'READY',
        frameCount: 100,
        durationMs: 4_000,
        noiseFloorLogRms: -3.2,
        levelVariance: 0.01,
        clippedRatio: 0,
        silentRatio: 0.05,
        flags: [],
        detail: 'Stable room tone.',
        capture: {
          schema: 'whirr.capture-claim.v1',
          provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
          claimedAt: new Date().toISOString(),
          deviceLabel: 'Test microphone',
          sampleRate: 48_000,
          permission: 'GRANTED',
          frameCount: 100,
          note: 'Integration test capture claim.',
        },
      },
    });
    expect(ready.json<{ status: string }>().status).toBe('READY');
    const started = await call('POST', `/api/sessions/${sessionId}/start`, { cookie: renterCookie, body: {} });
    expect(started.statusCode).toBe(200);
    ctx.store.run('UPDATE sessions SET started_at = ? WHERE id = ?', new Date(Date.now() - 60_000).toISOString(), sessionId);

    const active = started.json<SessionView>();
    const appended = await call('POST', `/api/sessions/${sessionId}/intervals`, {
      cookie: renterCookie,
      body: {
        token: active.sessionToken,
        clientSeq: 1,
        intervals: [
          {
            startMs: 0,
            endMs: 10_000,
            state: 'ACTIVE_CONFIDENT',
            confidence: 0.98,
            modelVersion: active.model.version,
            explanation: {
              schema: 'whirr.explanation.v1',
              passportScore: 0.97,
              topFeatures: [{ name: 'log_rms', value: -1.2, contribution: 1.4 }],
              summary: 'Strong running-band evidence.',
            },
          },
          { startMs: 10_000, endMs: 12_000, state: 'IDLE', confidence: 0.9, modelVersion: active.model.version },
        ],
      },
    });
    expect(appended.statusCode).toBe(200);
    const stopped = await call('POST', `/api/sessions/${sessionId}/stop`, { cookie: renterCookie, body: {} });
    const stoppedView = stopped.json<SessionView>();
    expect(stoppedView.intervals[0]?.explanation?.summary).toBe('Strong running-band evidence.');
    const beforeReserve = stoppedView.quote.quoteMinor;
    expect(beforeReserve).toBe(3);

    const reserved = await call('POST', `/api/sessions/${sessionId}/fairness-reserve`, { cookie: renterCookie, body: {} });
    expect(reserved.statusCode).toBe(200);
    const reservedView = reserved.json<SessionView>();
    expect(reservedView.fairnessReserveMinor).toBe(50);
    expect(reservedView.fairnessCreditAppliedMinor).toBe(beforeReserve);
    expect(reservedView.quote.quoteMinor).toBe(0);
    const reused = await call('POST', `/api/sessions/${sessionId}/fairness-reserve`, { cookie: renterCookie, body: {} });
    expect(reused.statusCode).toBe(409);

    const accepted = await call('POST', `/api/sessions/${sessionId}/review/accept`, {
      cookie: renterCookie,
      body: { quoteHash: reservedView.quote.quoteHash, accepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect((await call('POST', `/api/sessions/${sessionId}/demo-complete`, { cookie: renterCookie, body: {} })).statusCode).toBe(200);

    const receipt = await call('GET', `/api/sessions/${sessionId}/receipt`, { cookie: renterCookie });
    const receiptBody = receipt.json<{
      receipt: { evidenceSha256: string; timeline: Array<{ explanation?: { summary: string } }>; pricing: { creditMinor: number } };
      verification: Record<string, boolean | null>;
    }>();
    expect(receiptBody.receipt.timeline[0]?.explanation?.summary).toBe('Strong running-band evidence.');
    expect(receiptBody.receipt.pricing.creditMinor).toBe(3);
    expect(receiptBody.verification.quoteMatches).toBe(true);
    expect(receiptBody.verification.capRespected).toBe(true);
    expect(receiptBody.verification.evidenceMatches).toBe(true);
    expect(receiptBody.verification.receiptHashMatches).toBe(true);
    expect(receiptBody.verification.intervalsConsistent).toBe(true);
    expect(receiptBody.verification.passportConsistent).toBe(true);
    expect(receiptBody.verification.providerAmountMatches).toBeNull();
    expect(receiptBody.verification.auditChainValid).toBe(true);
    receiptHash = receiptBody.receipt.evidenceSha256;

    const proofResponse = await call('GET', `/api/sessions/${sessionId}/proof`, { cookie: renterCookie });
    expect(proofResponse.statusCode).toBe(200);
    const proof = proofResponse.json<SignedReceiptProof>();
    proofId = proof.payload.proofId;
    expect(proof.payload.receiptHash).toBe(receiptHash);
    expect(await verifyEnvelope(proof)).toMatchObject({ valid: true });
    const documentVerification = await verifyDocument(proof);
    expect(documentVerification, JSON.stringify(documentVerification.checks)).toMatchObject({ valid: true, kind: 'receipt-proof' });
    const serialized = JSON.stringify(proof);
    expect(serialized).not.toContain('renterRef');
    expect(serialized).not.toContain('orderId');
    expect(serialized).not.toContain('authorizationId');
    expect(serialized).not.toContain('captureId');

    const publicProof = await call('GET', `/api/proofs/${proofId}`);
    expect(publicProof.statusCode).toBe(200);
    expect(publicProof.json<SignedReceiptProof>().payload.proofId).toBe(proofId);

    const bundleResponse = await call('GET', `/api/sessions/${sessionId}/bundle`, { cookie: renterCookie });
    expect(bundleResponse.statusCode).toBe(200);
    const bundle = bundleResponse.json<SignedProofBundle>();
    expect(bundle.type).toBe('proof-bundle');
    expect(bundle.payload.schema).toBe('whirr.proof-bundle.v3');
    expect(bundle.payload.redacted).toBe(false);
    expect(bundle.payload.intervals.length).toBe(2);
    expect(bundle.payload.merkle.leafCount).toBe(2);
    const authenticatedBundle = await verifyDocument(bundle, { trustedKeyId: bundle.keyId });
    expect(authenticatedBundle, JSON.stringify(authenticatedBundle.checks)).toMatchObject({ valid: true, kind: 'proof-bundle' });
    expect(authenticatedBundle.checks.find((check) => check.id === 'merkle')?.pass).toBe(true);
    const wrongPin = await verifyDocument(bundle, { trustedKeyId: '0'.repeat(32) });
    expect(wrongPin.valid).toBe(false);

    const publicBundleResponse = await call('GET', `/api/proof-bundles/${bundle.payload.bundleId}`);
    expect(publicBundleResponse.statusCode).toBe(200);
    const publicBundle = publicBundleResponse.json<SignedProofBundle>();
    expect(publicBundle.payload.redacted).toBe(true);
    expect(publicBundle.payload.receipt.renterRef).toBe('REDACTED');
    expect(JSON.stringify(publicBundle)).not.toContain('rawAudio');
    const publicVerification = await verifyDocument(publicBundle);
    expect(publicVerification, JSON.stringify(publicVerification.checks)).toMatchObject({ valid: true, kind: 'proof-bundle' });

    const tamperedAmount = structuredClone(bundle);
    tamperedAmount.payload.receipt.pricing.quoteMinor += 1;
    expect((await verifyDocument(tamperedAmount)).valid).toBe(false);
    const tamperedInterval = structuredClone(bundle);
    tamperedInterval.payload.intervals[0]!.state = 'IDLE';
    expect((await verifyDocument(tamperedInterval)).valid).toBe(false);
    const tamperedProof = structuredClone(bundle);
    tamperedProof.payload.intervals[0]!.merkleProof = [];
    expect((await verifyDocument(tamperedProof)).valid).toBe(false);
    const tamperedPassport = structuredClone(bundle);
    if (tamperedPassport.payload.passport) {
      tamperedPassport.payload.passport.keyId = 'f'.repeat(32);
    }
    expect((await verifyDocument(tamperedPassport)).valid).toBe(false);
    const tamperedKey = structuredClone(bundle);
    tamperedKey.keyId = 'e'.repeat(32);
    expect((await verifyDocument(tamperedKey)).valid).toBe(false);

    // Re-sign adversarial payloads with an internally consistent key. These
    // must still fail because the verifier checks semantics, not only the
    // outer envelope signature.
    const attacker = await makeKey();
    async function resign(mutator: (payload: SignedProofBundle['payload']) => void): Promise<SignedProofBundle> {
      const payload = structuredClone(bundle.payload);
      mutator(payload);
      return (await signEnvelope('proof-bundle', payload, attacker.privateKey, attacker.publicKey)) as SignedProofBundle;
    }

    const signedTotalEdit = await resign((payload) => {
      payload.receipt.totals.billableMs += 1_000;
    });
    const signedTotalResult = await verifyDocument(signedTotalEdit);
    expect(signedTotalResult.envelope.valid).toBe(true);
    expect(signedTotalResult.valid).toBe(false);
    expect(signedTotalResult.checks.find((check) => check.id === 'ledger_totals')?.pass).toBe(false);

    const signedIntervalEdit = await resign((payload) => {
      payload.intervals[0]!.endMs += 1;
    });
    const signedIntervalResult = await verifyDocument(signedIntervalEdit);
    expect(signedIntervalResult.envelope.valid).toBe(true);
    expect(signedIntervalResult.checks.find((check) => check.id === 'merkle')?.pass).toBe(false);

    const signedRateEdit = await resign((payload) => {
      payload.receipt.pricing.minorPerMinute += 1;
    });
    const signedRateResult = await verifyDocument(signedRateEdit);
    expect(signedRateResult.envelope.valid).toBe(true);
    expect(signedRateResult.checks.find((check) => check.id === 'bundle_quote')?.pass).toBe(false);

    const signedFairnessEdit = await resign((payload) => {
      payload.receipt.pricing.creditMinor += 1;
    });
    const signedFairnessResult = await verifyDocument(signedFairnessEdit);
    expect(signedFairnessResult.envelope.valid).toBe(true);
    expect(signedFairnessResult.checks.find((check) => check.id === 'bundle_quote')?.pass).toBe(false);

    const signedModelEdit = await resign((payload) => {
      payload.model.precision = 1;
    });
    const signedModelResult = await verifyDocument(signedModelEdit);
    expect(signedModelResult.envelope.valid).toBe(true);
    expect(signedModelResult.checks.find((check) => check.id === 'model_binding')?.pass).toBe(false);

    const signedCaptureEdit = await resign((payload) => {
      if (payload.capture) payload.capture.provenance = 'PHYSICAL_PROOF' as never;
    });
    const signedCaptureResult = await verifyDocument(signedCaptureEdit);
    expect(signedCaptureResult.envelope.valid).toBe(true);
    expect(signedCaptureResult.checks.find((check) => check.id === 'capture_claim')?.pass).toBe(false);

    const signedRedactionEdit = structuredClone(publicBundle);
    signedRedactionEdit.payload.receipt.payment.captureId = 'CAP-FULL-PROVIDER-ID';
    const resignPublic = (await signEnvelope(
      'proof-bundle',
      signedRedactionEdit.payload,
      attacker.privateKey,
      attacker.publicKey,
    )) as SignedProofBundle;
    const signedRedactionResult = await verifyDocument(resignPublic);
    expect(signedRedactionResult.envelope.valid).toBe(true);
    expect(signedRedactionResult.checks.find((check) => check.id === 'redaction')?.pass).toBe(false);
  });

  it('resolves a hold race without charging anything', async () => {
    const listed = await call('POST', '/api/operator/objects/obj_reference_fan/shelf', {
      cookie: operatorCookie,
      body: { listed: true },
    });
    expect(listed.statusCode).toBe(200);
    const first = await call('POST', '/api/objects/obj_reference_fan/hold', { cookie: renterCookie, body: {} });
    expect(first.statusCode).toBe(201);
    const blocked = await call('POST', '/api/objects/obj_reference_fan/hold', { cookie: secondRenterCookie, body: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('OBJECT_HELD');
    expect((await call('DELETE', '/api/objects/obj_reference_fan/hold', { cookie: renterCookie, body: {} })).statusCode).toBe(200);
    const second = await call('POST', '/api/objects/obj_reference_fan/hold', { cookie: secondRenterCookie, body: {} });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ hold: { expiresAt: string } }>().hold.expiresAt).toBeTruthy();
    const shelf = await call('GET', '/api/shelf');
    expect(shelf.statusCode).toBe(200);
    expect(shelf.json<{ items: Array<{ object: { id: string }; hold: unknown }> }>().items.find((item) => item.object.id === 'obj_reference_fan')?.hold).toBeTruthy();
  });
});