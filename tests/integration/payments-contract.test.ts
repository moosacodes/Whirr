import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../apps/api/src/app.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type { SessionView } from '../../packages/contracts/src/types.ts';
import type {
  PayPalAuthorization,
  PayPalCapture,
  PayPalClient,
  PayPalOrder,
  PayPalRefund,
} from '../../packages/paypal/src/client.ts';
import { PayPalApiError } from '../../packages/paypal/src/client.ts';

const TEST_KEY = 'payments-operator-key-0123456789abcdef';
const TEST_SECRET = 'payments-cookie-secret-0123456789abcdef0123456789abcdef';

type CaptureMode = 'COMPLETED' | 'PENDING' | 'DECLINED' | 'LOST_RESPONSE' | 'AMOUNT_MISMATCH';

class FakePayPal {
  captureMode: CaptureMode = 'COMPLETED';
  authorizationStatus = 'CREATED';
  authorizationValue = '5.00';
  authorizationCurrency = 'USD';
  refundValue: string | null = null;
  refundStatus = 'COMPLETED';
  webhookValid = true;
  failCaptureLookup = false;
  readonly orderRequestIds: string[] = [];
  readonly captureRequestIds: string[] = [];
  readonly refundRequestIds: string[] = [];
  captureCalls = 0;
  captureLookups = 0;
  private readonly orders = new Map<string, PayPalOrder>();
  private readonly authorizations = new Map<string, PayPalAuthorization>();
  readonly captures = new Map<string, PayPalCapture>();
  private readonly refunds = new Map<string, PayPalRefund>();
  private readonly captureIdsByRequest = new Map<string, string>();
  private orderCounter = 0;

  async createOrder(input: { capMinor: number; currency: 'USD'; sessionId: string; requestId: string }) {
    this.orderRequestIds.push(input.requestId);
    this.orderCounter += 1;
    const id = `ORDER-${this.orderCounter}`;
    const order: PayPalOrder = { id, status: 'CREATED', links: [] };
    this.orders.set(id, order);
    return { order, approveUrl: `https://sandbox.paypal.com/checkoutnow?token=${id}` };
  }

  async getOrder(id: string): Promise<PayPalOrder> {
    const order = this.orders.get(id);
    // The buyer has returned from the Sandbox approval page in these tests.
    return order ? { ...order, status: 'APPROVED' } : { id, status: 'APPROVED', links: [] };
  }

  async authorizeOrder(id: string): Promise<PayPalOrder> {
    const authId = `AUTH-${this.orderRequestIds.length}`;
    this.authorizations.set(authId, {
      id: authId,
      status: this.authorizationStatus,
      amount: { currency_code: this.authorizationCurrency, value: this.authorizationValue },
      expiration_time: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    });
    return {
      id,
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            authorizations: [
              {
                id: authId,
                status: this.authorizationStatus,
                amount: { currency_code: this.authorizationCurrency, value: this.authorizationValue },
              },
            ],
          },
        },
      ],
    };
  }

  async getAuthorization(id: string): Promise<PayPalAuthorization> {
    return (
      this.authorizations.get(id) ?? {
        id,
        status: this.authorizationStatus,
        amount: { currency_code: this.authorizationCurrency, value: this.authorizationValue },
      }
    );
  }

  async captureAuthorization(input: {
    authorizationId: string;
    amountMinor: number;
    currency: 'USD';
    requestId: string;
  }): Promise<PayPalCapture> {
    this.captureCalls += 1;
    this.captureRequestIds.push(input.requestId);
    const existingId = this.captureIdsByRequest.get(input.requestId);
    if (existingId) return this.captures.get(existingId)!;
    const lossy = this.captureMode === 'LOST_RESPONSE' && !this.captureIdsByRequest.has(input.requestId);
    const id = `CAP-${this.captureCalls}`;
    const status = this.captureMode === 'PENDING' ? 'PENDING' : this.captureMode === 'DECLINED' ? 'DECLINED' : 'COMPLETED';
    const value =
      this.captureMode === 'AMOUNT_MISMATCH'
        ? '0.01'
        : (input.amountMinor / 100).toFixed(2);
    const capture: PayPalCapture = {
      id,
      status,
      amount: { currency_code: input.currency, value },
    };
    this.captures.set(id, capture);
    this.captureIdsByRequest.set(input.requestId, id);
    if (lossy) throw new PayPalApiError('socket hang up after provider commit', { status: 504 });
    return capture;
  }

  async getCapture(id: string): Promise<PayPalCapture> {
    this.captureLookups += 1;
    if (this.failCaptureLookup) {
      this.failCaptureLookup = false;
      throw new PayPalApiError('capture lookup timeout', { status: 504 });
    }
    const capture = this.captures.get(id);
    if (!capture) throw new PayPalApiError('capture not found', { status: 404 });
    return capture;
  }

  async refundCapture(input: { captureId: string; amountMinor?: number; currency: 'USD'; requestId: string }): Promise<PayPalRefund> {
    this.refundRequestIds.push(input.requestId);
    const id = `REF-${this.refundRequestIds.length}`;
    const value = this.refundValue ?? ((input.amountMinor ?? 7) / 100).toFixed(2);
    const refund: PayPalRefund = { id, status: this.refundStatus, amount: { currency_code: input.currency, value } };
    this.refunds.set(id, refund);
    return refund;
  }

  async getRefund(id: string): Promise<PayPalRefund> {
    return this.refunds.get(id) ?? { id, status: 'FAILED' };
  }

  async voidAuthorization(id: string): Promise<PayPalAuthorization> {
    const authorization = { ...(await this.getAuthorization(id)), status: 'VOIDED' };
    this.authorizations.set(id, authorization);
    return authorization;
  }

  async verifyWebhookSignature() {
    return { verified: this.webhookValid, status: this.webhookValid ? 'SUCCESS' : 'FAILURE', raw: {} };
  }
}

