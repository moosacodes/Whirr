import type { Actor, AppContext } from '../context.ts';
import type { PaymentOperationRow, SessionRow } from './rows.ts';
import {
  buildSessionView,
  getSession,
  loadIntervals,
  intervalRowsToRaw,
  requireSession,
  requireSessionForActor,
  sessionModelRow,
  sessionObjectRow,
} from './sessions.ts';
import { generateAndStoreReceipt } from './receipts.ts';
import { enqueueOutbox } from './outbox.ts';
import { appendAudit } from '../lib/audit.ts';
import { errors, AppError } from '../lib/errors.ts';
import { newId, providerRequestId } from '../lib/ids.ts';
import { decimalStringToMinor, type Currency } from '../../../../packages/meter/src/currency.ts';
import { summariseIntervals } from '../../../../packages/meter/src/intervals.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import {
  PayPalApiError,
  extractAuthorization,
  type PayPalCapture,
  type PayPalOrder,
  type PayPalAuthorization,
  type PayPalRefund,
} from '../../../../packages/paypal/src/client.ts';
import type { PaymentState, SessionView } from '../../../../packages/contracts/src/types.ts';

const ORDER_FRESH_MS = 2.5 * 60 * 60 * 1000;
const RECONCILE_THROTTLE_MS = 4_000;

function getOperation(
  ctx: AppContext,
  sessionId: string,
  type: PaymentOperationRow['operation_type'],
): PaymentOperationRow | undefined {
  return ctx.store.get<PaymentOperationRow>(
    'SELECT * FROM payment_operations WHERE session_id = ? AND operation_type = ?',
    sessionId,
    type,
  );
}

