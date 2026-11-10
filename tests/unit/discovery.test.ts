import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_PROTOCOL,
  buildDiscoveryProfile,
  evaluateDiscovery,
  fingerprintFrames,
  matchDiscoveryProfiles,
  type DiscoveryTrialCase,
} from '../../packages/audio/src/discovery.ts';
import { FEATURE_COUNT, FEATURE_NAMES } from '../../packages/audio/src/spec.ts';

const BAND_START = FEATURE_NAMES.indexOf('band_50_120');

function frame(profile: number[]): number[] {
  const values = new Array(FEATURE_COUNT).fill(0);
  for (let index = 0; index < 8; index += 1) {
    values[BAND_START + index] = profile[index] ?? -8;
  }
  const centroid = FEATURE_NAMES.indexOf('spectral_centroid');
  const spread = FEATURE_NAMES.indexOf('spectral_spread');
  const rolloff = FEATURE_NAMES.indexOf('spectral_rolloff');
  const flatness = FEATURE_NAMES.indexOf('spectral_flatness');
  const dominant = FEATURE_NAMES.indexOf('dominant_frequency');
  const harmonic = FEATURE_NAMES.indexOf('harmonic_ratio');
  const zcr = FEATURE_NAMES.indexOf('zero_cross_rate');
  const crest = FEATURE_NAMES.indexOf('crest_factor');
  const lowHigh = FEATURE_NAMES.indexOf('low_high_ratio');
  values[centroid] = 0.12;
  values[spread] = 0.25;
  values[rolloff] = 0.3;
  values[flatness] = 0.08;
  values[dominant] = 0.09;
  values[harmonic] = 0.7;
  values[zcr] = 0.04;
  values[crest] = 6;
  values[lowHigh] = 10;
  return values;
}

function frames(profile: number[], count = 64): number[][] {
  return Array.from({ length: count }, (_, index) =>
    frame(profile.map((value) => value + (index % 4) * 0.015)),
  );
}

const FAN = [-1.0, -2.0, -3.2, -4.4, -5.1, -6.2, -7.4, -8.2];
const DRILL = [-7.9, -7.0, -5.8, -4.8, -3.4, -2.3, -1.7, -2.7];

const fanTakes = [
  { frames: frames(FAN), frameFlags: frames(FAN).map(() => []) },
  { frames: frames(FAN.map((value) => value + 0.02)), frameFlags: frames(FAN).map(() => []) },
];
const drillTakes = [
  { frames: frames(DRILL), frameFlags: frames(DRILL).map(() => []) },
  { frames: frames(DRILL.map((value) => value + 0.02)), frameFlags: frames(DRILL).map(() => []) },
];

