import { randomUUID } from 'node:crypto';
import { sha256Hex } from './hash.ts';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export const ids = {
  user: () => newId('usr'),
  object: () => newId('obj'),
  take: () => newId('tak'),
  model: () => newId('mdl'),
  terms: () => newId('trm'),
  session: () => newId('ses'),
  interval: () => newId('ivl'),
  pause: () => newId('pse'),
  dispute: () => newId('dsp'),
  audit: () => newId('aud'),
  operation: () => newId('pop'),
  resource: () => newId('prs'),
  webhook: () => newId('whe'),
  outbox: () => newId('out'),
  request: () => newId('req'),
};

/**
 * Stable idempotency key for one logical PayPal operation. Retries reuse it so
 * the provider returns the first result rather than executing twice.
 */
export function providerRequestId(parts: Array<string | number>): string {
  return `whirr_${sha256Hex(parts.join('|')).slice(0, 40)}`;
}
