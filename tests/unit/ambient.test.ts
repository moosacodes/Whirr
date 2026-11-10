import { describe, expect, it } from 'vitest';
import {
  compileAmbientAgreement,
  evaluateAmbientAgreement,
  hashAmbientTerms,
  type AmbientAgreementTerms,
  type AmbientObservation,
  type AmbientOutcome,
  type SourceState,
} from '../../packages/ambient-engine/src/index.ts';

const NOW = '2026-11-10T12:00:00.000Z';
const LATER = '2026-11-10T12:10:00.000Z';
const MODEL = {
  id: 'evm_ambient_unit',
  version: 'ambient-unit-v1',
  hash: 'a'.repeat(64),
  status: 'READY' as const,
  datasetHash: 'b'.repeat(64),
  provenance: 'SYNTHETIC_REFERENCE' as const,
};
const TARGET = { objectId: 'obj_reference_fan', objectName: 'Reference desk fan', glyph: 'fan' };

function compiled(text = 'I need 30 seconds without the Reference desk fan running. I will offer $2.', durationSeconds = 30) {
  const result = compileAmbientAgreement({
    agreementId: 'amb_unit',
    revision: 1,
    text,
    buyerRef: 'rnr_buyer',
    providerRef: 'op_provider',
    target: TARGET,
    eventModel: MODEL,
    currency: 'USD',
    fixedPriceMinor: 200,
    durationSeconds,
    now: NOW,
  });
  return result;
}

function smallTerms(): AmbientAgreementTerms {
  const base = compiled().terms;
  return {
    ...base,
    condition: {
      ...base.condition,
      requiredBaselineActiveMs: 2_000,
      requiredInactiveMs: 3_000,
    },
  };
}

function obs(seq: number, startMs: number, endMs: number, sourceState: SourceState): AmbientObservation {
  return {
    seq,
    startMs,
    endMs,
    sourceState,
    confidence: sourceState === 'UNKNOWN' ? 0.2 : 0.95,
    qualityFlags: sourceState === 'DISCONNECTED' ? ['SENSOR_DISCONNECTED'] : [],
  };
}

function sequence(states: SourceState[]): AmbientObservation[] {
  return states.map((state, index) => obs(index + 1, index * 1_000, (index + 1) * 1_000, state));
}

async function evaluate(observations: AmbientObservation[], terms = smallTerms(), now = LATER) {
  const hash = hashAmbientTerms(terms);
  return evaluateAmbientAgreement({
    terms,
    agreementHash: hash,
    observations,
    currentModelHash: terms.eventModel.hash,
    now,
  });
}

/** Deliberately separate second-by-second oracle for simple, gap-free sequences. */
function oracle(states: SourceState[], baselineMs = 2_000, targetMs = 3_000): AmbientOutcome {
  let baseline = 0;
  let run = 0;
  let qualified = false;
  let interrupted = false;
  let uncertain = false;
  let sensorLoss = false;
  for (const state of states) {
    if (state === 'DISCONNECTED') {
      if (!qualified) sensorLoss = true;
      continue;
    }
    if (state === 'UNKNOWN') {
      if (!qualified) {
        run = 0;
        uncertain = true;
      }
      continue;
    }
    if (state === 'ACTIVE') {
      baseline += 1_000;
      if (!qualified) {
        if (run > 0) interrupted = true;
        run = 0;
      }
      continue;
    }
    if (baseline >= baselineMs) {
      run += 1_000;
      if (run >= targetMs) qualified = true;
    }
  }
  if (qualified) return 'QUALIFIED';
  if (sensorLoss) return 'SENSOR_LOSS';
  if (baseline < baselineMs) return 'NO_BASELINE';
  if (interrupted) return 'INTERRUPTED';
  if (uncertain) return 'INSUFFICIENT_EVIDENCE';
  return 'INSUFFICIENT_EVIDENCE';
}

describe('Ambient intent compiler', () => {
  it('narrows a natural-language wish into one observable condition and an explicit proxy disclosure', () => {
    const result = compiled(
      'I need complete silence for 30 seconds without the Reference desk fan running. I will offer $2.',
    );
    expect(result.executable).toBe(true);
    expect(result.terms.condition.requiredInactiveMs).toBe(30_000);
    expect(result.terms.condition.requiredBaselineActiveMs).toBe(3_000);
    expect(result.terms.financial.fixedPriceMinor).toBe(200);
    expect(result.terms.financial.maximumChargeMinor).toBe(200);
    expect(result.terms.policies.automaticCapture).toBe(false);
    expect(result.terms.policies.humanAcceptance).toBe('BUYER_REQUIRED');
    expect(result.interpretation.observableCondition).toMatch(/must not detect it/i);
    expect(result.interpretation.proxyDisclosure).toMatch(/does not prove silence/i);
    expect(result.issues.some((issue) => issue.code === 'NARROWED_INTERPRETATION')).toBe(true);
  });

  it('refuses unsupported physical claims instead of silently broadening the microphone claim', () => {
    const result = compiled('Stop the machine to cut electricity consumption by 50 percent. I will pay $2.');
    expect(result.executable).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'UNSUPPORTED_PHYSICAL_CLAIM')).toBe(true);
  });

  it('changes the agreement digest when a negotiated term changes', () => {
    const first = compiled();
    const changed = {
      ...first.terms,
      revision: 2,
      financial: { ...first.terms.financial, fixedPriceMinor: 350, maximumChargeMinor: 350 },
    };
    expect(hashAmbientTerms(changed)).not.toBe(first.hash);
  });
});