function ensureOperation(
  ctx: AppContext,
  sessionId: string,
  type: PaymentOperationRow['operation_type'],
  input: { requestId: string; amountMinor: number | null; currency: Currency; state?: string },
): PaymentOperationRow {
  const existing = getOperation(ctx, sessionId, type);
  const now = ctx.now().toISOString();
  if (existing) {
    ctx.store.run(
      `UPDATE payment_operations SET request_id = ?, state = ?, amount_minor = ?, currency = ?,
         attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      input.requestId,
      input.state ?? existing.state,
      input.amountMinor,
      input.currency,
      now,
      existing.id,
    );
    return getOperation(ctx, sessionId, type)!;
  }
  const id = newId('pop');
  ctx.store.run(
    `INSERT INTO payment_operations
      (id, session_id, operation_type, request_id, state, amount_minor, currency, request_hash, provider_ref,
       response_json, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
    id,
    sessionId,
    type,
    input.requestId,
    input.state ?? 'PENDING',
    input.amountMinor,
    input.currency,
    providerRequestId([type, sessionId, input.requestId]),
    now,
    now,
  );
  return getOperation(ctx, sessionId, type)!;
}

function finishOperation(
  ctx: AppContext,
  operation: PaymentOperationRow,
  input: { state: string; providerRef?: string | null; response?: unknown },
): void {
  const safeResponse = input.response === undefined ? null : JSON.stringify(input.response).slice(0, 200_000);
  ctx.store.run(
    `UPDATE payment_operations SET state = ?, provider_ref = COALESCE(?, provider_ref),
       response_json = COALESCE(?, response_json), updated_at = ? WHERE id = ?`,
    input.state,
    input.providerRef ?? null,
    safeResponse,
    ctx.now().toISOString(),
    operation.id,
  );
}

function recordResource(
  ctx: AppContext,
  sessionId: string,
  kind: 'ORDER' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND',
  providerId: string,
  status: string,
  amountMinor: number | null,
  currency: Currency | null,
  raw: unknown,
): void {
  const now = ctx.now().toISOString();
  ctx.store.run(
    `INSERT INTO paypal_resources (id, session_id, kind, provider_id, status, amount_minor, currency, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, provider_id) DO UPDATE SET status = excluded.status, amount_minor = excluded.amount_minor,
       currency = excluded.currency, raw_json = excluded.raw_json, updated_at = excluded.updated_at,
       session_id = COALESCE(paypal_resources.session_id, excluded.session_id)`,
    newId('prs'),
    sessionId,
    kind,
    providerId,
    status,
    amountMinor,
    currency,
    JSON.stringify(raw).slice(0, 200_000),
    now,
    now,
  );
}

function amountMatches(
  amount: { currency_code: string; value: string } | undefined,
  expectedMinor: number,
  currency: Currency,
): boolean {
  if (!amount) return false;
  if (amount.currency_code !== currency) return false;
  return decimalStringToMinor(String(amount.value), currency) === expectedMinor;
}

function providerStatusOf(value: { status?: unknown } | null | undefined): string {
  return typeof value?.status === 'string' ? value.status : 'UNKNOWN';
}

function providerFailure(error: unknown): AppError {
  if (error instanceof PayPalApiError) {
    return new AppError(502, error.issue ?? 'PAYPAL_ERROR', `PayPal Sandbox: ${error.message}`, {
      issue: error.issue,
      debugId: error.debugId,
      providerStatus: error.status,
    });
  }
  return errors.provider(`PayPal Sandbox request failed: ${(error as Error).message}`);
}

function requirePayPal(ctx: AppContext) {
  if (!ctx.paypal) {
    throw errors.unavailable('PayPal Sandbox is not configured on this installation. Use demo metering mode.');
  }
  return ctx.paypal;
}

function clientOrderOrigin(ctx: AppContext, origin: string): string {
  if (!ctx.config.publicOrigins.includes(origin.replace(/\/$/, ''))) {
    throw errors.badRequest('Unrecognised application origin for the PayPal return URL');
  }
  return origin.replace(/\/$/, '');
}

function setPayment(
  ctx: AppContext,
  sessionId: string,
  input: {
    paymentState?: PaymentState;
    state?: SessionRow['state'];
    providerStatus?: string | null;
    orderId?: string | null;
    approveUrl?: string | null;
    authorizationId?: string | null;
    captureId?: string | null;
    refundId?: string | null;
    capturedMinor?: number | null;
    finalizedAt?: string | null;
    failureReason?: string | null;
  },
): void {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (input.paymentState !== undefined) set('payment_state', input.paymentState);
  if (input.state !== undefined) set('state', input.state);
  if (input.providerStatus !== undefined) set('provider_status', input.providerStatus);
  if (input.orderId !== undefined) set('paypal_order_id', input.orderId);
  if (input.approveUrl !== undefined) set('paypal_approve_url', input.approveUrl);
  if (input.authorizationId !== undefined) set('paypal_authorization_id', input.authorizationId);
  if (input.captureId !== undefined) set('paypal_capture_id', input.captureId);
  if (input.refundId !== undefined) set('paypal_refund_id', input.refundId);
  if (input.capturedMinor !== undefined) set('captured_minor', input.capturedMinor);
  if (input.finalizedAt !== undefined) set('finalized_at', input.finalizedAt);
  if (input.failureReason !== undefined) set('failure_reason', input.failureReason);
  if (fields.length === 0) return;
  values.push(sessionId);
  ctx.store.run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

export async function createAuthorizationOrder(
  ctx: AppContext,
  renterId: string,
  sessionId: string,
  origin: string,
): Promise<{ orderId: string; approveUrl: string | null }> {
  const paypal = requirePayPal(ctx);
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renterId });
  if (!session.consented_at) throw errors.conflict('NO_CONSENT', 'Accept the terms before creating a payment.');
  if (session.state !== 'CONSENTED' && session.state !== 'PAYMENT_PENDING') {
    throw errors.conflict('INVALID_STATE', `Cannot create an order from state ${session.state}.`);
  }
  if (
    session.payment_state !== 'NONE' &&
    session.payment_state !== 'ORDER_CREATED' &&
    session.payment_state !== 'BUYER_APPROVED'
  ) {
    throw errors.conflict('PAYMENT_STATE', `Payment is already ${session.payment_state}.`);
  }

  const publicOrigin = clientOrderOrigin(ctx, origin);
  const renewalOrderId = session.paypal_order_id;
  if (renewalOrderId && session.paypal_approve_url) {
    const age = ctx.now().getTime() - Date.parse(session.created_at);
    if (age < ORDER_FRESH_MS) {
      return { orderId: renewalOrderId, approveUrl: session.paypal_approve_url };
    }
    // Keep the old order id as a deterministic renewal key until the new order
    // succeeds. This makes retries idempotent instead of creating a new order
    // on every attempt.
    setPayment(ctx, session.id, {
      approveUrl: null,
      paymentState: 'NONE',
      state: 'CONSENTED',
      providerStatus: 'ORDER_RENEWED',
    });
  }

  const nonce = renewalOrderId ? `renew-${renewalOrderId}` : 'primary';
  const requestId = providerRequestId(['order', session.id, session.terms_hash, session.cap_minor, nonce]);
  const operation = ensureOperation(ctx, session.id, 'CREATE_ORDER', {
    requestId,
    amountMinor: session.cap_minor,
    currency: session.currency,
    state: 'PENDING',
  });
  try {
    const { order, approveUrl } = await paypal.createOrder({
      capMinor: session.cap_minor,
      currency: session.currency,
      sessionId: session.id,
      description: `Whirr metered session — ${sessionObjectRow(ctx, session).name}`,
      returnUrl: `${publicOrigin}/session/${session.id}?paypal=return`,
      cancelUrl: `${publicOrigin}/session/${session.id}?paypal=cancel`,
      requestId,
    });
    if (!order.id || !approveUrl) {
      throw errors.provider('PayPal Sandbox did not return an approval link for this order.');
    }
    recordResource(ctx, session.id, 'ORDER', order.id, providerStatusOf(order), session.cap_minor, session.currency, order);
    finishOperation(ctx, operation, { state: 'COMPLETED', providerRef: order.id, response: order });
    setPayment(ctx, session.id, {
      paymentState: 'ORDER_CREATED',
      state: 'PAYMENT_PENDING',
      orderId: order.id,
      approveUrl,
      providerStatus: providerStatusOf(order),
    });
    appendAudit(ctx.store, {
      actorType: 'renter',
      actorId: renterId,
      action: 'payment.order_created',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { orderId: order.id, capMinor: session.cap_minor, currency: session.currency },
    }, ctx.now());
    return { orderId: order.id, approveUrl };
  } catch (error) {
    finishOperation(ctx, operation, { state: 'FAILED' });
    throw providerFailure(error);
  }
}

export async function authorizeReturnPayment(
  ctx: AppContext,
  renterId: string,
  sessionId: string,
): Promise<SessionView> {
  const paypal = requirePayPal(ctx);
  let session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renterId });
  if (session.payment_state === 'AUTHORIZED' && session.paypal_authorization_id) {
    return buildSessionView(ctx, session, { type: 'renter', id: renterId });
  }
  if (!session.paypal_order_id) throw errors.conflict('NO_ORDER', 'Create a PayPal order first.');
  if (session.payment_state !== 'ORDER_CREATED' && session.payment_state !== 'BUYER_APPROVED') {
    throw errors.conflict('PAYMENT_STATE', `Cannot authorize while payment is ${session.payment_state}.`);
  }
  const requestId = providerRequestId(['authorize', session.id, session.paypal_order_id, session.terms_hash]);
  const operation = ensureOperation(ctx, session.id, 'AUTHORIZE', {
    requestId,
    amountMinor: session.cap_minor,
    currency: session.currency,
    state: 'PENDING',
  });
  try {
    let order = await paypal.getOrder(session.paypal_order_id);
    let providerStatus = providerStatusOf(order);
    if (order.status === 'CREATED' || order.status === 'PAYER_ACTION_REQUIRED') {
      setPayment(ctx, session.id, { providerStatus, paymentState: 'ORDER_CREATED' });
      finishOperation(ctx, operation, { state: 'WAITING_FOR_BUYER', response: order });
      throw errors.conflict('BUYER_NOT_APPROVED', 'The buyer has not approved the PayPal Sandbox order yet.');
    }
    if (order.status === 'APPROVED') {
      try {
        order = await paypal.authorizeOrder(session.paypal_order_id, requestId);
      } catch (error) {
        if (error instanceof PayPalApiError && (error.issue === 'ORDER_ALREADY_AUTHORIZED' || error.status === 422)) {
          order = await paypal.getOrder(session.paypal_order_id);
        } else {
          throw error;
        }
      }
      providerStatus = providerStatusOf(order);
    }
    if (order.status === 'VOIDED' || order.status === 'EXPIRED') {
      finishOperation(ctx, operation, { state: 'FAILED', response: order });
      setPayment(ctx, session.id, { providerStatus: order.status, paymentState: 'UNRESOLVED', state: 'FAILED' });
      throw errors.conflict('ORDER_NOT_AUTHORIZABLE', `The PayPal order is ${order.status}. Create a new session.`);
    }

    let authorization = extractAuthorization(order);
    if (!authorization) {
      order = await paypal.getOrder(session.paypal_order_id);
      authorization = extractAuthorization(order);
    }
    if (!authorization) {
      setPayment(ctx, session.id, { providerStatus: 'AUTHORIZATION_MISSING', paymentState: 'UNRESOLVED' });
      finishOperation(ctx, operation, { state: 'UNRESOLVED', response: order });
      throw errors.provider('PayPal did not return an authorization for this approved order.');
    }

    const authoritative: PayPalAuthorization = await paypal.getAuthorization(authorization.id);
    recordResource(
      ctx,
      session.id,
      'AUTHORIZATION',
      authoritative.id,
      providerStatusOf(authoritative),
      session.cap_minor,
      session.currency,
      authoritative,
    );
    if (authoritative.status === 'VOIDED') {
      setPayment(ctx, session.id, {
        paymentState: 'VOIDED',
        state: 'FAILED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishOperation(ctx, operation, { state: 'FAILED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict('AUTHORIZATION_VOIDED', 'PayPal reports this authorization was voided.');
    }
    if (authoritative.status === 'CAPTURED' || authoritative.status === 'PARTIALLY_CAPTURED') {
      setPayment(ctx, session.id, {
        paymentState: 'UNRESOLVED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict('AUTHORIZATION_ALREADY_CAPTURED', 'This authorization is already captured. Use reconciliation.');
    }
    if (authoritative.status !== 'CREATED') {
      setPayment(ctx, session.id, {
        paymentState: 'UNRESOLVED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict(
        'AUTHORIZATION_NOT_CAPTURABLE',
        `PayPal authorization status is ${authoritative.status}; it is not ready for capture.`,
      );
    }
    if (!amountMatches(authoritative.amount, session.cap_minor, session.currency)) {
      setPayment(ctx, session.id, {
        paymentState: 'UNRESOLVED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict(
        'AUTHORIZED_AMOUNT_MISMATCH',
        'PayPal authorized a different currency or amount than the consented cap.',
      );
    }

    setPayment(ctx, session.id, {
      paymentState: 'AUTHORIZED',
      state: 'READY',
      authorizationId: authoritative.id,
      providerStatus: authoritative.status,
      failureReason: null,
    });
    ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', ctx.now().toISOString(), session.id);
    finishOperation(ctx, operation, { state: 'COMPLETED', providerRef: authoritative.id, response: authoritative });
    appendAudit(ctx.store, {
      actorType: 'renter',
      actorId: renterId,
      action: 'payment.authorized',
      subjectType: 'session',
      subjectId: session.id,
      metadata: {
        orderId: session.paypal_order_id,
        authorizationId: authoritative.id,
        authorizedMinor: session.cap_minor,
        providerStatus: authoritative.status,
      },
    }, ctx.now());
    session = requireSession(ctx, session.id);
    return buildSessionView(ctx, session, { type: 'renter', id: renterId });
  } catch (error) {
    if (error instanceof AppError) throw error;
    finishOperation(ctx, operation, { state: 'UNKNOWN' });
    setPayment(ctx, session.id, { providerStatus: 'AUTHORIZE_OUTCOME_UNKNOWN' });
    throw providerFailure(error);
  }
}

export async function capturePayment(
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
): Promise<SessionView> {
  const paypal = requirePayPal(ctx);
  let session = requireSessionForActor(ctx, sessionId, actor);
  if (session.captured_minor !== null || session.payment_state === 'CAPTURE_COMPLETED') {
    return buildSessionView(ctx, session, actor);
  }
  if (session.state !== 'REVIEWED') {
    throw errors.conflict('REVIEW_REQUIRED', 'The renter must review and accept the bill before capture.');
  }
  if (session.quote_minor <= 0) {
    throw errors.conflict('ZERO_CHARGE', 'A zero bill must be resolved by voiding the authorization, never captured.');
  }
  if (session.payment_state !== 'AUTHORIZED' && session.payment_state !== 'CAPTURE_REQUESTED') {
    throw errors.conflict('PAYMENT_STATE', `Cannot capture while payment is ${session.payment_state}.`);
  }
  if (!session.paypal_authorization_id) throw errors.conflict('NO_AUTHORIZATION', 'No PayPal authorization exists.');
  if (!session.reviewed_quote_hash || session.reviewed_quote_hash !== session.quote_hash) {
    throw errors.conflict('QUOTE_CHANGED', 'The quote changed after review. The renter must accept it again.');
  }
  if (session.review_mode === 'OPERATOR_REQUIRED' && !session.operator_approved_at) {
    throw errors.conflict('OPERATOR_REVIEW_REQUIRED', 'An operator must approve this LIMITED-model bill first.');
  }
  if (session.review_mode !== 'AUTO' && actor.type === 'operator' && !session.operator_approved_at) {
    throw errors.conflict('OPERATOR_REVIEW_REQUIRED', 'Approve the reviewed bill before capturing.');
  }

  const requestId = providerRequestId([
    'capture',
    session.id,
    session.quote_hash,
    session.quote_minor,
    session.paypal_authorization_id,
  ]);
  const operation = ensureOperation(ctx, session.id, 'CAPTURE', {
    requestId,
    amountMinor: session.quote_minor,
    currency: session.currency,
    state: 'REQUESTED',
  });
  setPayment(ctx, session.id, {
    paymentState: 'CAPTURE_REQUESTED',
    state: 'SETTLEMENT_PENDING',
    failureReason: null,
  });
  try {
    const capture: PayPalCapture = await paypal.captureAuthorization({
      authorizationId: session.paypal_authorization_id,
      amountMinor: session.quote_minor,
      currency: session.currency,
      requestId,
      invoiceId: session.id,
      noteToPayer: `Whirr session ${session.id.slice(-8)} — ${(session.billable_ms / 1000).toFixed(1)}s billable`,
    });
    recordResource(
      ctx,
      session.id,
      'CAPTURE',
      capture.id,
      providerStatusOf(capture),
      session.quote_minor,
      session.currency,
      capture,
    );
    const status = providerStatusOf(capture);
    if (status === 'COMPLETED') {
      // PayPal may return a minimal capture representation from the POST. Fetch
      // the authoritative resource before comparing amount/currency or settling.
      const authoritativeCapture = await paypal.getCapture(capture.id);
      recordResource(
        ctx,
        session.id,
        'CAPTURE',
        authoritativeCapture.id,
        providerStatusOf(authoritativeCapture),
        session.quote_minor,
        session.currency,
        authoritativeCapture,
      );
      const authoritativeStatus = providerStatusOf(authoritativeCapture);
      if (authoritativeStatus !== 'COMPLETED') {
        finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritativeCapture.id, response: authoritativeCapture });
        setPayment(ctx, session.id, {
          paymentState: 'CAPTURE_PENDING',
          state: 'SETTLEMENT_PENDING',
          captureId: authoritativeCapture.id,
          providerStatus: authoritativeStatus,
          failureReason: `PayPal authoritative capture status was ${authoritativeStatus}.`,
        });
        enqueueOutbox(ctx, 'RECONCILE_SESSION', { sessionId: session.id }, 15_000);
        throw errors.provider('PayPal did not confirm a COMPLETED capture on authoritative lookup.', {
          captureId: authoritativeCapture.id,
          providerStatus: authoritativeStatus,
        });
      }
      if (!amountMatches(authoritativeCapture.amount, session.quote_minor, session.currency)) {
        finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritativeCapture.id, response: authoritativeCapture });
        setPayment(ctx, session.id, {
          paymentState: 'UNRESOLVED',
          state: 'SETTLEMENT_PENDING',
          captureId: authoritativeCapture.id,
          providerStatus: 'AMOUNT_MISMATCH',
          failureReason: 'PayPal captured a different amount or currency than the reviewed quote.',
        });
        throw errors.provider(
          'PayPal completed a capture but the amount or currency did not match the reviewed bill. Operator reconciliation is required.',
          { captureId: authoritativeCapture.id },
        );
      }
      const finalizedAt = ctx.now().toISOString();
      setPayment(ctx, session.id, {
        paymentState: 'CAPTURE_COMPLETED',
        state: 'SETTLED',
        captureId: authoritativeCapture.id,
        capturedMinor: session.quote_minor,
        providerStatus: authoritativeStatus,
        finalizedAt,
        failureReason: null,
      });
      ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', finalizedAt, session.id);
      finishOperation(ctx, operation, { state: 'COMPLETED', providerRef: authoritativeCapture.id, response: authoritativeCapture });
      session = requireSession(ctx, session.id);
      generateAndStoreReceipt(ctx, session);
      appendAudit(ctx.store, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'payment.capture_completed',
        subjectType: 'session',
        subjectId: session.id,
        metadata: {
          captureId: authoritativeCapture.id,
          amountMinor: session.quote_minor,
          currency: session.currency,
          providerStatus: providerStatusOf(authoritativeCapture),
        },
      }, ctx.now());
      return buildSessionView(ctx, session, actor);
    }
    if (status === 'PENDING') {
      setPayment(ctx, session.id, {
        paymentState: 'CAPTURE_PENDING',
        state: 'SETTLEMENT_PENDING',
        captureId: capture.id,
        capturedMinor: null,
        providerStatus: status,
      });
      finishOperation(ctx, operation, { state: 'PENDING', providerRef: capture.id, response: capture });
      enqueueOutbox(ctx, 'RECONCILE_SESSION', { sessionId: session.id }, 15_000);
      appendAudit(ctx.store, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'payment.capture_pending',
        subjectType: 'session',
        subjectId: session.id,
        metadata: { captureId: capture.id, providerStatus: status },
      }, ctx.now());
      return buildSessionView(ctx, requireSession(ctx, session.id), actor);
    }
    finishOperation(ctx, operation, { state: 'FAILED', providerRef: capture.id, response: capture });
    setPayment(ctx, session.id, {
      paymentState: 'CAPTURE_DENIED',
      state: 'FAILED',
      captureId: capture.id,
      providerStatus: status,
      failureReason: `PayPal capture status ${status}`,
    });
    appendAudit(ctx.store, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'payment.capture_failed',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { captureId: capture.id, providerStatus: status },
    }, ctx.now());
    throw errors.provider(`PayPal did not complete the capture (status ${status}). No settlement was recorded.`);
  } catch (error) {
    if (error instanceof AppError) throw error;
    finishOperation(ctx, operation, { state: 'UNKNOWN' });
    setPayment(ctx, session.id, { providerStatus: 'CAPTURE_OUTCOME_UNKNOWN' });
    throw providerFailure(error);
  }
}

