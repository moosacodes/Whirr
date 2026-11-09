/**
 * Currency helpers. All money is stored as integer minor units. Decimal
 * strings are produced with integer arithmetic only, never floating point.
 */

export const CURRENCY_MINOR_DIGITS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  SGD: 2,
  HKD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  ILS: 2,
  MXN: 2,
  BRL: 2,
  PHP: 2,
  THB: 2,
  MYR: 2,
  JPY: 0,
  TWD: 0,
  HUF: 0,
} as const;

export type Currency = keyof typeof CURRENCY_MINOR_DIGITS;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_MINOR_DIGITS) as Currency[];

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_DIGITS, value);
}

export function minorDigits(currency: Currency): number {
  return CURRENCY_MINOR_DIGITS[currency];
}

export function isSafeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Exact decimal string for a PayPal amount, e.g. 1234 USD -> "12.34". */
export function minorToDecimalString(minor: number, currency: Currency): string {
  if (!isSafeMinor(minor)) throw new Error('Minor units must be a non-negative safe integer');
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const factor = 10 ** digits;
  const whole = Math.floor(minor / factor);
  const fraction = minor % factor;
  return `${whole}.${String(fraction).padStart(digits, '0')}`;
}

/** Strict decimal parsing with exact minor units; returns null when invalid. */
export function decimalStringToMinor(value: string, currency: Currency): number | null {
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^(0|[1-9]\d*)$/ : new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${digits}}))?$`);
  const match = pattern.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) return null;
  const fractionRaw = match[2] ?? '';
  const fraction = Number(fractionRaw.padEnd(digits, '0')) || 0;
  const factor = 10 ** digits;
  const minor = whole * factor + fraction;
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  return minor;
}

export function formatMinor(minor: number, currency: Currency, locale = 'en-US'): string {
  if (!isSafeMinor(minor)) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
      Number(minorToDecimalString(minor, currency)),
    );
  } catch {
    return `${minorToDecimalString(minor, currency)} ${currency}`;
  }
}
