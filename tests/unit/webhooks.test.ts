import { describe, expect, it } from 'vitest';
import { Store } from '../../apps/api/src/db/index.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import { ingestWebhook } from '../../apps/api/src/domain/webhooks.ts';
import type { PayPalClient } from '../../packages/paypal/src/client.ts';

function context(verified: boolean | (() => boolean)): AppContext {
  const store = new Store(':memory:');
  const now = () => new Date('2026-11-01T00:00:00.000Z');
  const config = {
    paypal: { webhookConfigured: true },
  } as AppContext['config'];
  const paypal = {
    verifyWebhookSignature: async () => {
      const ok = typeof verified === 'function' ? verified() : verified;
      return {
        verified: ok,
        status: ok ? 'SUCCESS' : 'FAILURE',
        raw: {},
      };
    },
  } as unknown as PayPalClient;
  return { store, now, config, paypal } as unknown as AppContext;
}

const headers = {
  'paypal-transmission-id': 'transmission-1',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-11-01T00:00:00Z',
};

describe('PayPal webhook ingestion', () => {
  it('verifies, deduplicates and rejects a conflicting payload', async () => {
    const ctx = context(true);
    const raw = JSON.stringify({
      id: 'WH-EVENT-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-NOT-LINKED' },
    });
    const first = await ingestWebhook(ctx, raw, headers);
    expect(first.received).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.verified).toBe(true);
    expect(first.result).toBe('UNLINKED_EVENT');

    const duplicate = await ingestWebhook(ctx, raw, headers);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.verified).toBe(true);

    await expect(
      ingestWebhook(
        ctx,
        JSON.stringify({ id: 'WH-EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-OTHER' } }),
        headers,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_PAYLOAD_CONFLICT' });

    const row = ctx.store.get<{ verified: number; result: string }>(
      "SELECT verified, result FROM paypal_webhook_events WHERE event_id = 'WH-EVENT-1'",
    );
    expect(row?.verified).toBe(1);
    expect(row?.result).toBe('UNLINKED_EVENT');
  });

  it('lets a valid signed retry replace an unverified event-id reservation', async () => {
    let valid = false;
    const ctx = context(() => valid);
    const first = JSON.stringify({
      id: 'WH-EVENT-3',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-BAD' },
    });
    await expect(ingestWebhook(ctx, first, headers)).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });

    valid = true;
    const second = JSON.stringify({
      id: 'WH-EVENT-3',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-GOOD' },
    });
    const result = await ingestWebhook(ctx, second, headers);
    expect(result.verified).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.result).toBe('UNLINKED_EVENT');

    const row = ctx.store.get<{ verified: number; result: string }>(
      "SELECT verified, result FROM paypal_webhook_events WHERE event_id = 'WH-EVENT-3'",
    );
    expect(row?.verified).toBe(1);
    expect(row?.result).toBe('UNLINKED_EVENT');
  });

  it('records but refuses a failed signature', async () => {
    const ctx = context(false);
    await expect(
      ingestWebhook(
        ctx,
        JSON.stringify({ id: 'WH-EVENT-2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-X' } }),
        headers,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    const row = ctx.store.get<{ verified: number; result: string }>(
      "SELECT verified, result FROM paypal_webhook_events WHERE event_id = 'WH-EVENT-2'",
    );
    expect(row?.verified).toBe(0);
    expect(row?.result).toContain('SIGNATURE_REJECTED');
  });
});