export async function voidPayment(ctx: AppContext, actor: Actor, sessionId: string): Promise<SessionView> {
  const paypal = requirePayPal(ctx);
  const session = requireSessionForActor(ctx, sessionId, actor);
  if (session.payment_state === 'VOIDED' || session.state === 'NO_CHARGE') {
    return buildSessionView(ctx, session, actor);
  }
  if (session.payment_state !== 'AUTHORIZED') {
    throw errors.conflict('PAYMENT_STATE', `Cannot void while payment is ${session.payment_state}.`);
  }
  if (!session.paypal_authorization_id) throw errors.conflict('NO_AUTHORIZATION', 'No authorization to void.');
  if (session.quote_minor > 0 && actor.type !== 'operator') {
    throw errors.conflict('OPERATOR_ONLY', 'Only an operator can waive a non-zero bill.');
  }
  if (session.state !== 'REVIEWED' && !(actor.type === 'operator' && session.state === 'STOPPED')) {
    throw errors.conflict('INVALID_STATE', 'Void requires a stopped or reviewed session.');
  }
  const requestId = providerRequestId(['void', session.id, session.paypal_authorization_id]);
  const operation = ensureOperation(ctx, session.id, 'VOID', {
    requestId,
    amountMinor: 0,
    currency: session.currency,
    state: 'REQUESTED',
  });
  try {
    const voided: PayPalAuthorization = await paypal.voidAuthorization(session.paypal_authorization_id, requestId);
    recordResource(ctx, session.id, 'AUTHORIZATION', voided.id, providerStatusOf(voided), 0, session.currency, voided);
    const confirmed = await paypal.getAuthorization(session.paypal_authorization_id);
    if (confirmed.status !== 'VOIDED') {
      finishOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: voided.id, response: confirmed });
      setPayment(ctx, session.id, { paymentState: 'UNRESOLVED', providerStatus: confirmed.status });
      throw errors.provider(`PayPal did not confirm the void (status ${confirmed.status}).`);
    }
    finishOperation(ctx, operation, { state: 'COMPLETED', providerRef: voided.id, response: confirmed });
    setPayment(ctx, session.id, {
      paymentState: 'VOIDED',
      state: 'NO_CHARGE',
      capturedMinor: 0,
      providerStatus: confirmed.status,
      finalizedAt: ctx.now().toISOString(),
      failureReason: null,
    });
    ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', ctx.now().toISOString(), session.id);
    const updated = requireSession(ctx, session.id);
    generateAndStoreReceipt(ctx, updated);
    appendAudit(ctx.store, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'payment.authorization_voided',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { authorizationId: voided.id, quoteMinor: session.quote_minor },
    }, ctx.now());
    return buildSessionView(ctx, updated, actor);
  } catch (error) {
    if (error instanceof AppError) throw error;
    finishOperation(ctx, operation, { state: 'UNKNOWN' });
    setPayment(ctx, session.id, { providerStatus: 'VOID_OUTCOME_UNKNOWN' });
    throw providerFailure(error);
  }
}

