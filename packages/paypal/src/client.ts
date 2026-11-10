import { minorToDecimalString, type Currency } from '../../meter/src/currency.ts';

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export interface PayPalConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  intent?: string;
  purchase_units?: Array<{
    reference_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: {
      authorizations?: Array<{
        id: string;
        status: string;
        amount: { currency_code: string; value: string };
        create_time?: string;
        expiration_time?: string;
      }>;
      captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }>;
    };
  }>;
  payment_source?: unknown;
  links?: PayPalLink[];
  [key: string]: unknown;
}

export interface PayPalAuthorization {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  expiration_time?: string;
  create_time?: string;
  seller_protection?: unknown;
  [key: string]: unknown;
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  final_capture?: boolean;
  create_time?: string;
  update_time?: string;
  seller_protection?: unknown;
  [key: string]: unknown;
}

export interface PayPalRefund {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  [key: string]: unknown;
}

export class PayPalApiError extends Error {
  readonly status: number;
  readonly issue: string | null;
  readonly debugId: string | null;
  readonly details: unknown;

  constructor(message: string, opts: { status: number; issue?: string | null; debugId?: string | null; details?: unknown }) {
    super(message);
    this.name = 'PayPalApiError';
    this.status = opts.status;
    this.issue = opts.issue ?? null;
    this.debugId = opts.debugId ?? null;
    this.details = opts.details ?? null;
  }
}

function assertSandboxUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('PAYPAL_BASE_URL is not a valid URL');
  }
  const isSandbox = url.hostname === 'api-m.sandbox.paypal.com';
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (!isSandbox && !isLoopback) {
    throw new Error('Whirr only permits PayPal Sandbox. Refusing a non-sandbox PayPal base URL.');
  }
  if (!isLoopback && url.protocol !== 'https:') {
    throw new Error('PayPal base URL must use HTTPS');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PayPal base URL must not contain credentials, a path, query or fragment');
  }
}

const MAX_RESPONSE_BYTES = 512_000;

