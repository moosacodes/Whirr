import { describe, expect, it } from 'vitest';
import {
  compilePhysicalAgreement,
  evaluatePromise,
  hashAgreementTerms,
  type PromiseObservation,
} from '../../packages/promise/src/index.ts';
import { trainEventModel, type EventDemonstration } from '../../packages/audio/src/event-model.ts';
import { generateReferenceData } from '../../scripts/generate-fixtures.ts';
import { FEATURE_SPEC_VERSION } from '../../packages/audio/src/spec.ts';
import { canonicalJson, sha256HexSync } from '../../packages/protocol/src/index.ts';

const NOW = '2026-11-10T12:00:00.000Z';

function referenceModel() {
  const data = generateReferenceData();
  const takes: EventDemonstration[] = [];
  for (const label of ['idle', 'active', 'negative'] as const) {
    data.takes
      .filter((take) => take.label === label)
      .slice(0, label === 'negative' ? 6 : 5)
      .forEach((take, index) => {
        takes.push({
          id: `unit-${label}-${index}`,
          objectId: 'obj_reference_fan',
          label,
          frames: take.frames,
          frameFlags: take.frameFlags,
          durationMs: take.durationMs ?? Math.round(take.frames.length * 32),
          featureSpecVersion: FEATURE_SPEC_VERSION,
          source: 'synthetic',
          provenance: 'SYNTHETIC_REFERENCE',
          sessionGroup: `unit-${label}-${index % 2}`,
          createdAt: NOW,
        });
      });
  }
  const trained = trainEventModel({
    takes,
    version: 'unit-reference',
    createdAt: NOW,
    featureSpecVersion: FEATURE_SPEC_VERSION,
    provenance: 'SYNTHETIC_REFERENCE',
  });
  return { trained, takes, data };
}

const { trained } = referenceModel();
const modelHash = sha256HexSync(canonicalJson(trained.artifact));

function agreement() {
  const result = compilePhysicalAgreement({
    text:
      'Charge $2 for one complete cycle. The machine must run for at least 15 seconds and return to idle. Do not charge if it stops early or the microphone disconnects.',
    serviceName: 'One qualified fan cycle',
    objectId: 'obj_reference_fan',
    objectName: 'Reference desk fan',
    currency: 'USD',
    eventModel: {
      id: 'evm_unit',
      version: trained.artifact.version,
      hash: modelHash,
      status: 'READY',
      datasetHash: trained.artifact.training.datasetHash,
      provenance: 'SYNTHETIC_REFERENCE',
    },
    now: NOW,
    expiresInMinutes: 60,
  });
  if (!result.executable) throw new Error(result.issues.map((issue) => issue.message).join(' '));
  return result;
}

function qualifiedObservations(): PromiseObservation[] {
  return [
    { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
    { seq: 2, startMs: 5_000, endMs: 22_000, state: 'ACTIVE_CONFIDENT', confidence: 0.96, qualityFlags: [], eventMatch: 0.9 },
    { seq: 3, startMs: 22_000, endMs: 27_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
  ];
}

async function evaluate(observations: PromiseObservation[], now = '2026-11-10T12:10:00.000Z', extra: Partial<Parameters<typeof evaluatePromise>[0]> = {}) {
  const compiled = agreement();
  return evaluatePromise({
    terms: compiled.terms,
    agreementHash: compiled.hash,
    observations,
    currentModelHash: compiled.terms.eventModel.hash,
    now,
    ...extra,
  });
}

describe('physical agreement compiler', () => {
  it('compiles one fixed-price sequence with explicit duration and failure policies', () => {
    const compiled = agreement();
    expect(compiled.executable).toBe(true);
    expect(compiled.terms.requiredSequence).toEqual(['IDLE', 'START', 'RUNNING', 'EXPECTED_STOP']);
    expect(compiled.terms.constraints.minRunMs).toBe(15_000);
    expect(compiled.terms.financial.fixedPriceMinor).toBe(200);
    expect(compiled.terms.financial.maximumChargeMinor).toBe(200);
    expect(compiled.terms.policies.failure).toBe('NO_CAPTURE');
    expect(compiled.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAgreementTerms(compiled.terms)).toBe(compiled.hash);
  });

  it('rejects escrow, recurrence, variable pricing and ambiguous quantities', () => {
    const base = agreement().terms;
    const result = compilePhysicalAgreement({
      text: 'Hold the payment in escrow and release it every month if the machine roughly completes a cycle.',
      serviceName: 'Unsafe proposal',
      objectId: base.objectId,
      objectName: base.objectName,
      currency: 'USD',
      eventModel: base.eventModel,
      now: NOW,
    });
    expect(result.executable).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'UNSUPPORTED_CLAUSE')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'PRICE_REQUIRED' || issue.code === 'PRICE_NOT_POSITIVE')).toBe(true);
  });

  it('changes the digest when any approved term changes', () => {
    const compiled = agreement();
    const changed = {
      ...compiled.terms,
      financial: { ...compiled.terms.financial, fixedPriceMinor: 300, maximumChargeMinor: 300 },
    };
    expect(hashAgreementTerms(changed)).not.toBe(compiled.hash);
  });
});