export async function refundPayment(
  ctx: AppContext,
  operatorId: string,
  sessionId: string,
  amountMinor?: number,
): Promise<SessionView> {
  const paypal = requirePayPal(ctx);
  const session = requireSession(ctx, sessionId);
  if (session.payment_state !== 'CAPTURE_COMPLETED' && session.payment_state !== 'REFUND_REQUESTED') {
    throw errors.conflict('NOT_CAPTURED', 'Only a captured Sandbox payment can be refunded.');
  }
  if (!session.paypal_capture_id || session.captured_minor === null) {
    throw errors.conflict('NO_CAPTURE', 'No captured payment found.');
  }
  const refundAmount = amountMinor ?? session.captured_minor;
  if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || refundAmount > session.captured_minor) {
    throw errors.badRequest('Refund must be a positive integer not exceeding the captured amount.');
  }
  if (session.paypal_refund_id) throw errors.conflict('ALREADY_REFUNDED', 'A refund already exists for this capture.');
  const requestId = providerRequestId(['refund', session.id, session.paypal_capture_id, refundAmount]);
  const operation = ensureOperation(ctx, session.id, 'REFUND', {
    requestId,
    amountMinor: refundAmount,
    currency: session.currency,
    state: 'REQUESTED',
  });
  try {
    const refund: PayPalRefund = await paypal.refundCapture({
      captureId: session.paypal_capture_id,
      amountMinor: refundAmount === session.captured_minor ? undefined : refundAmount,
      currency: session.currency,
      requestId,
    });
    const status = providerStatusOf(refund);
    recordResource(ctx, session.id, 'REFUND', refund.id, status, refundAmount, session.currency, refund);
    const full = refundAmount === session.captured_minor;
    finishOperation(ctx, operation, {
      state: status === 'COMPLETED' ? 'COMPLETED' : status === 'PENDING' ? 'PENDING' : 'FAILED',
      providerRef: refund.id,
      response: refund,
    });
    setPayment(ctx, session.id, {
      paymentState: status === 'COMPLETED' ? 'REFUNDED' : 'REFUND_REQUESTED',
      refundId: refund.id,
      providerStatus: `REFUND_${status}`,
      failureReason: status === 'FAILED' ? 'PayPal rejected the refund' : null,
    });
    ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', ctx.now().toISOString(), session.id);
    const updated = requireSession(ctx, session.id);
    generateAndStoreReceipt(ctx, updated);
    appendAudit(ctx.store, {
      actorType: 'operator',
      actorId: operatorId,
      action: 'payment.refund_requested',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { refundId: refund.id, refundAmount, full, providerStatus: status },
    }, ctx.now());
    return buildSessionView(ctx, updated, { type: 'operator', id: operatorId });
  } catch (error) {
    if (error instanceof AppError) throw error;
    finishOperation(ctx, operation, { state: 'UNKNOWN' });
    throw providerFailure(error);
  }
}