let tempDir: string;
let app: FastifyInstance;
let ctx: AppContext;
let renterCookie: string;
let operatorCookie: string;
const paypal = new FakePayPal();

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('No set-cookie header');
  return first.split(';')[0]!;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (method !== 'GET') headers['x-whirr-csrf'] = '1';
  if (options.csrf === false) delete headers['x-whirr-csrf'];
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload: options.body as never });
}

async function createReviewedSession(overrides: { activeMs?: number; authorized?: boolean } = {}): Promise<SessionView> {
  const created = await call('POST', '/api/sessions', {
    cookie: renterCookie,
    body: { objectId: 'obj_reference_fan' },
  });
  expect(created.statusCode).toBe(201);
  const session = created.json<SessionView>();
  const consented = await call('POST', `/api/sessions/${session.id}/consent`, {
    cookie: renterCookie,
    body: { termsHash: session.termsHash, accepted: true },
  });
  expect(consented.statusCode).toBe(200);
  ctx.store.run(
    `UPDATE sessions SET state = 'READY', payment_state = 'AUTHORIZED', paypal_order_id = 'ORDER-FIXTURE',
       paypal_authorization_id = 'AUTH-FIXTURE', authorization_expires_at = ?, provider_status = 'CREATED'
     WHERE id = ?`,
    new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    session.id,
  );
  const started = await call('POST', `/api/sessions/${session.id}/start`, { cookie: renterCookie, body: {} });
  expect(started.statusCode).toBe(200);
  const active = started.json<SessionView>();
  ctx.store.run(
    'UPDATE sessions SET started_at = ? WHERE id = ?',
    new Date(Date.now() - 120_000).toISOString(),
    session.id,
  );
  const duration = overrides.activeMs ?? 60_000;
  const intervals = await call('POST', `/api/sessions/${session.id}/intervals`, {
    cookie: renterCookie,
    body: {
      token: active.sessionToken,
      clientSeq: 1,
      intervals: [
        { startMs: 0, endMs: duration, state: 'ACTIVE_CONFIDENT', confidence: 0.98, modelVersion: active.model.version },
      ],
    },
  });
  expect(intervals.statusCode).toBe(200);
  const stopped = await call('POST', `/api/sessions/${session.id}/stop`, { cookie: renterCookie, body: {} });
  expect(stopped.statusCode).toBe(200);
  const stoppedView = stopped.json<SessionView>();
  const accepted = await call('POST', `/api/sessions/${session.id}/review/accept`, {
    cookie: renterCookie,
    body: { quoteHash: stoppedView.quote.quoteHash, accepted: true },
  });
  expect(accepted.statusCode).toBe(200);
  return accepted.json<SessionView>();
}

