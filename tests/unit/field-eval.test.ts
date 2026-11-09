import { describe, expect, it } from 'vitest';
import {
  FIELD_PROTOCOL,
  canonicalCycleTimeline,
  canonicalSingleTrialTimeline,
  evaluateFieldTrial,
  recordingQualityPasses,
  trialMeetsThresholds,
  validateFieldFrames,
  validateFieldTimeline,
} from '../../packages/audio/src/field-eval.ts';
import { DEFAULT_POLICY, type ModelArtifact } from '../../packages/audio/src/classifier.ts';
import {
  FEATURE_COUNT,
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  FRAME_MS,
} from '../../packages/audio/src/spec.ts';

const CYCLE_DURATION = Math.floor(FIELD_PROTOCOL.cycleTotalMs / FRAME_MS) * FRAME_MS;

function testModel(): ModelArtifact {
  const weights = [
    Array.from({ length: FEATURE_COUNT }, (_, index) => (index === 0 ? -1 : 0)),
    Array.from({ length: FEATURE_COUNT }, (_, index) => (index === 0 ? 1 : 0)),
    new Array<number>(FEATURE_COUNT).fill(0),
  ];
  return {
    schema: 'whirr.model.v1',
    version: 'field-test-v1',
    createdAt: new Date(0).toISOString(),
    algo: 'multinomial-logistic-regression',
    featureSpecVersion: FEATURE_SPEC_VERSION,
    featureNames: [...FEATURE_NAMES],
    classes: ['idle', 'active', 'other'],
    mean: new Array<number>(FEATURE_COUNT).fill(0),
    std: new Array<number>(FEATURE_COUNT).fill(1),
    weights,
    bias: [0, 0, 0],
    policy: {
      ...DEFAULT_POLICY,
      activeThreshold: 0.9,
      idleThreshold: 0.5,
      activeMargin: 0.1,
      smoothing: 0.9,
      onFrames: 1,
      offFrames: 1,
    },
    rejection: { minTopProbability: 0.55, unknownOtherProbability: 0.45 },
    training: {
      takeCount: 5,
      frameCount: 2_500,
      durationMs: 80_000,
      datasetHash: 'a'.repeat(64),
      seed: 1,
      iterations: 1,
      learningRate: 0.1,
      l2: 0,
      classFrames: { idle: 1_000, active: 1_000, other: 500 },
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
      takeCounts: { idle: 2, active: 2, negative: 1, transition: 0 },
      totalTakeFrames: 2_500,
      totalDurationMs: 80_000,
      perTake: [],
    },
    baseline: {
      method: 'RMS_THRESHOLD',
      thresholdLogRms: 0,
      precision: 1,
      recall: 1,
      falseBillableRatio: 0,
      billedActiveMs: 0,
    },
    featureImportance: [],
    status: 'READY',
    statusReasons: [],
    limitations: [],
    provenance: 'USER_CALIBRATION',
  };
}

function framesFor(
  timeline: ReturnType<typeof canonicalCycleTimeline>,
  durationMs: number,
  override?: (index: number, truth: 'OPERATING' | 'IDLE') => 'OPERATING' | 'IDLE',
): number[][] {
  const count = Math.floor(durationMs / FRAME_MS);
  return Array.from({ length: count }, (_, index) => {
    const midpoint = index * FRAME_MS + FRAME_MS / 2;
    const segment =
      timeline.find((entry) => midpoint >= entry.startMs && midpoint < entry.endMs) ??
      timeline[timeline.length - 1]!;
    const truth = override ? override(index, segment.truth) : segment.truth;
    const features = new Array<number>(FEATURE_COUNT).fill(0);
    features[0] = truth === 'OPERATING' ? 10 : -10;
    return features;
  });
}

