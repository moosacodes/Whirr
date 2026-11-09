import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  predictFrame,
  type ClassLabel,
  type ModelArtifact,
} from '../../packages/audio/src/classifier.ts';
import { segmentPredictions } from '../../packages/audio/src/hysteresis.ts';
import { summariseIntervals } from '../../packages/meter/src/intervals.ts';
import { FEATURE_NAMES, FEATURE_SPEC_VERSION } from '../../packages/audio/src/spec.ts';

function modelWithBias(bias: number[], withRejection = true): ModelArtifact {
  const zero = new Array<number>(FEATURE_NAMES.length).fill(0);
  return {
    schema: 'whirr.model.v1',
    version: 'open-set-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    algo: 'multinomial-logistic-regression',
    featureSpecVersion: FEATURE_SPEC_VERSION,
    featureNames: [...FEATURE_NAMES],
    classes: ['idle', 'active', 'other'] as ClassLabel[],
    mean: new Array<number>(FEATURE_NAMES.length).fill(0),
    std: new Array<number>(FEATURE_NAMES.length).fill(1),
    weights: [zero, zero, zero],
    bias,
    policy: { ...DEFAULT_POLICY, onFrames: 3, offFrames: 3 },
    ...(withRejection
      ? { rejection: { minTopProbability: 0.55, unknownOtherProbability: 0.45 } }
      : {}),
    training: {
      takeCount: 3,
      frameCount: 30,
      durationMs: 960,
      datasetHash: 'test',
      seed: 1,
      iterations: 1,
      learningRate: 0.1,
      l2: 0,
      classFrames: { idle: 10, active: 10, other: 10 },
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
      confusionLabels: ['idle', 'active', 'other'] as ClassLabel[],
      takeCounts: { idle: 1, active: 1, negative: 1, transition: 0 },
      totalTakeFrames: 30,
      totalDurationMs: 960,
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
  };
}

const features = () => new Array<number>(FEATURE_NAMES.length).fill(0);

describe('open-set sensing', () => {
  it('rejects a dominant unknown/competing sound', () => {
    const prediction = predictFrame(modelWithBias([0, 0, 6]), features(), [], 0, 32);
    expect(prediction.flags).toContain('UNKNOWN_OBJECT');
    expect(prediction.flags).not.toContain('LOW_CONFIDENCE');
  });

  it('flags an ambiguous top probability as low confidence', () => {
    const prediction = predictFrame(modelWithBias([0, 0, 0]), features(), [], 0, 32);
    expect(prediction.flags).toContain('LOW_CONFIDENCE');
    expect(prediction.pActive).toBeCloseTo(1 / 3, 6);
  });

  it('keeps a strong enrolled-active decision clean', () => {
    const prediction = predictFrame(modelWithBias([0, 6, 0]), features(), [], 0, 32);
    expect(prediction.flags).not.toContain('LOW_CONFIDENCE');
    expect(prediction.flags).not.toContain('UNKNOWN_OBJECT');
  });

  it('uses the default rejection policy for models trained before open-set existed', () => {
    const prediction = predictFrame(modelWithBias([0, 0, 6], false), features(), [], 0, 32);
    expect(prediction.flags).toContain('UNKNOWN_OBJECT');
  });

  it('makes unknown and low-confidence frames free rather than billable', () => {
    const model = modelWithBias([0, 0.4, 3.6]);
    const predictions = Array.from({ length: 8 }, (_, index) => {
      const prediction = predictFrame(model, features(), [], index * 32, (index + 1) * 32);
      expect(prediction.flags).toContain('UNKNOWN_OBJECT');
      return prediction;
    });
    const intervals = segmentPredictions(predictions, model.policy);
    const summary = summariseIntervals(intervals);
    expect(summary.billableMs).toBe(0);
    expect(summary.uncertainMs).toBeGreaterThan(0);
    expect(intervals.some((interval) => interval.qualityFlags.includes('UNKNOWN_OBJECT'))).toBe(true);
  });
});
