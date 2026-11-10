import type { AppContext } from '../context.ts';
import type { WebhookEventRow } from './rows.ts';
import { reconcileSession } from './payments.ts';
import {
  findPromiseExecutionForProviderIds,
  reconcilePromiseExecution,
} from './promises.ts';
import { appendAudit } from '../lib/audit.ts';
import { errors, AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { sha256Hex } from '../lib/hash.ts';
import { enqueueOutbox } from './outbox.ts';

interface PayPalEventLike {
  id?: unknown;
  event_type?: unknown;
  resource?: {
    id?: unknown;
    supplementary_data?: { related_ids?: Record<string, unknown> };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WebhookIngestResult {
  received: boolean;
  duplicate: boolean;
  verified: boolean;
  result: string;
  eventId: string;
  eventType: string;
}

function validateEvent(event: PayPalEventLike): { id: string; type: string } {
  if (!event || typeof event !== 'object') throw errors.badRequest('Webhook body must be a JSON object');
  if (typeof event.id !== 'string' || event.id.length < 4 || event.id.length > 200) {
    throw errors.badRequest('Webhook event is missing a valid id');
  }
  if (typeof event.event_type !== 'string' || event.event_type.length < 3 || event.event_type.length > 120) {
    throw errors.badRequest('Webhook event is missing a valid event_type');
  }
  return { id: event.id, type: event.event_type };
}

function providerIdsForEvent(event: PayPalEventLike): string[] {
  const candidates = new Set<string>();
  const resource = event.resource ?? {};
  if (typeof resource.id === 'string') candidates.add(resource.id);
  const related = resource.supplementary_data?.related_ids ?? {};
  for (const key of ['order_id', 'authorization_id', 'capture_id']) {
    const value = related[key];
    if (typeof value === 'string') candidates.add(value);
  }
  return [...candidates];
}

export function findSessionForEvent(ctx: AppContext, event: PayPalEventLike): string | null {
  for (const providerId of providerIdsForEvent(event)) {
    const session = ctx.store.get<{ id: string }>(
      `SELECT id FROM sessions WHERE paypal_order_id = ? OR paypal_authorization_id = ? OR paypal_capture_id = ?
       LIMIT 1`,
      providerId,
      providerId,
      providerId,
    );
    if (session) return session.id;
    const resourceRow = ctx.store.get<{ session_id: string | null }>(
      'SELECT session_id FROM paypal_resources WHERE provider_id = ? AND session_id IS NOT NULL LIMIT 1',
      providerId,
    );
    if (resourceRow?.session_id) return resourceRow.session_id;
  }
  return null;
}

export function findPromiseExecutionForEvent(ctx: AppContext, event: PayPalEventLike): string | null {
  return findPromiseExecutionForProviderIds(ctx, providerIdsForEvent(event));
}

export async function ingestWebhook(
  ctx: AppContext,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<WebhookIngestResult> {
  if (!ctx.config.paypal.webhookConfigured) {
    throw errors.unavailable(
      'Webhook receiver is not configured. Set PAYPAL_WEBHOOK_ID after registering the HTTPS listener in the same Sandbox app.',
    );
  }
  let parsed: PayPalEventLike;
  try {
    parsed = JSON.parse(rawBody) as PayPalEventLike;
  } catch {
    throw errors.badRequest('Webhook body is not valid JSON');
  }
  const { id, type } = validateEvent(parsed);
  const payloadHash = sha256Hex(rawBody);
  const existing = ctx.store.get<WebhookEventRow>('SELECT * FROM paypal_webhook_events WHERE event_id = ?', id);
  if (existing?.verified && existing.payload_sha256 !== payloadHash) {
    appendAudit(ctx.store, {
      actorType: 'system',
      actorId: 'webhook',
      action: 'paypal.webhook_conflict',
      subjectType: 'webhook',
      subjectId: existing.id,
      metadata: { eventId: id },
    }, ctx.now());
    throw errors.conflict('WEBHOOK_PAYLOAD_CONFLICT', 'The same event id arrived with a different payload.');
  }
  if (existing?.verified) {
    return {
      received: true,
      duplicate: true,
      verified: true,
      result: existing.result ?? 'ALREADY_RECEIVED',
      eventId: id,
      eventType: existing.event_type,
    };
  }

  if (!ctx.paypal) throw errors.unavailable('PayPal is not configured.');

  // Verify before treating a payload as authoritative. A rejected first attempt
  // may reserve an event id, but it is never allowed to block a later signed
  // retry with the same id from replacing that unverified row.
  const verification = await ctx.paypal.verifyWebhookSignature({ headers, event: parsed });
  const now = ctx.now().toISOString();
  const transmissionId =
    typeof headers['paypal-transmission-id'] === 'string' ? headers['paypal-transmission-id'] : null;
  const rejectedResult = `SIGNATURE_REJECTED:${verification.status}`.slice(0, 200);

  let rowId: string;
  if (existing) {
    rowId = existing.id;
    if (!verification.verified) {
      if (existing.payload_sha256 === payloadHash) {
        ctx.store.run(
          'UPDATE paypal_webhook_events SET verified = 0, result = ? WHERE id = ?',
          rejectedResult,
          rowId,
        );
      }
      appendAudit(ctx.store, {
        actorType: 'system',
        actorId: 'webhook',
        action: 'paypal.webhook_rejected',
        subjectType: 'webhook',
        subjectId: rowId,
        metadata: { eventId: id, eventType: type, verification: verification.status.slice(0, 120) },
      }, ctx.now());
      throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'PayPal webhook signature verification failed.');
    }
    ctx.store.run(
      `UPDATE paypal_webhook_events
       SET event_type = ?, transmission_id = ?, payload_sha256 = ?, verified = 1,
           received_at = ?, processed_at = NULL, result = 'VERIFIED', raw_json = ?
       WHERE id = ?`,
      type,
      transmissionId,
      payloadHash,
      now,
      rawBody.slice(0, 400_000),
      rowId,
    );
  } else {
    rowId = newId('whe');
    if (!verification.verified) {
      ctx.store.run(
        `INSERT INTO paypal_webhook_events
          (id, event_id, event_type, transmission_id, payload_sha256, verified, received_at, processed_at, result, raw_json)
         VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
        rowId,
        id,
        type,
        transmissionId,
        payloadHash,
        now,
        rejectedResult,
        rawBody.slice(0, 8_192),
      );
      appendAudit(ctx.store, {
        actorType: 'system',
        actorId: 'webhook',
        action: 'paypal.webhook_rejected',
        subjectType: 'webhook',
        subjectId: rowId,
        metadata: { eventId: id, eventType: type, verification: verification.status.slice(0, 120) },
      }, ctx.now());
      throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'PayPal webhook signature verification failed.');
    }
    ctx.store.run(
      `INSERT INTO paypal_webhook_events
        (id, event_id, event_type, transmission_id, payload_sha256, verified, received_at, processed_at, result, raw_json)
       VALUES (?, ?, ?, ?, ?, 1, ?, NULL, 'VERIFIED', ?)`,
      rowId,
      id,
      type,
      transmissionId,
      payloadHash,
      now,
      rawBody.slice(0, 400_000),
    );
  }
  appendAudit(ctx.store, {
    actorType: 'system',
    actorId: 'webhook',
    action: 'paypal.webhook_verified',
    subjectType: 'webhook',
    subjectId: rowId,
    metadata: { eventId: id, eventType: type },
  }, ctx.now());

  const sessionId = findSessionForEvent(ctx, parsed);
  if (sessionId) {
    try {
      await reconcileSession(ctx, sessionId);
      ctx.store.run(
        'UPDATE paypal_webhook_events SET processed_at = ?, result = ? WHERE id = ?',
        ctx.now().toISOString(),
        'RECONCILED',
        rowId,
      );
      return { received: true, duplicate: false, verified: true, result: 'RECONCILED', eventId: id, eventType: type };
    } catch (error) {
      enqueueOutbox(ctx, 'RECONCILE_SESSION', { sessionId, webhookRowId: rowId }, 10_000);
      ctx.store.run(
        'UPDATE paypal_webhook_events SET result = ? WHERE id = ?',
        `RECONCILE_QUEUED:${(error as Error).message.slice(0, 120)}`,
        rowId,
      );
      return { received: true, duplicate: false, verified: true, result: 'RECONCILE_QUEUED', eventId: id, eventType: type };
    }
  }

  const promiseExecutionId = findPromiseExecutionForEvent(ctx, parsed);
  if (promiseExecutionId) {
    try {
      const reconciled = await reconcilePromiseExecution(ctx, promiseExecutionId);
      if (reconciled.result === 'RECONCILE_FAILED') {
        enqueueOutbox(
          ctx,
          'RECONCILE_PROMISE',
          { executionId: promiseExecutionId, webhookRowId: rowId },
          10_000,
        );
        ctx.store.run(
          'UPDATE paypal_webhook_events SET result = ? WHERE id = ?',
          'PROMISE_RECONCILE_QUEUED',
          rowId,
        );
        return {
          received: true,
          duplicate: false,
          verified: true,
          result: 'RECONCILE_QUEUED',
          eventId: id,
          eventType: type,
        };
      }
      const result =
        reconciled.result === 'RECONCILIATION_REQUIRED'
          ? 'PROMISE_RECONCILIATION_REQUIRED'
          : 'PROMISE_RECONCILED';
      ctx.store.run(
        'UPDATE paypal_webhook_events SET processed_at = ?, result = ? WHERE id = ?',
        ctx.now().toISOString(),
        result,
        rowId,
      );
      return { received: true, duplicate: false, verified: true, result, eventId: id, eventType: type };
    } catch (error) {
      enqueueOutbox(
        ctx,
        'RECONCILE_PROMISE',
        { executionId: promiseExecutionId, webhookRowId: rowId },
        10_000,
      );
      ctx.store.run(
        'UPDATE paypal_webhook_events SET result = ? WHERE id = ?',
        `PROMISE_RECONCILE_QUEUED:${(error as Error).message.slice(0, 120)}`,
        rowId,
      );
      return {
        received: true,
        duplicate: false,
        verified: true,
        result: 'RECONCILE_QUEUED',
        eventId: id,
        eventType: type,
      };
    }
  }

  ctx.store.run(
    'UPDATE paypal_webhook_events SET processed_at = ?, result = ? WHERE id = ?',
    ctx.now().toISOString(),
    'UNLINKED_EVENT',
    rowId,
  );
  return { received: true, duplicate: false, verified: true, result: 'UNLINKED_EVENT', eventId: id, eventType: type };
}

export async function drainOutbox(ctx: AppContext, max = 20): Promise<number> {
  const now = ctx.now().toISOString();
  const rows = ctx.store.all<{
    id: string;
    topic: string;
    payload_json: string;
    attempts: number;
    next_attempt_at: string;
  }>(
    `SELECT id, topic, payload_json, attempts, next_attempt_at FROM outbox
     WHERE processed_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?`,
    now,
    max,
  );
  let processed = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as {
        sessionId?: string;
        executionId?: string;
        webhookRowId?: string;
      };
      if (row.topic === 'RECONCILE_SESSION' && payload.sessionId) {
        await reconcileSession(ctx, payload.sessionId);
        if (payload.webhookRowId) {
          ctx.store.run(
            'UPDATE paypal_webhook_events SET processed_at = ?, result = ? WHERE id = ?',
            ctx.now().toISOString(),
            'RECONCILED_BY_OUTBOX',
            payload.webhookRowId,
          );
        }
      }
      if (row.topic === 'RECONCILE_PROMISE' && payload.executionId) {
        const reconciled = await reconcilePromiseExecution(ctx, payload.executionId);
        if (reconciled.result === 'RECONCILE_FAILED') {
          throw new Error('Promise reconciliation did not reach the provider.');
        }
        if (payload.webhookRowId) {
          ctx.store.run(
            'UPDATE paypal_webhook_events SET processed_at = ?, result = ? WHERE id = ?',
            ctx.now().toISOString(),
            reconciled.result === 'RECONCILIATION_REQUIRED'
              ? 'PROMISE_RECONCILIATION_REQUIRED_BY_OUTBOX'
              : 'PROMISE_RECONCILED_BY_OUTBOX',
            payload.webhookRowId,
          );
        }
      }
      ctx.store.run(
        'UPDATE outbox SET processed_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?',
        ctx.now().toISOString(),
        row.id,
      );
      processed += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const backoff = Math.min(300_000, 5_000 * 2 ** Math.min(6, attempts));
      ctx.store.run(
        'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
        attempts,
        new Date(ctx.now().getTime() + backoff).toISOString(),
        (error as Error).message.slice(0, 300),
        row.id,
      );
    }
  }
  return processed;
}