describe('deterministic temporal evaluator', () => {
  it('qualifies one complete cycle and measures real intervals', async () => {
    const result = await evaluate(qualifiedObservations());
    expect(result.outcome).toBe('QUALIFIED');
    expect(result.eligibleForCapture).toBe(true);
    expect(result.runMs).toBe(17_000);
    expect(result.observedMs).toBe(27_000);
    expect(result.events.map((event) => event.label)).toContain('EXPECTED_STOP');
    expect(result.checks.every((check) => check.status !== 'FAIL')).toBe(true);
  });

  it('does not qualify an early stop', async () => {
    const result = await evaluate([
      { seq: 1, startMs: 0, endMs: 4_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
      { seq: 2, startMs: 4_000, endMs: 14_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 3, startMs: 14_000, endMs: 20_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
    ]);
    expect(result.outcome).toBe('INTERRUPTED');
    expect(result.eligibleForCapture).toBe(false);
  });

  it('does not qualify sensor loss or uncertain evidence', async () => {
    const lost = await evaluate([
      { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
      { seq: 2, startMs: 5_000, endMs: 22_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 3, startMs: 22_000, endMs: 27_000, state: 'DISCONNECTED', confidence: 0, qualityFlags: ['DEVICE_LOST'] },
    ]);
    expect(lost.outcome).toBe('SENSOR_LOST');
    expect(lost.eligibleForCapture).toBe(false);

    const uncertain = await evaluate([
      { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
      { seq: 2, startMs: 5_000, endMs: 12_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 3, startMs: 12_000, endMs: 13_000, state: 'UNCERTAIN', confidence: 0.3, qualityFlags: ['LOW_CONFIDENCE'] },
      { seq: 4, startMs: 13_000, endMs: 25_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 5, startMs: 25_000, endMs: 30_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
    ]);
    expect(uncertain.outcome).toBe('UNCERTAIN');
    expect(uncertain.eligibleForCapture).toBe(false);
  });

  it('rejects a second cycle and an expired approval', async () => {
    const secondCycle = await evaluate([
      { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
      { seq: 2, startMs: 5_000, endMs: 22_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 3, startMs: 22_000, endMs: 24_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
      { seq: 4, startMs: 24_000, endMs: 35_000, state: 'ACTIVE_CONFIDENT', confidence: 0.95, qualityFlags: [] },
      { seq: 5, startMs: 35_000, endMs: 40_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
    ]);
    expect(secondCycle.outcome).toBe('REJECTED');
    expect(secondCycle.eligibleForCapture).toBe(false);

    const expired = await evaluate(qualifiedObservations(), '2026-11-10T14:00:00.000Z');
    expect(expired.outcome).toBe('EXPIRED');
    expect(expired.eligibleForCapture).toBe(false);
  });

  it('rejects a substituted model identity', async () => {
    const compiled = agreement();
    const result = await evaluatePromise({
      terms: compiled.terms,
      agreementHash: compiled.hash,
      observations: qualifiedObservations(),
      currentModelHash: 'f'.repeat(64),
      now: '2026-11-10T12:10:00.000Z',
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.eligibleForCapture).toBe(false);
  });

  it('is deterministic for identical terms and observations', async () => {
    const first = await evaluate(qualifiedObservations());
    const second = await evaluate(qualifiedObservations());
    expect(second).toEqual(first);
    expect(second.evidenceRoot).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('event model gate', () => {
  it('learns separate per-take prototypes and clears the local gate', () => {
    expect(trained.artifact.status).toBe('READY');
    expect(trained.artifact.training.groupCount).toBeGreaterThanOrEqual(5);
    expect(trained.artifact.prototypes?.[0]?.length).toBe(5);
    expect(trained.artifact.prototypes?.[1]?.length).toBe(5);
    expect(trained.artifact.prototypes?.[2]?.length).toBeGreaterThanOrEqual(5);
    expect(trained.artifact.metrics.perClass.BACKGROUND.recall).toBeGreaterThanOrEqual(0.6);
    expect(trained.artifact.metrics.macroRecall).toBeGreaterThanOrEqual(0.65);
    expect(trained.artifact.limitations.join(' ')).toMatch(/not a guarantee of field reliability/i);
  });
});