beforeAll(async () => {
  const seeded = path.resolve(process.cwd(), 'data/whirr.db');
  if (!existsSync(seeded)) throw new Error('Run `npm run setup` before the integration test.');
  tempDir = mkdtempSync(path.join(tmpdir(), 'whirr-payments-'));
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
      configured: true,
      env: 'sandbox',
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
      webhookId: 'WH-FAKE',
      webhookConfigured: true,
    },
  });
  const created = await createApp(config, { logger: false, paypal: paypal as unknown as PayPalClient });
  app = created.app;
  ctx = created.ctx;
  ctx.store.run('DELETE FROM sessions');
  ctx.store.run('DELETE FROM paypal_webhook_events');
  renterCookie = cookieOf(await call('POST', '/api/auth/renter', { body: {} }));
  operatorCookie = cookieOf(await call('POST', '/api/auth/operator', { body: { key: TEST_KEY } }));
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  // These tests intentionally create many sessions in one process. Reset the
  // in-memory limiter rather than weakening the production limits. Stale
  // pre-payment sessions are failed so idempotent session reuse cannot leak
  // payment state between cases.
  ctx.limiter.reset();
  ctx.store.run("UPDATE sessions SET state = 'FAILED' WHERE state IN ('CREATED','CONSENTED','PAYMENT_PENDING')");
});