describe('Ambient negative-space evaluator', () => {
  it('qualifies only after an active baseline and a continuous inactive window', async () => {
    const result = await evaluate(
      sequence(['INACTIVE', 'ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE']),
    );
    expect(result.outcome).toBe('QUALIFIED');
    expect(result.eligibleForCapture).toBe(true);
    expect(result.baselineActiveMs).toBe(2_000);
    expect(result.inactiveMs).toBe(5_000);
    expect(result.qualifyingStartMs).toBe(3_000);
    expect(result.qualifyingEndMs).toBe(6_000);
  });

  it('does not treat a missing signal without an active baseline as a quiet window', async () => {
    const result = await evaluate(sequence(['INACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE']));
    expect(result.outcome).toBe('NO_BASELINE');
    expect(result.eligibleForCapture).toBe(false);
    expect(result.baselineActiveMs).toBe(0);
  });

  it('resets the window when the source resumes half way through', async () => {
    const result = await evaluate(
      sequence(['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE']),
    );
    expect(result.outcome).toBe('INTERRUPTED');
    expect(result.eligibleForCapture).toBe(false);
    expect(result.interruptions).toBe(1);
    expect(result.longestInactiveMs).toBe(2_000);
  });

  it('treats sensor loss as unobservable, never as a successful quiet window', async () => {
    const result = await evaluate(
      sequence(['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'DISCONNECTED', 'INACTIVE', 'INACTIVE']),
    );
    expect(result.outcome).toBe('SENSOR_LOSS');
    expect(result.eligibleForCapture).toBe(false);
    expect(result.sensorLossMs).toBe(1_000);
  });

  it('resets on uncertainty and does not bridge an evidence gap', async () => {
    const uncertain = await evaluate(
      sequence(['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'UNKNOWN', 'INACTIVE', 'INACTIVE']),
    );
    expect(uncertain.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(uncertain.eligibleForCapture).toBe(false);

    const gap = await evaluate([
      obs(1, 0, 1_000, 'ACTIVE'),
      obs(2, 1_000, 2_000, 'ACTIVE'),
      obs(3, 2_000, 3_000, 'INACTIVE'),
      obs(4, 6_000, 9_000, 'INACTIVE'),
    ]);
    expect(gap.eligibleForCapture).toBe(false);
    expect(gap.checks.find((entry) => entry.id === 'evidence_continuity')?.status).toBe('FAIL');
  });

  it('rejects a substituted model and an expired agreement', async () => {
    const terms = smallTerms();
    const substituted = await evaluateAmbientAgreement({
      terms,
      agreementHash: hashAmbientTerms(terms),
      observations: sequence(['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE']),
      currentModelHash: 'f'.repeat(64),
      now: LATER,
    });
    expect(substituted.outcome).toBe('REJECTED');
    expect(substituted.eligibleForCapture).toBe(false);

    const expired = await evaluate(
      sequence(['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE']),
      terms,
      '2026-11-10T14:00:00.000Z',
    );
    expect(expired.outcome).toBe('EXPIRED');
    expect(expired.eligibleForCapture).toBe(false);
  });

  it('is deterministic for the same agreement and evidence', async () => {
    const states: SourceState[] = ['ACTIVE', 'ACTIVE', 'INACTIVE', 'INACTIVE', 'INACTIVE'];
    const first = await evaluate(sequence(states));
    const second = await evaluate(sequence(states));
    expect(second).toEqual(first);
  });

  it('agrees with an independent second-by-second oracle on small sequences', async () => {
    const states: SourceState[] = ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'DISCONNECTED'];
    for (let index = 0; index < 64; index += 1) {
      let seed = index + 1;
      const generated: SourceState[] = [];
      for (let step = 0; step < 6; step += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        generated.push(states[seed % states.length]!);
      }
      const result = await evaluate(sequence(generated));
      expect(`${generated.join(',')} -> ${result.outcome}`).toBe(
        `${generated.join(',')} -> ${oracle(generated)}`,
      );
    }
  });
});