export class PayPalClient {
  readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  readonly webhookId: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: PayPalConfig) {
    assertSandboxUrl(config.baseUrl);
    if (!config.clientId || !config.clientSecret) {
      throw new Error('PayPal client credentials are not configured');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookId = config.webhookId ?? null;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; requestId?: string; prefer?: string; token?: string } = { method: 'GET' },
  ): Promise<T> {
    const token = init.token ?? (await this.accessToken());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (init.requestId) headers['PayPal-Request-Id'] = init.requestId;
    if (init.prefer) headers.Prefer = init.prefer;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await response.text();
      const limited = text.length > MAX_RESPONSE_BYTES ? text.slice(0, MAX_RESPONSE_BYTES) : text;
      let parsed: unknown = null;
      if (limited) {
        try {
          parsed = JSON.parse(limited);
        } catch {
          parsed = { raw: limited };
        }
      }
      if (!response.ok) {
        const details = parsed as
          | { name?: string; message?: string; debug_id?: string; details?: Array<{ issue?: string }> }
          | null;
        const issue = details?.details?.[0]?.issue ?? details?.name ?? null;
        throw new PayPalApiError(details?.message || `PayPal request failed (${response.status})`, {
          status: response.status,
          issue,
          debugId: details?.debug_id ?? null,
          details: parsed,
        });
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof PayPalApiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new PayPalApiError('PayPal request timed out', { status: 504 });
      }
      throw new PayPalApiError(`PayPal network error: ${(error as Error).message}`, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) return this.token.value;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const response = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: { access_token?: string; expires_in?: number; error_description?: string } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
      if (!response.ok || !parsed.access_token) {
        throw new PayPalApiError(parsed.error_description || 'PayPal OAuth failed', {
          status: response.status,
        });
      }
      const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 300;
      this.token = { value: parsed.access_token, expiresAt: now + expiresIn * 1000 };
      return parsed.access_token;
    } catch (error) {
      if (error instanceof PayPalApiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new PayPalApiError('PayPal request timed out', { status: 504 });
      }
      throw new PayPalApiError(`PayPal network error: ${(error as Error).message}`, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async createOrder(input: {
    capMinor: number;
    currency: Currency;
    sessionId: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    requestId: string;
  }): Promise<{ order: PayPalOrder; approveUrl: string | null }> {
    const body = {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: input.sessionId,
          custom_id: input.sessionId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: minorToDecimalString(input.capMinor, input.currency),
          },
        },
      ],
      application_context: {
        brand_name: 'Whirr',
        locale: 'en-US',
        landing_page: 'NO_PREFERENCE',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    };
    const order = await this.request<PayPalOrder>('/v2/checkout/orders', {
      method: 'POST',
      body,
      requestId: input.requestId,
    });
    const approveUrl = findApprovalLink(order.links ?? []);
    return { order, approveUrl: approveUrl && isSafeSandboxApprovalUrl(approveUrl) ? approveUrl : null };
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
    });
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
      method: 'POST',
      body: {},
      requestId,
    });
  }

  async getAuthorization(authorizationId: string): Promise<PayPalAuthorization> {
    return this.request<PayPalAuthorization>(
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
      { method: 'GET' },
    );
  }

  async captureAuthorization(input: {
    authorizationId: string;
    amountMinor: number;
    currency: Currency;
    requestId: string;
    invoiceId: string;
    noteToPayer?: string;
  }): Promise<PayPalCapture> {
    return this.request<PayPalCapture>(
      `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
      {
        method: 'POST',
        requestId: input.requestId,
        prefer: 'return=representation',
        body: {
          amount: {
            currency_code: input.currency,
            value: minorToDecimalString(input.amountMinor, input.currency),
          },
          invoice_id: input.invoiceId.slice(0, 127),
          final_capture: true,
          note_to_payer: (input.noteToPayer ?? 'Whirr metered session').slice(0, 255),
        },
      },
    );
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<PayPalAuthorization> {
    return this.request<PayPalAuthorization>(
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
      { method: 'POST', body: {}, requestId },
    );
  }

  async getCapture(captureId: string): Promise<PayPalCapture> {
    return this.request<PayPalCapture>(`/v2/payments/captures/${encodeURIComponent(captureId)}`, {
      method: 'GET',
    });
  }

  async getRefund(refundId: string): Promise<PayPalRefund> {
    return this.request<PayPalRefund>(`/v2/payments/refunds/${encodeURIComponent(refundId)}`, {
      method: 'GET',
    });
  }

  async refundCapture(input: {
    captureId: string;
    amountMinor?: number;
    currency: Currency;
    requestId: string;
  }): Promise<PayPalRefund> {
    const body: Record<string, unknown> = {};
    if (input.amountMinor !== undefined) {
      body.amount = {
        currency_code: input.currency,
        value: minorToDecimalString(input.amountMinor, input.currency),
      };
    }
    return this.request<PayPalRefund>(`/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`, {
      method: 'POST',
      body,
      requestId: input.requestId,
    });
  }

  async verifyWebhookSignature(input: {
    headers: Record<string, string | string[] | undefined>;
    event: unknown;
  }): Promise<{ verified: boolean; status: string; raw: unknown }> {
    if (!this.webhookId) {
      return { verified: false, status: 'WEBHOOK_ID_NOT_CONFIGURED', raw: null };
    }
    const read = (name: string): string | null => {
      const value = input.headers[name];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    };
    const authAlgo = read('paypal-auth-algo');
    const certUrl = read('paypal-cert-url');
    const transmissionId = read('paypal-transmission-id');
    const transmissionSig = read('paypal-transmission-sig');
    const transmissionTime = read('paypal-transmission-time');
    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      return { verified: false, status: 'MISSING_TRANSMISSION_HEADERS', raw: null };
    }
    if (authAlgo !== 'SHA256withRSA') {
      return { verified: false, status: 'UNSUPPORTED_AUTH_ALGO', raw: null };
    }
    if (!isSafeWebhookCertUrl(certUrl)) {
      return { verified: false, status: 'INVALID_CERT_URL', raw: null };
    }
    try {
      const response = await this.request<{ verification_status?: string }>(
        '/v1/notifications/verify-webhook-signature',
        {
          method: 'POST',
          body: {
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: this.webhookId,
            webhook_event: input.event,
          },
        },
      );
      const status = response.verification_status ?? 'UNKNOWN';
      return { verified: status === 'SUCCESS', status, raw: response };
    } catch (error) {
      return {
        verified: false,
        status: `VERIFY_REQUEST_FAILED: ${(error as Error).message}`,
        raw: null,
      };
    }
  }
}

export function findApprovalLink(links: PayPalLink[]): string | null {
  const approval = links.find((link) => link.rel === 'approve' || link.rel === 'payer-action');
  return approval?.href ?? null;
}

/** Only allow browser navigation to an HTTPS PayPal Sandbox approval page. */
export function isSafeSandboxApprovalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com'))
    );
  } catch {
    return false;
  }
}

/** PayPal must only be asked to verify against a Sandbox certificate URL. */
export function isSafeWebhookCertUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com'))
    );
  } catch {
    return false;
  }
}

export function extractAuthorization(order: PayPalOrder): {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  create_time?: string;
  expiration_time?: string;
} | null {
  for (const unit of order.purchase_units ?? []) {
    const authorization = unit.payments?.authorizations?.[0];
    if (authorization) return authorization;
  }
  return null;
}

export function extractCaptureFromOrder(order: PayPalOrder): {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
} | null {
  for (const unit of order.purchase_units ?? []) {
    const capture = unit.payments?.captures?.[0];
    if (capture) return capture;
  }
  return null;
}
