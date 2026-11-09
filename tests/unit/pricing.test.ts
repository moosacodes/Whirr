import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  decimalStringToMinor,
  minorToDecimalString,
} from '../../packages/meter/src/currency.ts';
import { quoteBreakdown, roundOnceMinor } from '../../packages/meter/src/pricing.ts';

describe('pricing arithmetic', () => {
  it('rounds once, half-up, with integer arithmetic', () => {
    expect(roundOnceMinor(20, 35_000)).toBe(12);
    expect(roundOnceMinor(20, 60_000)).toBe(20);
    expect(roundOnceMinor(1, 29_999)).toBe(0);
    expect(roundOnceMinor(1, 30_000)).toBe(1);
    expect(roundOnceMinor(0, 60_000)).toBe(0);
  });

  it('caps the rounded amount before applying credits', () => {
    const quote = quoteBreakdown(20, 3_600_000, 500);
    expect(quote.roundedMinor).toBe(1200);
    expect(quote.cappedMinor).toBe(500);
    expect(quote.finalMinor).toBe(500);
    expect(quote.capApplied).toBe(true);
  });

  it('never lets a credit increase the amount or go below zero', () => {
    const quote = quoteBreakdown(20, 60_000, 500, 999);
    expect(quote.finalMinor).toBe(0);
    expect(quote.creditMinor).toBe(20);
  });

  it('parses decimals exactly instead of through floats', () => {
    expect(decimalStringToMinor('0.10', 'USD')).toBe(10);
    expect(decimalStringToMinor('0.1', 'USD')).toBe(10);
    expect(decimalStringToMinor('1.005', 'USD')).toBeNull();
    expect(decimalStringToMinor('01.00', 'USD')).toBeNull();
    expect(decimalStringToMinor('100', 'JPY')).toBe(100);
    expect(decimalStringToMinor('100.5', 'JPY')).toBeNull();
    expect(minorToDecimalString(1234, 'USD')).toBe('12.34');
    expect(minorToDecimalString(1234, 'JPY')).toBe('1234');
  });

  it('property: final amount is always within 0..cap and zero time is free', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 86_400_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (rate, cap, ms, credit) => {
          const quote = quoteBreakdown(rate, ms, cap, credit);
          expect(quote.finalMinor).toBeGreaterThanOrEqual(0);
          expect(quote.finalMinor).toBeLessThanOrEqual(cap);
          expect(quote.finalMinor).toBeLessThanOrEqual(quote.cappedMinor);
          if (ms === 0) expect(quote.finalMinor).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