describe('real-world field evaluation', () => {
  it('computes perfect held-out metrics when the model follows the protocol', () => {
    const timeline = canonicalCycleTimeline(CYCLE_DURATION);
    const frames = framesFor(timeline, CYCLE_DURATION);
    const result = evaluateFieldTrial(testModel(), {
      kind: 'THREE_CYCLE',
      frames,
      frameFlags: [],
      timeline,
      durationMs: CYCLE_DURATION,
    });

    expect(result.metrics.cycles).toBe(3);
    expect(result.metrics.precision).toBeGreaterThan(0.99);
    expect(result.metrics.recall).toBeGreaterThan(0.99);
    // Boundary frames can land on the far side of a prompt by one 32 ms hop.
    expect(result.metrics.falseBilledMs).toBeLessThan(100);
    expect(result.metrics.billingErrorMs).toBeLessThan(200);
    expect(result.metrics.expectedOperatingMs).toBeGreaterThan(14_000);
    expect(result.quality.frameCoverage).toBeCloseTo(1, 5);
    expect(recordingQualityPasses(result.quality)).toBe(true);
    expect(trialMeetsThresholds('THREE_CYCLE', result.metrics)).toBe(true);
  });

  it('counts false-billable time honestly when idle audio is classified as running', () => {
    const timeline = canonicalCycleTimeline(CYCLE_DURATION);
    const frames = framesFor(timeline, CYCLE_DURATION, () => 'OPERATING');
    const result = evaluateFieldTrial(testModel(), {
      kind: 'THREE_CYCLE',
      frames,
      frameFlags: [],
      timeline,
      durationMs: CYCLE_DURATION,
    });

    expect(result.metrics.falseBilledMs).toBeGreaterThan(10_000);
    expect(result.metrics.falseBillableRatio).toBeGreaterThan(0.5);
    expect(result.metrics.precision).toBeLessThan(0.8);
    expect(trialMeetsThresholds('THREE_CYCLE', result.metrics)).toBe(false);
  });

  it('rejects a replay that the model bills, and requires distance detection', () => {
    const model = testModel();
    const replayTimeline = canonicalSingleTrialTimeline('REPLAY', 12_000);
    const replay = evaluateFieldTrial(model, {
      kind: 'REPLAY',
      frames: framesFor(replayTimeline, 12_000, () => 'OPERATING'),
      frameFlags: [],
      timeline: replayTimeline,
      durationMs: 12_000,
    });
    expect(replay.metrics.activeRatio).toBeGreaterThan(0.9);
    expect(trialMeetsThresholds('REPLAY', replay.metrics)).toBe(false);

    const distanceTimeline = canonicalSingleTrialTimeline('DISTANCE', 12_000);
    const distance = evaluateFieldTrial(model, {
      kind: 'DISTANCE',
      frames: framesFor(distanceTimeline, 12_000),
      frameFlags: [],
      timeline: distanceTimeline,
      durationMs: 12_000,
    });
    expect(distance.metrics.activeRatio).toBeGreaterThan(0.9);
    expect(trialMeetsThresholds('DISTANCE', distance.metrics)).toBe(true);

    const noiseTimeline = canonicalSingleTrialTimeline('NOISE', 12_000);
    const noise = evaluateFieldTrial(model, {
      kind: 'NOISE',
      frames: framesFor(noiseTimeline, 12_000),
      frameFlags: [],
      timeline: noiseTimeline,
      durationMs: 12_000,
    });
    expect(noise.metrics.falseBillableRatio).toBe(0);
    expect(trialMeetsThresholds('NOISE', noise.metrics)).toBe(true);
  });

  it('validates the guided protocol shape instead of trusting arbitrary labels', () => {
    const timeline = canonicalCycleTimeline(FIELD_PROTOCOL.cycleTotalMs);
    expect(validateFieldTimeline('THREE_CYCLE', timeline, FIELD_PROTOCOL.cycleTotalMs)).toEqual([]);
    const twoCycles = timeline.map((segment, index) =>
      index === 3 ? { ...segment, truth: 'IDLE' as const } : segment,
    );
    expect(validateFieldTimeline('THREE_CYCLE', twoCycles, FIELD_PROTOCOL.cycleTotalMs).join(' ')).toContain(
      'Expected exactly 3 OPERATING segments',
    );
    const wrongNoise = canonicalSingleTrialTimeline('NOISE', 12_000).map((segment) => ({
      ...segment,
      truth: 'OPERATING' as const,
    }));
    expect(validateFieldTimeline('NOISE', wrongNoise, 12_000).join(' ')).toContain('non-billable');
  });

  it('rejects a frame stream with too little coverage or too few frames', () => {
    const frames = framesFor(canonicalSingleTrialTimeline('NOISE', 12_000), 12_000);
    expect(validateFieldFrames(frames, [], 12_000)).toEqual([]);
    expect(validateFieldFrames(frames.slice(0, 100), [], 12_000).join(' ')).toContain('too short');
    expect(validateFieldFrames(frames.slice(0, 200), [], 12_000).join(' ')).toContain('expected frames');
  });
});
