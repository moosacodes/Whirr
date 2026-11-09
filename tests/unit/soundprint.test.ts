import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  predictFrame,
  type ModelArtifact,
} from '../../packages/audio/src/classifier.ts';
import { segmentPredictions } from '../../packages/audio/src/hysteresis.ts';
import { summariseIntervals } from '../../packages/meter/src/intervals.ts';
import { FEATURE_NAMES, FEATURE_SPEC_VERSION } from '../../packages/audio/src/spec.ts';
import {
  buildSoundprint,
  normaliseBandProfile,
  profileSimilarity,
  soundprintScore,
} from '../../packages/audio/src/soundprint.ts';

const BAND_INDICES = FEATURE_NAMES.map((name, index) => (name.startsWith('band_') ? index : -1)).filter(
  (index) => index >= 0,
);

const ACTIVE_PROFILE = [0.34, 0.25, 0.15, 0.1, 0.07, 0.04, 0.03, 0.02];
const IDLE_PROFILE = [0.02, 0.03, 0.05, 0.08, 0.14, 0.2, 0.23, 0.25];

function frameFor(profile: number[]): number[] {
  const values = new Array<number>(FEATURE_NAMES.length).fill(0);
  for (let i = 0; i < BAND_INDICES.length; i += 1) {
    values[BAND_INDICES[i]!] = Math.log10(Math.max(profile[i] ?? 1e-6, 1e-9));
  }
  return values;
}

function rowsFor(profile: number[], count = 40): number[][] {
  return Array.from({ length: count }, () => frameFor(profile));
}

function referenceModel(soundprint: ReturnType<typeof buildSoundprint>): ModelArtifact {
  return {
    schema: 'whirr.model.v1',
    version: 'soundprint-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    algo: 'multinomial-logistic-regression',
    featureSpecVersion: FEATURE_SPEC_VERSION,
    featureNames: [...FEATURE_NAMES],
    classes: ['idle', 'active', 'other'],
    mean: new Array<number>(FEATURE_NAMES.length).fill(0),
    std: new Array<number>(FEATURE_NAMES.length).fill(1),
    weights: [
      new Array<number>(FEATURE_NAMES.length).fill(0),
      new Array<number>(FEATURE_NAMES.length).fill(0),
      new Array<number>(FEATURE_NAMES.length).fill(0),
    ],
    bias: [0, 8, 0],
    policy: { ...DEFAULT_POLICY },
    training: {
      takeCount: 3,
      frameCount: 80,
      durationMs: 2560,
      datasetHash: 'test',
      seed: 1,
      iterations: 1,
      learningRate: 0.1,
      l2: 0,
      classFrames: { idle: 40, active: 40, other: 0 },
    },
    metrics: {
      method: 'LEAVE_ONE_TAKE_OUT',
      precision: 1,
      recall: 1,
      falseBillableRatio: 0,
      billedActiveMs: 0,
      trueActiveMs: 0,
      falseBilledMs: 0,
      nonActiveMs: 0,
      frameAccuracy: 1,
      confusion: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      confusionLabels: ['idle', 'active', 'other'],
      takeCounts: { idle: 1, active: 1, negative: 1, transition: 0 },
      totalTakeFrames: 80,
      totalDurationMs: 2560,
      perTake: [],
    },
    baseline: {
      method: 'RMS_THRESHOLD',
      thresholdLogRms: -2,
      precision: 0,
      recall: 0,
      falseBillableRatio: 0,
      billedActiveMs: 0,
    },
    featureImportance: [],
    status: 'READY',
    statusReasons: [],
    limitations: [],
    provenance: 'USER_CALIBRATION',
    ...(soundprint ? { soundprint } : {}),
  };
}

describe('acoustic passport', () => {
  it('enrolls a spectral profile that retains active sound and rejects non-active sound', () => {
    const soundprint = buildSoundprint(rowsFor(ACTIVE_PROFILE), rowsFor(IDLE_PROFILE), 2);
    expect(soundprint).not.toBeNull();
    expect(soundprint!.schema).toBe('whirr.soundprint.v1');
    expect(soundprint!.status).toBe('ENROLLED');
    expect(soundprint!.gateEnabled).toBe(true);
    expect(soundprint!.bands).toHaveLength(8);
    expect(soundprint!.matchThreshold).toBeGreaterThan(soundprint!.nonActiveP95Similarity);
    expect(soundprint!.activeMedianSimilarity).toBeGreaterThan(soundprint!.matchThreshold);
    expect(soundprint!.activeBlockRatio).toBeLessThanOrEqual(0.15);
    expect(soundprint!.nonActivePassRatio).toBeLessThanOrEqual(0.2);

    expect(soundprintScore(soundprint!, frameFor(ACTIVE_PROFILE))).toBeGreaterThan(soundprint!.matchThreshold);
    expect(soundprintScore(soundprint!, frameFor(IDLE_PROFILE))).toBeLessThan(soundprint!.matchThreshold);
  });

  it('is amplitude-invariant because it compares spectral shape, not loudness', () => {
    const quiet = normaliseBandProfile(frameFor(ACTIVE_PROFILE.map((value) => value * 0.05)));
    const loud = normaliseBandProfile(frameFor(ACTIVE_PROFILE.map((value) => value * 5)));
    expect(profileSimilarity(quiet, loud)).toBeCloseTo(1, 6);
  });

  it('refuses to enable a gate when active and non-active profiles overlap', () => {
    const soundprint = buildSoundprint(rowsFor(ACTIVE_PROFILE), rowsFor(ACTIVE_PROFILE), 2);
    expect(soundprint).not.toBeNull();
    expect(soundprint!.status).toBe('WEAK');
    expect(soundprint!.gateEnabled).toBe(false);
    expect(soundprint!.notes.join(' ')).toMatch(/disabled/i);
  });

  it('returns no passport rather than inventing one from too little audio', () => {
    expect(buildSoundprint(rowsFor(ACTIVE_PROFILE, 29), rowsFor(IDLE_PROFILE, 40), 2)).toBeNull();
    expect(buildSoundprint(rowsFor(ACTIVE_PROFILE, 40), rowsFor(IDLE_PROFILE, 29), 2)).toBeNull();
  });

  it('flags mismatched frames and makes their time free', () => {
    const soundprint = buildSoundprint(rowsFor(ACTIVE_PROFILE), rowsFor(IDLE_PROFILE), 2);
    const model = referenceModel(soundprint);

    const matching = predictFrame(model, frameFor(ACTIVE_PROFILE), [], 0, 32);
    expect(matching.flags).not.toContain('SOUNDPRINT_MISMATCH');
    expect(matching.soundprintMismatch).toBe(false);

    const mismatched = predictFrame(model, frameFor(IDLE_PROFILE), [], 0, 32);
    expect(mismatched.flags).toContain('SOUNDPRINT_MISMATCH');
    expect(mismatched.soundprintMismatch).toBe(true);
    expect(mismatched.soundprintScore).toBeLessThan(soundprint!.matchThreshold);

    const intervals = segmentPredictions(
      Array.from({ length: 6 }, (_, index) => ({
        ...mismatched,
        startMs: index * 32,
        endMs: (index + 1) * 32,
      })),
      { ...DEFAULT_POLICY, onFrames: 3, offFrames: 3 },
    );
    const summary = summariseIntervals(intervals);
    expect(summary.billableMs).toBe(0);
    expect(summary.uncertainMs).toBeGreaterThan(0);
    expect(intervals.some((interval) => interval.qualityFlags.includes('SOUNDPRINT_MISMATCH'))).toBe(true);
  });
});