export function demoComplete(ctx: AppContext, renterId: string, sessionId: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renterId });
  if (session.payment_state !== 'DEMO_MODE') {
    throw errors.conflict('NOT_DEMO', 'This session is not in demo metering mode.');
  }
  if (session.state !== 'REVIEWED') {
    throw errors.conflict('REVIEW_REQUIRED', 'Accept the reviewed bill before completing the demo session.');
  }
  const finalizedAt = ctx.now().toISOString();
  setPayment(ctx, session.id, { state: 'DEMO_COMPLETED', finalizedAt });
  const updated = requireSession(ctx, session.id);
  generateAndStoreReceipt(ctx, updated);
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renterId,
    action: 'session.demo_completed',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { quoteMinor: session.quote_minor, note: 'No payment processed' },
  }, ctx.now());
  return buildSessionView(ctx, updated, { type: 'renter', id: renterId });
}

export async function reconcileSession(ctx: AppContext, sessionId: string): Promise<SessionRow> {
  let session = requireSession(ctx, sessionId);
  if (!ctx.paypal) return session;
  if (session.state === 'DEMO_COMPLETED' || session.payment_state === 'DEMO_MODE') return session;
  if (
    !session.paypal_order_id &&
    !session.paypal_authorization_id &&
    !session.paypal_capture_id
  ) {
    return session;
  }
  try {
    if (session.paypal_capture_id) {
      const capture = await ctx.paypal.getCapture(session.paypal_capture_id);
      const status = providerStatusOf(capture);
      recordResource(ctx, session.id, 'CAPTURE', capture.id, status, session.quote_minor, session.currency, capture);
      if (status === 'COMPLETED') {
        const expected = session.quote_minor;
        const reviewed =
          Boolean(session.reviewed_quote_hash) && session.reviewed_quote_hash === session.quote_hash;
        const settlementInProgress = session.state === 'SETTLEMENT_PENDING' || session.state === 'SETTLED';
        if (!reviewed || !settlementInProgress) {
          setPayment(ctx, session.id, {
            paymentState: 'UNRESOLVED',
            state: 'SETTLEMENT_PENDING',
            providerStatus: 'CAPTURE_OUTSIDE_REVIEW',
            failureReason: 'Provider completed a capture without a matching renter-reviewed quote.',
          });
        } else if (!amountMatches(capture.amount, expected, session.currency)) {
          setPayment(ctx, session.id, {
            paymentState: 'UNRESOLVED',
            state: 'SETTLEMENT_PENDING',
            providerStatus: 'AMOUNT_MISMATCH',
            failureReason: 'Provider capture amount does not match the reviewed quote.',
          });
        } else if (session.payment_state !== 'CAPTURE_COMPLETED') {
          setPayment(ctx, session.id, {
            paymentState: 'CAPTURE_COMPLETED',
            state: 'SETTLED',
            capturedMinor: expected,
            providerStatus: status,
            finalizedAt: session.finalized_at ?? ctx.now().toISOString(),
          });
          session = requireSession(ctx, session.id);
          generateAndStoreReceipt(ctx, session);
        }
      } else if (status === 'PENDING') {
        if (session.payment_state !== 'CAPTURE_PENDING') {
          setPayment(ctx, session.id, { paymentState: 'CAPTURE_PENDING', state: 'SETTLEMENT_PENDING', providerStatus: status });
        }
      } else if (status === 'DECLINED' || status === 'FAILED') {
        setPayment(ctx, session.id, {
          paymentState: 'CAPTURE_DENIED',
          state: 'FAILED',
          providerStatus: status,
          failureReason: `PayPal capture status ${status}`,
        });
      }
    } else if (session.paypal_authorization_id) {
      const authorization = await ctx.paypal.getAuthorization(session.paypal_authorization_id);
      const status = providerStatusOf(authorization);
      recordResource(ctx, session.id, 'AUTHORIZATION', authorization.id, status, session.cap_minor, session.currency, authorization);
      if (status === 'VOIDED' && session.payment_state === 'AUTHORIZED') {
        setPayment(ctx, session.id, {
          paymentState: 'VOIDED',
          providerStatus: status,
          state: session.quote_minor === 0 ? 'NO_CHARGE' : session.state,
        });
      } else if ((status === 'CAPTURED' || status === 'PARTIALLY_CAPTURED') && !session.paypal_capture_id) {
        setPayment(ctx, session.id, {
          paymentState: 'UNRESOLVED',
          providerStatus: status,
          failureReason: 'PayPal reports the authorization captured but no capture ID is stored.',
        });
      } else if (status === 'CREATED' && session.payment_state === 'AUTHORIZED') {
        setPayment(ctx, session.id, { providerStatus: status });
      }
    } else if (session.paypal_order_id) {
      const order = await ctx.paypal.getOrder(session.paypal_order_id);
      const status = providerStatusOf(order);
      recordResource(ctx, session.id, 'ORDER', order.id, status, session.cap_minor, session.currency, order);
      if (status === 'APPROVED' && session.payment_state === 'ORDER_CREATED') {
        setPayment(ctx, session.id, { paymentState: 'BUYER_APPROVED', providerStatus: status });
      } else if (status === 'COMPLETED') {
        const authorization = extractAuthorization(order);
        if (authorization) {
          setPayment(ctx, session.id, { providerStatus: status, authorizationId: authorization.id });
        }
      } else if (status === 'VOIDED' || status === 'EXPIRED') {
        setPayment(ctx, session.id, { providerStatus: status });
      }
    }
    ctx.store.run('UPDATE sessions SET provider_reconciled_at = ? WHERE id = ?', ctx.now().toISOString(), session.id);
  } catch (error) {
    // Reconciliation never changes financial state on failure, and never logs credentials.
    ctx.store.run('UPDATE sessions SET provider_status = ? WHERE id = ?', 'RECONCILE_FAILED', session.id);
    appendAudit(ctx.store, {
      actorType: 'system',
      actorId: 'reconciler',
      action: 'payment.reconcile_failed',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { message: (error as Error).message.slice(0, 200) },
    }, ctx.now());
  }
  return requireSession(ctx, session.id);
}

