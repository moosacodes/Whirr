import { describe, expect, it } from 'vitest';
import {
  extractAuthorization,
  findApprovalLink,
  isSafeSandboxApprovalUrl,
  isSafeWebhookCertUrl,
  PayPalClient,
} from '../../packages/paypal/src/client.ts';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function mockFetch(handler: (recorded: Recorded) => unknown): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const recorded: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(recorded);
    const result = handler(recorded) as { status?: number; body: unknown };
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('PayPal Sandbox client', () => {
  it('refuses a live PayPal base URL', () => {
    expect(
      () =>
        new PayPalClient({
          baseUrl: 'https://api-m.paypal.com',
          clientId: 'x',
          clientSecret: 'y',
          fetchImpl: fetch,
        }),
    ).toThrow(/only permits PayPal Sandbox/i);
  });

  it('only accepts HTTPS PayPal Sandbox approval navigation targets', () => {
    expect(isSafeSandboxApprovalUrl('https://www.sandbox.paypal.com/checkoutnow?token=1')).toBe(true);
    expect(isSafeSandboxApprovalUrl('https://sandbox.paypal.com/checkoutnow?token=1')).toBe(true);
    expect(isSafeSandboxApprovalUrl('http://www.sandbox.paypal.com/checkoutnow')).toBe(false);
    expect(isSafeSandboxApprovalUrl('https://paypal.com/checkoutnow')).toBe(false);
    expect(isSafeSandboxApprovalUrl('https://evil.example/sandbox.paypal.com')).toBe(false);
    expect(isSafeSandboxApprovalUrl('javascript:alert(1)')).toBe(false);
  });

  it('only accepts PayPal Sandbox certificate URLs for webhook verification', () => {
    expect(isSafeWebhookCertUrl('https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1')).toBe(true);
    expect(isSafeWebhookCertUrl('https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1')).toBe(true);
    expect(isSafeWebhookCertUrl('http://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1')).toBe(false);
    expect(isSafeWebhookCertUrl('https://api-m.sandbox.paypal.com.evil.example/cert')).toBe(false);
    expect(isSafeWebhookCertUrl('https://evil.example/cert')).toBe(false);
  });

  it('uses integer minor units and request ids for create order', async () => {
    const { fetchImpl, calls } = mockFetch((recorded) => {
      if (recorded.url.endsWith('/v1/oauth2/token')) {
        return { body: { access_token: 'token', expires_in: 3600 } };
      }
      return {
        body: {
          id: 'ORDER-1',
          status: 'CREATED',
          links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER-1' }],
        },
      };
    });
    const client = new PayPalClient({
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
    });
    const result = await client.createOrder({
      capMinor: 500,
      currency: 'USD',
      sessionId: 'ses_123',
      description: 'Whirr fan',
      returnUrl: 'http://localhost:5173/session/ses_123?paypal=return',
      cancelUrl: 'http://localhost:5173/session/ses_123?paypal=cancel',
      requestId: 'req-order-1',
    });
    expect(result.order.id).toBe('ORDER-1');
    expect(result.approveUrl).toContain('checkoutnow');
    const orderCall = calls.find((call) => call.url.endsWith('/v2/checkout/orders'))!;
    expect(orderCall.headers['PayPal-Request-Id']).toBe('req-order-1');
    const body = JSON.parse(orderCall.body!) as {
      intent: string;
      purchase_units: Array<{ amount: { currency_code: string; value: string } }>;
    };
    expect(body.intent).toBe('AUTHORIZE');
    expect(body.purchase_units[0]!.amount).toEqual({ currency_code: 'USD', value: '5.00' });
  });

  it('captures exactly the reviewed amount, never the cap', async () => {
    const { fetchImpl, calls } = mockFetch((recorded) => {
      if (recorded.url.endsWith('/v1/oauth2/token')) {
        return { body: { access_token: 'token', expires_in: 3600 } };
      }
      return { body: { id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '0.12' } } };
    });
    const client = new PayPalClient({
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
    });
    const capture = await client.captureAuthorization({
      authorizationId: 'AUTH-1',
      amountMinor: 12,
      currency: 'USD',
      requestId: 'req-capture-1',
      invoiceId: 'ses_123',
    });
    expect(capture.status).toBe('COMPLETED');
    const call = calls.find((entry) => entry.url.includes('/capture'))!;
    expect(call.headers.Prefer).toBe('return=representation');
    const body = JSON.parse(call.body!) as {
      amount: { value: string; currency_code: string };
      final_capture: boolean;
      invoice_id: string;
    };
    expect(body.amount).toEqual({ currency_code: 'USD', value: '0.12' });
    expect(body.final_capture).toBe(true);
    expect(body.invoice_id).toBe('ses_123');
  });

  it('rejects verification when no webhook id is configured', async () => {
    const client = new PayPalClient({
      baseUrl: 'https://api-m.sandbox.paypal.com',
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: fetch,
    });
    const result = await client.verifyWebhookSignature({ headers: {}, event: { id: 'WH-1' } });
    expect(result.verified).toBe(false);
    expect(result.status).toBe('WEBHOOK_ID_NOT_CONFIGURED');
  });

  it('reads approval links and authorization resources from provider payloads', () => {
    expect(findApprovalLink([{ rel: 'self', href: 'x' }, { rel: 'payer-action', href: 'y' }])).toBe('y');
    const authorization = extractAuthorization({
      id: 'ORDER',
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            authorizations: [{ id: 'AUTH', status: 'CREATED', amount: { currency_code: 'USD', value: '5.00' } }],
          },
        },
      ],
    });
    expect(authorization?.id).toBe('AUTH');
  });
});
