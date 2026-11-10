import { decimalStringToMinor, type Currency } from './currency.ts';

/**
 * A deliberately tiny, deterministic pricing-rule compiler.
 *
 * It accepts only the semantics Whirr already publishes: a per-minute rate, a
 * hard cap, a single rounding point and exclusion of uncertain time. Anything
 * else is rejected rather than guessed. The result is a preview; publication
 * still happens through the existing owner-approved pricing endpoint.
 */
export interface CompiledPricingRule {
  ok: true;
  currency: Currency;
  minorPerMinute: number;
  capMinor: number;
  rounding: 'ROUND_ONCE_AT_END';
  uncertainPolicy: 'EXCLUDE';
  feesPolicy: 'NO_ADDITIONAL_FEES';
  sourceText: string;
  normalized: string;
  assumptions: string[];
  ownerApprovalRequired: true;
}

export interface RejectedPricingRule {
  ok: false;
  reason: string;
  unsupported: string[];
}

export type PricingRuleResult = CompiledPricingRule | RejectedPricingRule;

const CURRENCY_WORDS: Record<string, Currency> = {
  dollar: 'USD',
  dollars: 'USD',
  usd: 'USD',
  euro: 'EUR',
  euros: 'EUR',
  eur: 'EUR',
  pound: 'GBP',
  pounds: 'GBP',
  gbp: 'GBP',
  cad: 'CAD',
  aud: 'AUD',
};

function parseRate(text: string): { amount: string; unit: 'minute' | 'hour' } | null {
  const match = text.match(
    /\b(?:rate|price|charge)\s*(?:is|of|at|:)?\s*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:per|\/|an?)\s*(minute|min|hour|hr)\b/i,
  );
  if (!match) return null;
  return { amount: match[1]!, unit: match[2]!.toLowerCase().startsWith('h') ? 'hour' : 'minute' };
}

function parseCap(text: string): string | null {
  const match = text.match(/\bcap\s*(?:is|of|at|:)?\s*([0-9]+(?:\.[0-9]{1,3})?)\b/i);
  return match?.[1] ?? null;
}

function hasUncertainExclusion(text: string): boolean {
  return /\b(?:uncertain|ambiguous)\s+(?:time\s+)?(?:is\s+|are\s+)?(?:excluded|not\s+billed|free)\b/i.test(text);
}

function unsupportedClauses(text: string): string[] {
  const stripped = text
    .replace(/\b(?:rate|price|charge)\s*(?:is|of|at|:)?\s*[0-9]+(?:\.[0-9]{1,3})?\s*(?:per|\/|an?)\s*(?:minute|min|hour|hr)\b/gi, ' ')
    .replace(/\bcap\s*(?:is|of|at|:)?\s*[0-9]+(?:\.[0-9]{1,3})?\b/gi, ' ')
    .replace(/\b(?:uncertain|ambiguous)\s+(?:time\s+)?(?:is\s+|are\s+)?(?:excluded|not\s+billed|free)\b/gi, ' ')
    .replace(/\b(?:usd|eur|gbp|cad|aud|dollars?|euros?|pounds?)\b/gi, ' ')
    .replace(/[\s,.;:+/()-]|and|with|plus|the|a|an/gi, ' ')
    .trim();
  return stripped ? [stripped] : [];
}

export function compilePricingRule(input: string, defaultCurrency: Currency = 'USD'): PricingRuleResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: 'Enter a pricing rule.', unsupported: [] };
  if (/\b(?:peak|off-peak|night|weekend|holiday|between|after|before)\b/i.test(text)) {
    return {
      ok: false,
      reason: 'Time-of-day or calendar pricing is not part of the published terms schema, so this rule was not compiled.',
      unsupported: ['time-window pricing'],
    };
  }

  const rate = parseRate(text);
  if (!rate) {
    return {
      ok: false,
      reason: 'Say the rate explicitly, for example “charge 0.20 per minute” or “2.40 per hour”.',
      unsupported: [],
    };
  }
  const cap = parseCap(text);
  if (!cap) {
    return {
      ok: false,
      reason: 'A hard cap is required, for example “cap at 5.00”.',
      unsupported: [],
    };
  }
  if (!hasUncertainExclusion(text)) {
    return {
      ok: false,
      reason: 'Say explicitly that uncertain or ambiguous time is excluded or not billed.',
      unsupported: [],
    };
  }

  const currencyMatch = text.match(/\b(usd|eur|gbp|cad|aud|dollars?|euros?|pounds?)\b/i);
  const currency = currencyMatch ? CURRENCY_WORDS[currencyMatch[1]!.toLowerCase()] ?? defaultCurrency : defaultCurrency;

  const parsed = decimalStringToMinor(rate.amount, currency);
  if (parsed === null || parsed < 1) {
    return { ok: false, reason: 'The rate is not a valid positive amount for this currency.', unsupported: [] };
  }
  let minorPerMinute = parsed;
  if (rate.unit === 'hour') {
    if (parsed % 60 !== 0) {
      return {
        ok: false,
        reason: 'An hourly rate must convert to a whole number of minor units per minute. Use a per-minute rate instead.',
        unsupported: [],
      };
    }
    minorPerMinute = parsed / 60;
  }

  const capMinor = decimalStringToMinor(cap, currency);
  if (capMinor === null || capMinor < 1) {
    return { ok: false, reason: 'The cap is not a valid positive amount for this currency.', unsupported: [] };
  }
  if (capMinor < minorPerMinute) {
    return { ok: false, reason: 'The hard cap must be at least the price of one billable minute.', unsupported: [] };
  }

  const unsupported = unsupportedClauses(text);
  if (unsupported.length) {
    return {
      ok: false,
      reason: `This prototype only compiles rate, cap and uncertain-time exclusion. Unsupported wording: ${unsupported.join(' ')}`,
      unsupported,
    };
  }

  return {
    ok: true,
    currency,
    minorPerMinute,
    capMinor,
    rounding: 'ROUND_ONCE_AT_END',
    uncertainPolicy: 'EXCLUDE',
    feesPolicy: 'NO_ADDITIONAL_FEES',
    sourceText: text,
    normalized: `${minorPerMinute} minor units per billable minute; cap ${capMinor} ${currency}; uncertain time excluded; round once at end.`,
    assumptions: [
      'Only the existing Whirr terms semantics were compiled.',
      'The owner must review and publish the values through the existing pricing page.',
      'No rule is published or applied to a session by this compiler.',
    ],
    ownerApprovalRequired: true,
  };
}