export async function getPaymentStatus(
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  reconcile = true,
): Promise<{
  orderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  refundId: string | null;
  paymentState: PaymentState;
  providerStatus: string | null;
  providerReconciledAt: string | null;
  capturedMinor: number | null;
  quoteMinor: number;
  approvedCapMinor: number;
  currency: string;
  sandbox: { configured: boolean; env: 'sandbox' };
  live: boolean;
}> {
  let session = requireSessionForActor(ctx, sessionId, actor);
  if (reconcile && ctx.paypal) {
    const last = session.provider_reconciled_at ? Date.parse(session.provider_reconciled_at) : 0;
    if (ctx.now().getTime() - last > RECONCILE_THROTTLE_MS) {
      session = await reconcileSession(ctx, session.id);
    }
  }
  return {
    orderId: session.paypal_order_id,
    authorizationId: session.paypal_authorization_id,
    captureId: session.paypal_capture_id,
    refundId: session.paypal_refund_id,
    paymentState: session.payment_state,
    providerStatus: session.provider_status,
    providerReconciledAt: session.provider_reconciled_at,
    capturedMinor: session.captured_minor,
    quoteMinor: session.quote_minor,
    approvedCapMinor: session.cap_minor,
    currency: session.currency,
    sandbox: { configured: ctx.config.paypal.configured, env: 'sandbox' },
    live: ctx.config.paypal.configured,
  };
}

export function settleDemoLocallyWatermark(session: SessionRow): string {
  return `No PayPal operation was created for session ${session.id}`;
}

export function isSettled(session: SessionRow): boolean {
  return session.payment_state === 'CAPTURE_COMPLETED' || session.payment_state === 'REFUNDED';
}

export function billableFromIntervalRows(sessionId: string, ctx: AppContext): number {
  const intervals = loadIntervals(ctx, sessionId);
  return summariseIntervals(intervalRowsToRaw(intervals)).billableMs;
}

export function expectedQuote(session: SessionRow, ctx: AppContext): number {
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  return quoteBreakdown(
    session.minor_per_minute,
    summary.billableMs,
    session.cap_minor,
    session.credit_minor,
    session.currency,
  ).finalMinor;
}

export { providerRequestId, getSession, sessionModelRow };
