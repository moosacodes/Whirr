import { formatMinor, type Currency } from '../../../../packages/meter/src/currency.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
import type { PaymentState, SessionState } from '../../../../packages/contracts/src/types.ts';

export function money(minor: number, currency: Currency = 'USD'): string {
  return formatMinor(minor, currency);
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function percent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const METER_COPY: Record<MeterState, { label: string; detail: string; billed: boolean }> = {
  ACTIVE_CONFIDENT: {
    label: 'Running',
    detail: 'Confident machine activity — billable.',
    billed: true,
  },
  IDLE: {
    label: 'Idle',
    detail: 'Object is quiet — not billable.',
    billed: false,
  },
  UNCERTAIN: {
    label: 'Uncertain',
    detail: 'Ambiguous or poor-quality audio — never billed.',
    billed: false,
  },
  DISCONNECTED: {
    label: 'Sensing stopped',
    detail: 'No sensor evidence — not billable.',
    billed: false,
  },
};

export const SESSION_STATE_COPY: Record<SessionState, string> = {
  CREATED: 'Terms created',
  CONSENTED: 'Terms accepted',
  PAYMENT_PENDING: 'Awaiting PayPal approval',
  READY: 'Ready to sense',
  ACTIVE: 'Session live',
  PAUSED: 'Sensing paused',
  STOPPED: 'Usage stopped',
  REVIEWED: 'Bill reviewed',
  SETTLEMENT_PENDING: 'PayPal settlement pending',
  SETTLED: 'Settled in Sandbox',
  NO_CHARGE: 'No charge',
  DEMO_COMPLETED: 'Demo completed — unpaid',
  FAILED: 'Settlement failed',
  ABANDONED: 'Abandoned',
};

export const PAYMENT_STATE_COPY: Record<PaymentState, string> = {
  NONE: 'No payment yet',
  ORDER_CREATED: 'PayPal order created',
  BUYER_APPROVED: 'Buyer approved in PayPal',
  AUTHORIZED: 'Authorized in PayPal',
  CAPTURE_REQUESTED: 'Capture requested',
  CAPTURE_PENDING: 'Capture pending at PayPal',
  CAPTURE_COMPLETED: 'Captured by PayPal',
  CAPTURE_DENIED: 'Capture denied',
  VOID_REQUESTED: 'Void requested',
  VOIDED: 'Authorization voided',
  REFUND_REQUESTED: 'Refund requested',
  REFUNDED: 'Refunded',
  DEMO_MODE: 'Demo metering — no payment',
  UNRESOLVED: 'Payment unresolved',
};

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
