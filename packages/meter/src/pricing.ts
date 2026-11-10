import type { Currency } from './currency.ts';

export const ROUNDING_MODE = 'ROUND_ONCE_AT_END' as const;

export interface PricingPolicy {
  currency: Currency;
  minorPerMinute: number;
  capMinor: number;
  rounding: typeof ROUNDING_MODE;
  uncertainPolicy: 'EXCLUDE';
}

export interface QuoteBreakdown {
  billableMs: number;
  minorPerMinute: number;
  currency: Currency;
  /** rate * ms / 60000 before rounding. */
  rawMinor: number;
  /** Rounded once with half-up integer arithmetic. */
  roundedMinor: number;
  /** min(roundedMinor, capMinor) before credits. */
  cappedMinor: number;
  capApplied: boolean;
  creditMinor: number;
  /** Final amount actually chargeable, 0..capMinor. */
  finalMinor: number;
  formula: string;
}

const MAX_RATE_MINOR_PER_MINUTE = 100_000;
const MAX_CAP_MINOR = 10_000_000;
const MAX_BILLABLE_MS = 30 * 24 * 60 * 60 * 1000;

function assertRate(rate: number): void {
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > MAX_RATE_MINOR_PER_MINUTE) {
    throw new RangeError(`minorPerMinute must be an integer in 0..${MAX_RATE_MINOR_PER_MINUTE}`);
  }
}

function assertCap(cap: number): void {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_CAP_MINOR) {
    throw new RangeError(`capMinor must be an integer in 0..${MAX_CAP_MINOR}`);
  }
}

/**
 * Half-up rounding of rateMinorPerMinute * durationMs / 60000 using integers.
 * Rounds exactly once at session end, as stated in the terms.
 */
export function roundOnceMinor(minorPerMinute: number, billableMs: number): number {
  assertRate(minorPerMinute);
  if (!Number.isSafeInteger(billableMs) || billableMs < 0 || billableMs > MAX_BILLABLE_MS) {
    throw new RangeError('billableMs must be a valid non-negative duration in milliseconds');
  }
  const numerator = minorPerMinute * billableMs;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('Billable amount exceeds safe integer range');
  return Math.floor((numerator + 30_000) / 60_000);
}

export function quoteBreakdown(
  minorPerMinute: number,
  billableMs: number,
  capMinor: number,
  creditMinor = 0,
  currency: Currency = 'USD',
): QuoteBreakdown {
  assertRate(minorPerMinute);
  assertCap(capMinor);
  if (!Number.isSafeInteger(creditMinor) || creditMinor < 0) {
    throw new RangeError('creditMinor must be a non-negative integer');
  }
  const roundedMinor = roundOnceMinor(minorPerMinute, billableMs);
  const cappedMinor = Math.min(capMinor, roundedMinor);
  const credit = Math.min(creditMinor, cappedMinor);
  const finalMinor = Math.max(0, cappedMinor - credit);
  return {
    billableMs,
    minorPerMinute,
    currency,
    rawMinor: (minorPerMinute * billableMs) / 60_000,
    roundedMinor,
    cappedMinor,
    capApplied: roundedMinor > capMinor,
    creditMinor: credit,
    finalMinor,
    formula: `round_half_up(${minorPerMinute} × ${billableMs} / 60000) = ${roundedMinor} minor; min(cap ${capMinor}) = ${cappedMinor}; minus credit ${credit} = ${finalMinor}`,
  };
}

/** Final chargeable amount only. Zero billable time always yields zero. */
export function quoteMinor(
  minorPerMinute: number,
  billableMs: number,
  capMinor: number,
  creditMinor = 0,
  currency: Currency = 'USD',
): number {
  return quoteBreakdown(minorPerMinute, billableMs, capMinor, creditMinor, currency).finalMinor;
}

const PAYPAL_LIMITS: Partial<Record<Currency, { max: number; min: number }>> = {
  USD: { max: 999_999_99, min: 1 },
  EUR: { max: 999_999_99, min: 1 },
  GBP: { max: 999_999_99, min: 1 },
  JPY: { max: 99_999_999, min: 1 },
};

export function withinPayPalLimits(minor: number, currency: Currency): boolean {
  const limit = PAYPAL_LIMITS[currency];
  if (!limit) return Number.isSafeInteger(minor) && minor > 0;
  return Number.isSafeInteger(minor) && minor >= limit.min && minor <= limit.max;
}

export const PRICING_LIMITS = {
  MAX_RATE_MINOR_PER_MINUTE,
  MAX_CAP_MINOR,
  MAX_BILLABLE_MS,
};
