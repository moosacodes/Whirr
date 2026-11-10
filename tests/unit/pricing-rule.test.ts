import { describe, expect, it } from 'vitest';
import { compilePricingRule } from '../../packages/meter/src/pricing-rule.ts';

describe('natural-language pricing compiler', () => {
  it('compiles only rate, cap and uncertain exclusion', () => {
    const result = compilePricingRule('Charge 0.20 per minute, cap at 5.00, and uncertain time is excluded.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.minorPerMinute).toBe(20);
    expect(result.capMinor).toBe(500);
    expect(result.currency).toBe('USD');
    expect(result.uncertainPolicy).toBe('EXCLUDE');
    expect(result.ownerApprovalRequired).toBe(true);
  });

  it('converts an exact hourly rate to a whole per-minute rate', () => {
    const result = compilePricingRule('Rate is 12.00 per hour, cap at 20.00, uncertain time is not billed.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.minorPerMinute).toBe(20);
    expect(result.capMinor).toBe(2_000);
  });

  it('rejects an hourly rate that cannot be represented exactly per minute', () => {
    const result = compilePricingRule('Rate is 10.00 per hour, cap at 20.00, uncertain time is excluded.');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('whole number');
  });

  it('rejects time-of-day and unsupported clauses', () => {
    const time = compilePricingRule('Charge 0.20 per minute, cap at 5.00, uncertain time is excluded, but half price at night.');
    expect(time.ok).toBe(false);
    if (time.ok) return;
    expect(time.reason).toContain('Time-of-day');

    const surge = compilePricingRule('Charge 0.20 per minute, cap at 5.00, uncertain time is excluded, plus a 10% surge.');
    expect(surge.ok).toBe(false);
  });

  it('requires a cap and an explicit uncertain clause', () => {
    expect(compilePricingRule('Charge 0.20 per minute, uncertain time is excluded.').ok).toBe(false);
    expect(compilePricingRule('Charge 0.20 per minute, cap at 5.00.').ok).toBe(false);
  });
});