describe('discovery matcher', () => {
  it('builds a deterministic READY profile from two independent takes', () => {
    const profile = buildDiscoveryProfile('obj_fan', fanTakes, '2026-11-09T10:00:00.000Z');
    expect(profile.status).toBe('READY');
    expect(profile.trainingTakeCount).toBe(2);
    expect(profile.trainingFingerprints).toHaveLength(2);
    expect(profile.medoids.length).toBeGreaterThan(0);
    expect(profile.limitations.length).toBeGreaterThan(3);
  });

  it('matches a held-out target and rejects a flat unknown source', () => {
    const fan = buildDiscoveryProfile('obj_fan', fanTakes, '2026-11-09T10:00:00.000Z');
    const drill = buildDiscoveryProfile('obj_drill', drillTakes, '2026-11-09T10:00:00.000Z');
    const target = frames(FAN.map((value) => value + 0.01));
    const targetFlags = target.map(() => []);
    const matched = matchDiscoveryProfiles(target, targetFlags, [fan, drill]);
    expect(matched.result).toBe('MATCH');
    expect(matched.top?.objectId).toBe('obj_fan');

    const flat = frames(new Array(8).fill(-4.5));
    const unknown = matchDiscoveryProfiles(flat, flat.map(() => []), [fan, drill]);
    expect(unknown.result).not.toBe('MATCH');
    expect(unknown.top?.objectId ?? null).not.toBe('obj_fan');
  });

  it('returns AMBIGUOUS when two enrollments are indistinguishable', () => {
    const first = buildDiscoveryProfile('obj_a', fanTakes, '2026-11-09T10:00:00.000Z');
    const second = buildDiscoveryProfile('obj_b', fanTakes, '2026-11-09T10:00:00.000Z');
    const result = matchDiscoveryProfiles(frames(FAN), frames(FAN).map(() => []), [first, second]);
    expect(result.result).toBe('AMBIGUOUS');
    expect(result.top?.margin).toBeLessThan(DISCOVERY_PROTOCOL.minMargin);
  });

  it('returns UNKNOWN before two ready enrollments exist', () => {
    const fan = buildDiscoveryProfile('obj_fan', fanTakes, '2026-11-09T10:00:00.000Z');
    const result = matchDiscoveryProfiles(frames(FAN), frames(FAN).map(() => []), [fan]);
    expect(result.result).toBe('UNKNOWN');
    expect(result.reason).toContain('At least two');
  });

  it('rejects a duplicate enrollment fingerprint', () => {
    const first = fingerprintFrames(frames(FAN), frames(FAN).map(() => []));
    const second = fingerprintFrames(frames(FAN), frames(FAN).map(() => []));
    const other = fingerprintFrames(frames(FAN.map((value) => value + 0.2)), frames(FAN).map(() => []));
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it('computes confusion, false-match and replay metrics from held-out decisions only', () => {
    const fan = buildDiscoveryProfile('obj_fan', fanTakes, '2026-11-09T10:00:00.000Z');
    const drill = buildDiscoveryProfile('obj_drill', drillTakes, '2026-11-09T10:00:00.000Z');
    const trial = (overrides: Partial<DiscoveryTrialCase>): DiscoveryTrialCase => ({
      truthObjectId: 'obj_fan',
      condition: 'BASELINE',
      result: 'MATCH',
      predictedObjectId: 'obj_fan',
      latencyMs: 20,
      quality: { usableFrames: 60, totalFrames: 60, usableRatio: 1 },
      ...overrides,
    });
    const cases: DiscoveryTrialCase[] = [
      ...Array.from({ length: 6 }, () => trial({})),
      ...Array.from({ length: 6 }, () => trial({ truthObjectId: 'obj_drill', predictedObjectId: 'obj_drill' })),
      ...Array.from({ length: 6 }, () => trial({ truthObjectId: null, condition: 'UNKNOWN_OBJECT', result: 'UNKNOWN', predictedObjectId: null })),
      ...Array.from({ length: 3 }, () => trial({ condition: 'DISTANCE_1M' })),
      ...Array.from({ length: 3 }, () => trial({ condition: 'ROOM_NOISE', truthObjectId: 'obj_drill', result: 'UNKNOWN', predictedObjectId: null })),
      ...Array.from({ length: 3 }, () => trial({ condition: 'REPLAY', result: 'MATCH', predictedObjectId: 'obj_drill' })),
    ];
    const result = evaluateDiscovery(cases, [fan, drill]);
    expect(result.metrics.targetTrials).toBe(15);
    expect(result.metrics.targetCorrect).toBe(15);
    expect(result.metrics.noiseCorrect).toBe(3);
    expect(result.metrics.distanceCorrect).toBe(3);
    expect(result.metrics.falseMatches).toBe(0);
    expect(result.metrics.unknownRejectionRate).toBe(1);
    expect(result.metrics.replayCrossMatches).toBe(3);
    expect(result.metrics.replayCrossMatchRate).toBe(1);
    expect(result.confusion.matrix.length).toBe(3);
    expect(result.status).toBe('FAIL');
  });
});