describe('PayPal provider contract', () => {
  it('rejects an authorization whose amount or currency differs from the consented cap', async () => {
    const created = await call('POST', '/api/sessions', {
      cookie: renterCookie,
      body: { objectId: 'obj_reference_fan' },
    });
    const session = created.json<SessionView>();
    await call('POST', `/api/sessions/${session.id}/consent`, {
      cookie: renterCookie,
      body: { termsHash: session.termsHash, accepted: true },
    });
    const order = await call('POST', `/api/sessions/${session.id}/paypal/order`, {
      cookie: renterCookie,
      body: {},
    });
    expect(order.statusCode).toBe(200);
    paypal.authorizationValue = '6.00';
    const authorized = await call('POST', `/api/sessions/${session.id}/paypal/authorize`, {
      cookie: renterCookie,
      body: {},
    });
    expect(authorized.statusCode).toBe(409);
    expect(authorized.json<{ error: { code: string } }>().error.code).toBe('AUTHORIZED_AMOUNT_MISMATCH');
    const row = ctx.store.get<{ payment_state: string }>('SELECT payment_state FROM sessions WHERE id = ?', session.id);
    expect(row?.payment_state).toBe('UNRESOLVED');
    paypal.authorizationValue = '5.00';
  });

  it('marks a non-CREATED authorization un-resolved rather than authorised', async () => {
    const created = await call('POST', '/api/sessions', { cookie: renterCookie, body: { objectId: 'obj_reference_fan' } });
    const session = created.json<SessionView>();
    await call('POST', `/api/sessions/${session.id}/consent`, {
      cookie: renterCookie,
      body: { termsHash: session.termsHash, accepted: true },
    });
    const order = await call('POST', `/api/sessions/${session.id}/paypal/order`, { cookie: renterCookie, body: {} });
    expect(order.statusCode, order.body).toBe(200);
    paypal.authorizationStatus = 'PENDING';
    const authorized = await call('POST', `/api/sessions/${session.id}/paypal/authorize`, {
      cookie: renterCookie,
      body: {},
    });
    expect(authorized.statusCode, authorized.body).toBe(409);
    expect(authorized.json<{ error: { code: string } }>().error.code).toBe('AUTHORIZATION_NOT_CAPTURABLE');
    paypal.authorizationStatus = 'CREATED';
  });

  it('retries a capture with the original request id after a lost success response', async () => {
    const session = await createReviewedSession();
    paypal.captureMode = 'LOST_RESPONSE';
    paypal.captureCalls = 0;
    paypal.captureRequestIds.length = 0;
    const first = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(first.statusCode).toBe(502);
    const pending = ctx.store.get<{ state: string; payment_state: string }>(
      'SELECT state, payment_state FROM sessions WHERE id = ?',
      session.id,
    );
    expect(pending).toMatchObject({ state: 'SETTLEMENT_PENDING', payment_state: 'CAPTURE_REQUESTED' });

    paypal.captureMode = 'COMPLETED';
    const retried = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(retried.statusCode).toBe(200);
    expect(retried.json<SessionView>().paymentState).toBe('CAPTURE_COMPLETED');
    expect(paypal.captureCalls).toBe(2);
    expect(new Set(paypal.captureRequestIds).size).toBe(1);
    const row = ctx.store.get<{ payment_state: string; captured_minor: number }>(
      'SELECT payment_state, captured_minor FROM sessions WHERE id = ?',
      session.id,
    );
    expect(row).toMatchObject({ payment_state: 'CAPTURE_COMPLETED', captured_minor: 20 });

    const duplicate = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(duplicate.statusCode).toBe(200);
    expect(paypal.captureCalls).toBe(2);
  });

  it('refuses capture after the stored authorization expiry without calling PayPal', async () => {
    const session = await createReviewedSession();
    const before = paypal.captureCalls;
    ctx.store.run(
      'UPDATE sessions SET authorization_expires_at = ? WHERE id = ?',
      new Date(Date.now() - 1000).toISOString(),
      session.id,
    );
    const response = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHORIZATION_EXPIRED');
    expect(paypal.captureCalls).toBe(before);
  });

  it('keeps a pending capture pending and a declined capture failed', async () => {
    const pendingSession = await createReviewedSession();
    paypal.captureMode = 'PENDING';
    const pending = await call('POST', `/api/sessions/${pendingSession.id}/capture`, { cookie: renterCookie, body: {} });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<SessionView>().paymentState).toBe('CAPTURE_PENDING');

    const declinedSession = await createReviewedSession();
    paypal.captureMode = 'DECLINED';
    const declined = await call('POST', `/api/sessions/${declinedSession.id}/capture`, { cookie: renterCookie, body: {} });
    expect(declined.statusCode).toBe(502);
    const denied = ctx.store.get<{ payment_state: string; state: string }>(
      'SELECT payment_state, state FROM sessions WHERE id = ?',
      declinedSession.id,
    );
    expect(denied).toMatchObject({ payment_state: 'CAPTURE_DENIED', state: 'FAILED' });
    paypal.captureMode = 'COMPLETED';
  });

  it('rejects a provider capture whose amount differs from the reviewed quote', async () => {
    const session = await createReviewedSession();
    paypal.captureMode = 'AMOUNT_MISMATCH';
    const response = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(response.statusCode).toBe(502);
    const row = ctx.store.get<{ payment_state: string; provider_status: string }>(
      'SELECT payment_state, provider_status FROM sessions WHERE id = ?',
      session.id,
    );
    expect(row).toMatchObject({ payment_state: 'UNRESOLVED', provider_status: 'AMOUNT_MISMATCH' });
    paypal.captureMode = 'COMPLETED';
  });

  it('makes GET payment status read-only and performs reconciliation only through POST', async () => {
    const session = await createReviewedSession();
    ctx.store.run(
      `UPDATE sessions SET state = 'SETTLEMENT_PENDING', payment_state = 'CAPTURE_PENDING',
         paypal_capture_id = 'CAP-RECONCILE', provider_reconciled_at = ? WHERE id = ?`,
      new Date(Date.now() - 60_000).toISOString(),
      session.id,
    );
    paypal.captures.set('CAP-RECONCILE', {
      id: 'CAP-RECONCILE',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '0.20' },
    });
    const lookups = paypal.captureLookups;
    const read = await call('GET', `/api/sessions/${session.id}/paypal/status?reconcile=1`, { cookie: renterCookie });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ paymentState: string }>().paymentState).toBe('CAPTURE_PENDING');
    expect(paypal.captureLookups).toBe(lookups);

    const reconciled = await call('POST', `/api/sessions/${session.id}/paypal/reconcile`, {
      cookie: renterCookie,
      body: {},
    });
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json<{ paymentState: string }>().paymentState).toBe('CAPTURE_COMPLETED');
    expect(paypal.captureLookups).toBeGreaterThan(lookups);
  });

  it('records an interrupted reconciliation and resolves it on the next attempt', async () => {
    const session = await createReviewedSession();
    ctx.store.run(
      `UPDATE sessions SET state = 'SETTLEMENT_PENDING', payment_state = 'CAPTURE_PENDING',
         paypal_capture_id = 'CAP-INTERRUPTED', provider_reconciled_at = ? WHERE id = ?`,
      new Date(Date.now() - 60_000).toISOString(),
      session.id,
    );
    paypal.captures.set('CAP-INTERRUPTED', {
      id: 'CAP-INTERRUPTED',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '0.20' },
    });
    paypal.failCaptureLookup = true;
    const failed = await call('POST', `/api/sessions/${session.id}/paypal/reconcile`, {
      cookie: renterCookie,
      body: {},
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json<{ paymentState: string; providerStatus: string }>()).toMatchObject({
      paymentState: 'CAPTURE_PENDING',
      providerStatus: 'RECONCILE_FAILED',
    });
    ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', new Date(Date.now() - 60_000).toISOString(), session.id);
    const recovered = await call('POST', `/api/sessions/${session.id}/paypal/reconcile`, {
      cookie: renterCookie,
      body: {},
    });
    expect(recovered.json<{ paymentState: string }>().paymentState).toBe('CAPTURE_COMPLETED');
  });

  it('rejects a refund amount mismatch instead of claiming a completed refund', async () => {
    const session = await createReviewedSession();
    ctx.store.run(
      `UPDATE sessions SET state = 'SETTLED', payment_state = 'CAPTURE_COMPLETED',
         paypal_capture_id = 'CAP-REFUND', captured_minor = 20, finalized_at = ? WHERE id = ?`,
      new Date().toISOString(),
      session.id,
    );
    paypal.refundValue = '0.01';
    const response = await call('POST', `/api/operator/sessions/${session.id}/refund`, {
      cookie: operatorCookie,
      body: {},
    });
    expect(response.statusCode).toBe(502);
    const row = ctx.store.get<{ payment_state: string; provider_status: string }>(
      'SELECT payment_state, provider_status FROM sessions WHERE id = ?',
      session.id,
    );
    expect(row).toMatchObject({ payment_state: 'UNRESOLVED', provider_status: 'REFUND_AMOUNT_MISMATCH' });
    paypal.refundValue = null;
  });

  it('rejects a second provider key for the same capture operation', async () => {
    const session = await createReviewedSession();
    ctx.store.run(
      `INSERT INTO payment_operations
         (id, session_id, operation_type, request_id, state, amount_minor, currency, request_hash, provider_ref, response_json, attempts, created_at, updated_at)
       VALUES ('pop_contract_lock', ?, 'CAPTURE', 'different-provider-key', 'UNKNOWN', 20, 'USD', 'hash', NULL, NULL, 1, ?, ?)`,
      session.id,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const response = await call('POST', `/api/sessions/${session.id}/capture`, { cookie: renterCookie, body: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PAYMENT_OPERATION_CONFLICT');
  });

  it('returns a consistent rejection for an invalid webhook signature and accepts a signed retry', async () => {
    paypal.webhookValid = false;
    const raw = JSON.stringify({
      id: 'WH-CONTRACT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-NOT-LINKED' },
    });
    const headers = {
      'content-type': 'application/json',
      'paypal-transmission-id': 'transmission-contract',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-11-01T00:00:00Z',
    };
    const rejected = await app.inject({ method: 'POST', url: '/api/paypal/webhook', headers, payload: raw });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json<{ error: { code: string } }>().error.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    paypal.webhookValid = true;
    const accepted = await app.inject({ method: 'POST', url: '/api/paypal/webhook', headers, payload: raw });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<{ verified: boolean }>().verified).toBe(true);
    const replay = await app.inject({ method: 'POST', url: '/api/paypal/webhook', headers, payload: raw });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ duplicate: boolean }>().duplicate).toBe(true);
  });
});