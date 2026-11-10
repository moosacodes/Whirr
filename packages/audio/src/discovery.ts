import { DISQUALIFYING_FLAGS, FEATURE_NAMES } from './spec.ts';
import { normaliseBandProfile } from './soundprint.ts';

/**
 * Whirr 5.0 discovery experiment.
 *
 * This module answers one narrow question: given a short live recording, does
 * it resemble one of two enrolled physical objects closely enough to offer a
 * checkout link? It is deliberately NOT an authentication or ownership claim.
 * A match is a hypothesis for a human to confirm.
 */
export const DISCOVERY_SCHEMA = 'whirr.discovery.v1';
export const DISCOVERY_METHOD = 'MEDOID_BAND_PROFILE_COSINE';
export const DISCOVERY_RESULTS = ['MATCH', 'AMBIGUOUS', 'UNKNOWN'] as const;
export type DiscoveryResult = (typeof DISCOVERY_RESULTS)[number];

export const DISCOVERY_CONDITIONS = [
  'BASELINE',
  'ROOM_NOISE',
  'APPLIANCE_NOISE',
  'DISTANCE_1M',
  'DISTANCE_2M',
  'REPLAY',
  'UNKNOWN_OBJECT',
] as const;
export type DiscoveryCondition = (typeof DISCOVERY_CONDITIONS)[number];

export const DISCOVERY_PROTOCOL = {
  schema: 'whirr.discovery-protocol.v1',
  minEnrollments: 2,
  trainingTakesPerObject: 2,
  minTakeFrames: 30,
  minMatchFrames: 30,
  maxMatchFrames: 1_500,
  minScore: 0.9,
  minMargin: 0.035,
  maxMedianLatencyMs: 250,
  minTargetTrials: 12,
  minTargetTrialsPerObject: 6,
  minUnknownTrials: 6,
  minReplayTrials: 3,
  minDistanceTrials: 3,
  minNoiseTrials: 3,
  targetAccuracy: 0.9,
  unknownRejection: 0.9,
  falseMatchRate: 0.05,
  replayCrossMatchRate: 0.05,
  distanceAccuracy: 0.8,
  noiseAccuracy: 0.8,
  minUsableRatio: 0.6,
} as const;

export const DISCOVERY_LIMITATIONS = [
  'A match says the live spectrum resembles an enrollment. It does not prove which physical unit is present, who owns it, or that it is being used by a human.',
  'Identical models, nearby machines, room reverberation, microphone placement, distance, orientation and competing sounds can all change the score.',
  'A phone or speaker can replay a recording. This prototype has no liveness detector and must never be used as an authentication factor.',
  'Enrollment evidence is client-claimed live microphone input. The local server can validate structure and quality, not physical presence.',
  'All timings and scores are experimental. No metric in this module is a real-world result until the reproducible protocol has been run on physical objects.',
] as const;

export interface DiscoveryTrainingTake {
  id?: string;
  frames: number[][];
  frameFlags?: string[][];
}

export interface DiscoveryProfile {
  schema: typeof DISCOVERY_SCHEMA;
  method: typeof DISCOVERY_METHOD;
  objectId: string;
  status: 'READY' | 'WEAK';
  trainingTakeCount: number;
  trainingFrameCount: number;
  usableFrameCount: number;
  medoids: number[][];
  centroid: number[];
  bands: number[];
  trainingFingerprints: string[];
  createdAt: string;
  limitations: string[];
}

export interface DiscoveryQuality {
  totalFrames: number;
  usableFrames: number;
  usableRatio: number;
  clippedFrames: number;
  silentFrames: number;
  lowLevelFrames: number;
}

export interface DiscoveryCandidate {
  objectId: string;
  score: number;
}

export interface DiscoveryMatchEvaluation {
  result: DiscoveryResult;
  top: { objectId: string; score: number; margin: number } | null;
  candidates: DiscoveryCandidate[];
  quality: DiscoveryQuality;
  reason: string;
}

export interface DiscoveryTrialCase {
  truthObjectId: string | null;
  condition: DiscoveryCondition;
  result: DiscoveryResult;
  predictedObjectId: string | null;
  latencyMs: number;
  quality: { usableFrames: number; totalFrames: number; usableRatio: number };
}

export interface DiscoveryGate {
  id: string;
  label: string;
  threshold: string;
  observed: string;
  status: 'PASS' | 'FAIL' | 'OPEN';
  detail: string;
}

export interface DiscoveryReportMetrics {
  enrollmentCount: number;
  trials: number;
  targetTrials: number;
  targetCorrect: number;
  targetAccuracy: number;
  falseMatches: number;
  falseMatchRate: number;
  unknownTrials: number;
  unknownRejections: number;
  unknownRejectionRate: number;
  ambiguousResults: number;
  replayTrials: number;
  replayAccepted: number;
  replayCrossMatches: number;
  replayCrossMatchRate: number;
  distanceTrials: number;
  distanceCorrect: number;
  distanceAccuracy: number;
  noiseTrials: number;
  noiseCorrect: number;
  noiseAccuracy: number;
  medianLatencyMs: number;
  meanUsableRatio: number;
}

export interface DiscoveryConditionSummary {
  condition: DiscoveryCondition;
  trials: number;
  correct: number;
  falseMatches: number;
  unknown: number;
  ambiguous: number;
}

export interface DiscoveryEvaluation {
  status: 'NOT_RUN' | 'INCOMPLETE' | 'PASS' | 'FAIL';
  metrics: DiscoveryReportMetrics;
  confusion: { columns: string[]; rows: string[]; matrix: number[][] };
  conditions: DiscoveryConditionSummary[];
  gates: DiscoveryGate[];
}

const CENTROID = FEATURE_NAMES.indexOf('spectral_centroid');
const SPREAD = FEATURE_NAMES.indexOf('spectral_spread');
const ROLLOFF = FEATURE_NAMES.indexOf('spectral_rolloff');
const FLATNESS = FEATURE_NAMES.indexOf('spectral_flatness');
const DOMINANT = FEATURE_NAMES.indexOf('dominant_frequency');
const HARMONIC = FEATURE_NAMES.indexOf('harmonic_ratio');
const CREST = FEATURE_NAMES.indexOf('crest_factor');
const LOW_HIGH = FEATURE_NAMES.indexOf('low_high_ratio');
const ZCR = FEATURE_NAMES.indexOf('zero_cross_rate');

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 5): number {
  return Number(value.toFixed(digits));
}

function l2(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 1e-12) return values.map(() => 0);
  return values.map((value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    const av = Number(a[index] ?? 0);
    const bv = Number(b[index] ?? 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return clamp(dot / Math.sqrt(normA * normB), 0, 1);
}

function mean(rows: number[][]): number[] {
  if (rows.length === 0) return [];
  const length = Math.min(...rows.map((row) => row.length));
  const sums = new Array(length).fill(0);
  for (const row of rows) {
    for (let index = 0; index < length; index += 1) sums[index] += Number(row[index] ?? 0);
  }
  return sums.map((value) => value / rows.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * A compact, amplitude-invariant visual/acoustic shape. The eight band shares
 * carry most of the identity signal; five spectral ratios add coarse texture.
 * This is intentionally small enough to inspect and reproduce.
 */
export function discoverySignature(features: number[]): number[] {
  const bands = normaliseBandProfile(features);
  const extras = [
    clamp(Number(features[CENTROID] ?? 0), 0, 1),
    clamp(Number(features[SPREAD] ?? 0), 0, 1),
    clamp(Number(features[ROLLOFF] ?? 0), 0, 1),
    clamp(Number(features[FLATNESS] ?? 0), 0, 1),
    clamp(Number(features[DOMINANT] ?? 0), 0, 1),
    clamp(Number(features[HARMONIC] ?? 0), 0, 1),
    clamp(Number(features[ZCR] ?? 0), 0, 1),
    clamp((Number(features[CREST] ?? 0) / 50) * 1, 0, 1),
    clamp((Number(features[LOW_HIGH] ?? 0) + 20) / 40, 0, 1),
  ];
  return l2([...bands.map((value) => value * 2.2), ...extras.map((value) => value * 0.8)]);
}

export function isUsableDiscoveryFrame(flags: string[]): boolean {
  return !flags.some((flag) => (DISQUALIFYING_FLAGS as readonly string[]).includes(flag));
}

function qualityFor(frames: number[][], flags: string[][]): DiscoveryQuality {
  let clipped = 0;
  let silent = 0;
  let low = 0;
  let usable = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const row = flags[index] ?? [];
    if (row.includes('CLIPPED')) clipped += 1;
    if (row.includes('SILENT')) silent += 1;
    if (row.includes('LOW_LEVEL')) low += 1;
    if (isUsableDiscoveryFrame(row)) usable += 1;
  }
  return {
    totalFrames: frames.length,
    usableFrames: usable,
    usableRatio: frames.length ? usable / frames.length : 0,
    clippedFrames: clipped,
    silentFrames: silent,
    lowLevelFrames: low,
  };
}

/** Deterministic, non-cryptographic fingerprint for duplicate-take rejection. */
export function fingerprintFrames(frames: number[][], frameFlags: string[][] = []): string {
  const text = JSON.stringify({ frames, frameFlags });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${frames.length}`;
}

function selectMedoids(vectors: number[][], maximum = 8): number[][] {
  if (vectors.length === 0) return [];
  const selected = [vectors[0]!];
  while (selected.length < Math.min(maximum, vectors.length)) {
    let best: number[] | null = null;
    let bestDistance = -1;
    for (const vector of vectors) {
      const nearest = Math.max(...selected.map((chosen) => cosine(vector, chosen)));
      const distance = 1 - nearest;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = vector;
      }
    }
    if (!best || bestDistance < 0.0005) break;
    selected.push(best);
  }
  return selected.map((row) => row.map((value) => round(value)));
}

export function buildDiscoveryProfile(
  objectId: string,
  takes: DiscoveryTrainingTake[],
  createdAt: string,
): DiscoveryProfile {
  const frames: number[][] = [];
  const trainingFingerprints: string[] = [];
  for (const take of takes) {
    const takeFlags = take.frames.map((_, index) => take.frameFlags?.[index] ?? []);
    trainingFingerprints.push(fingerprintFrames(take.frames, takeFlags));
    for (let index = 0; index < take.frames.length; index += 1) {
      const row = takeFlags[index] ?? [];
      if (!isUsableDiscoveryFrame(row)) continue;
      frames.push(take.frames[index]!);
    }
  }
  const signatures = frames.map((row) => discoverySignature(row));
  const medoids = selectMedoids(signatures);
  const bands = mean(frames.map((row) => normaliseBandProfile(row)));
  const status: DiscoveryProfile['status'] =
    takes.length >= DISCOVERY_PROTOCOL.trainingTakesPerObject &&
    signatures.length >= DISCOVERY_PROTOCOL.minTakeFrames * 2 &&
    medoids.length >= 1
      ? 'READY'
      : 'WEAK';
  return {
    schema: DISCOVERY_SCHEMA,
    method: DISCOVERY_METHOD,
    objectId,
    status,
    trainingTakeCount: takes.length,
    trainingFrameCount: takes.reduce((sum, take) => sum + take.frames.length, 0),
    usableFrameCount: frames.length,
    medoids,
    centroid: mean(signatures).map((value) => round(value)),
    bands: bands.map((value) => round(value)),
    trainingFingerprints,
    createdAt,
    limitations: [...DISCOVERY_LIMITATIONS],
  };
}

export function matchDiscoveryProfiles(
  frames: number[][],
  frameFlags: string[][],
  profiles: DiscoveryProfile[],
): DiscoveryMatchEvaluation {
  const quality = qualityFor(frames, frameFlags);
  const ready = profiles.filter((profile) => profile.status === 'READY' && profile.medoids.length > 0);
  if (ready.length < DISCOVERY_PROTOCOL.minEnrollments) {
    return {
      result: 'UNKNOWN',
      top: null,
      candidates: [],
      quality,
      reason: 'At least two READY object enrollments are required before discovery can offer a match.',
    };
  }
  if (quality.usableFrames < DISCOVERY_PROTOCOL.minMatchFrames) {
    return {
      result: 'UNKNOWN',
      top: null,
      candidates: [],
      quality,
      reason: `Only ${quality.usableFrames} usable frame(s) were captured; at least ${DISCOVERY_PROTOCOL.minMatchFrames} are required.`,
    };
  }

  const signatures = frames
    .map((row, index) => ({ row, flags: frameFlags[index] ?? [] }))
    .filter((entry) => isUsableDiscoveryFrame(entry.flags))
    .map((entry) => discoverySignature(entry.row));
  const candidates = ready
    .map((profile) => {
      const perFrame = signatures.map((signature) =>
        Math.max(...profile.medoids.map((medoid) => cosine(signature, medoid))),
      );
      return {
        objectId: profile.objectId,
        score: round(median(perFrame)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0]!;
  const second = candidates[1]!;
  const margin = round(best.score - second.score);
  const top = { objectId: best.objectId, score: best.score, margin };
  if (best.score < DISCOVERY_PROTOCOL.minScore) {
    return {
      result: 'UNKNOWN',
      top,
      candidates,
      quality,
      reason: `The closest enrollment scored ${(best.score * 100).toFixed(1)}%, below the ${(DISCOVERY_PROTOCOL.minScore * 100).toFixed(0)}% discovery threshold.`,
    };
  }
  if (margin < DISCOVERY_PROTOCOL.minMargin) {
    return {
      result: 'AMBIGUOUS',
      top,
      candidates,
      quality,
      reason: `The top two enrollments are only ${(margin * 100).toFixed(1)} points apart; a human must not treat this as a discovery.`,
    };
  }
  return {
    result: 'MATCH',
    top,
    candidates,
    quality,
    reason: `The closest enrollment scored ${(best.score * 100).toFixed(1)}% with a ${(margin * 100).toFixed(1)} point lead over the next object. This is still a hypothesis, not an identity claim.`,
  };
}

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function gate(
  id: string,
  label: string,
  threshold: string,
  observed: string,
  status: 'PASS' | 'FAIL' | 'OPEN',
  detail: string,
): DiscoveryGate {
  return { id, label, threshold, observed, status, detail };
}

export function evaluateDiscovery(
  trials: DiscoveryTrialCase[],
  profiles: DiscoveryProfile[],
): DiscoveryEvaluation {
  const ids = profiles.map((profile) => profile.objectId);
  // Target accuracy is measured only when the enrolled object is actually
  // present: baseline or distance. Noise-only conditions have the opposite
  // correct answer (rejection), so mixing them into target accuracy would
  // reward a match on a quiet room.
  const isNoiseCondition = (condition: DiscoveryCondition): boolean =>
    condition === 'ROOM_NOISE' || condition === 'APPLIANCE_NOISE';
  const target = trials.filter(
    (trial) => trial.truthObjectId !== null && trial.condition !== 'REPLAY' && !isNoiseCondition(trial.condition),
  );
  const unknown = trials.filter((trial) => trial.truthObjectId === null);
  const replay = trials.filter((trial) => trial.condition === 'REPLAY' && trial.truthObjectId !== null);
  const distance = target.filter(
    (trial) => trial.condition === 'DISTANCE_1M' || trial.condition === 'DISTANCE_2M',
  );
  const noise = trials.filter((trial) => isNoiseCondition(trial.condition));

  const targetCorrect = target.filter(
    (trial) => trial.result === 'MATCH' && trial.predictedObjectId === trial.truthObjectId,
  ).length;
  const falseMatches = unknown.filter((trial) => trial.result === 'MATCH').length;
  const unknownRejections = unknown.filter((trial) => trial.result !== 'MATCH').length;
  const replayCrossMatches = replay.filter(
    (trial) =>
      trial.result === 'MATCH' &&
      trial.predictedObjectId !== null &&
      trial.predictedObjectId !== trial.truthObjectId,
  ).length;
  const replayAccepted = replay.filter(
    (trial) => trial.result === 'MATCH' && trial.predictedObjectId === trial.truthObjectId,
  ).length;
  const distanceCorrect = distance.filter(
    (trial) => trial.result === 'MATCH' && trial.predictedObjectId === trial.truthObjectId,
  ).length;
  // A noise-only recording is correct when the matcher rejects it. A MATCH on
  // an off object or another appliance is a failure of environmental rejection.
  const noiseCorrect = noise.filter((trial) => trial.result !== 'MATCH').length;
  const latencies = trials.map((trial) => trial.latencyMs).sort((a, b) => a - b);
  const medianLatencyMs = median(latencies);
  const meanUsableRatio = trials.length
    ? trials.reduce((sum, trial) => sum + trial.quality.usableRatio, 0) / trials.length
    : 0;

  const columns = [...ids, 'UNKNOWN', 'AMBIGUOUS'];
  const rows = [...ids, 'UNKNOWN_OBJECT'];
  const matrix = rows.map(() => columns.map(() => 0));
  for (const trial of trials) {
    const truth = trial.truthObjectId ?? 'UNKNOWN_OBJECT';
    const predicted = trial.result === 'MATCH' ? trial.predictedObjectId ?? 'UNKNOWN' : trial.result;
    const row = rows.indexOf(truth);
    const column = columns.indexOf(predicted);
    if (row >= 0 && column >= 0) matrix[row]![column] += 1;
  }

  const conditionCounts = new Map<DiscoveryCondition, DiscoveryConditionSummary>();
  for (const condition of DISCOVERY_CONDITIONS) {
    conditionCounts.set(condition, {
      condition,
      trials: 0,
      correct: 0,
      falseMatches: 0,
      unknown: 0,
      ambiguous: 0,
    });
  }
  for (const trial of trials) {
    const entry = conditionCounts.get(trial.condition)!;
    entry.trials += 1;
    const rejectionCondition =
      trial.condition === 'ROOM_NOISE' || trial.condition === 'APPLIANCE_NOISE' || trial.condition === 'REPLAY';
    if (
      rejectionCondition
        ? trial.result !== 'MATCH'
        : trial.result === 'MATCH' && trial.truthObjectId && trial.predictedObjectId === trial.truthObjectId
    ) {
      entry.correct += 1;
    }
    if (trial.result === 'MATCH' && trial.truthObjectId === null) entry.falseMatches += 1;
    if (trial.result === 'UNKNOWN') entry.unknown += 1;
    if (trial.result === 'AMBIGUOUS') entry.ambiguous += 1;
  }

  const targetPerObject = ids.map((id) => target.filter((trial) => trial.truthObjectId === id).length);
  const minimumTargetsPerObject = targetPerObject.length ? Math.min(...targetPerObject) : 0;
  const targetAccuracy = target.length ? targetCorrect / target.length : 0;
  const falseMatchRate = unknown.length ? falseMatches / unknown.length : 0;
  const unknownRejectionRate = unknown.length ? unknownRejections / unknown.length : 0;
  const replayCrossMatchRate = replay.length ? replayCrossMatches / replay.length : 0;
  const distanceAccuracy = distance.length ? distanceCorrect / distance.length : 0;
  const noiseAccuracy = noise.length ? noiseCorrect / noise.length : 0;

  const gates: DiscoveryGate[] = [];
  gates.push(
    gate(
      'ENROLLMENTS',
      'Two distinct objects enrolled',
      `≥ ${DISCOVERY_PROTOCOL.minEnrollments}`,
      String(profiles.filter((profile) => profile.status === 'READY').length),
      profiles.filter((profile) => profile.status === 'READY').length >= DISCOVERY_PROTOCOL.minEnrollments
        ? 'PASS'
        : 'OPEN',
      'Both objects must have at least two usable live training takes and a READY profile.',
    ),
  );
  gates.push(
    gate(
      'TARGET_TRIALS',
      'Held-out target trials',
      `≥ ${DISCOVERY_PROTOCOL.minTargetTrials} total, ≥ ${DISCOVERY_PROTOCOL.minTargetTrialsPerObject}/object`,
      `${target.length} total, ${minimumTargetsPerObject} minimum per object`,
      target.length >= DISCOVERY_PROTOCOL.minTargetTrials &&
        minimumTargetsPerObject >= DISCOVERY_PROTOCOL.minTargetTrialsPerObject
        ? 'PASS'
        : 'OPEN',
      'Every target trial must be recorded after enrollment and must not reuse an enrollment take.',
    ),
  );
  gates.push(
    gate(
      'TARGET_ACCURACY',
      'Discovery accuracy',
      `≥ ${percent(DISCOVERY_PROTOCOL.targetAccuracy)}`,
      target.length ? `${percent(targetAccuracy)} (${targetCorrect}/${target.length})` : 'OPEN',
      !target.length ? 'OPEN' : targetAccuracy >= DISCOVERY_PROTOCOL.targetAccuracy ? 'PASS' : 'FAIL',
      'Correct MATCH on held-out target recordings when the enrolled object is present. Noise-only and replay trials are reported separately.',
    ),
  );
  gates.push(
    gate(
      'UNKNOWN_TRIALS',
      'Unknown-object trials',
      `≥ ${DISCOVERY_PROTOCOL.minUnknownTrials}`,
      String(unknown.length),
      unknown.length >= DISCOVERY_PROTOCOL.minUnknownTrials ? 'PASS' : 'OPEN',
      'A third object or a deliberately unmatched source must be tested as UNKNOWN.',
    ),
  );
  gates.push(
    gate(
      'UNKNOWN_REJECTION',
      'Unknown rejection',
      `≥ ${percent(DISCOVERY_PROTOCOL.unknownRejection)}`,
      unknown.length ? `${percent(unknownRejectionRate)} (${unknownRejections}/${unknown.length})` : 'OPEN',
      !unknown.length
        ? 'OPEN'
        : unknownRejectionRate >= DISCOVERY_PROTOCOL.unknownRejection
          ? 'PASS'
          : 'FAIL',
      'UNKNOWN or AMBIGUOUS is the correct result for an unenrolled object.',
    ),
  );
  gates.push(
    gate(
      'FALSE_MATCH',
      'False matches on unknowns',
      `≤ ${percent(DISCOVERY_PROTOCOL.falseMatchRate)}`,
      unknown.length ? `${percent(falseMatchRate)} (${falseMatches}/${unknown.length})` : 'OPEN',
      !unknown.length ? 'OPEN' : falseMatchRate <= DISCOVERY_PROTOCOL.falseMatchRate ? 'PASS' : 'FAIL',
      'Any MATCH on an unknown object is a false match and blocks a PASS.',
    ),
  );
  gates.push(
    gate(
      'REPLAY_TRIALS',
      'Replay trials',
      `≥ ${DISCOVERY_PROTOCOL.minReplayTrials}`,
      String(replay.length),
      replay.length >= DISCOVERY_PROTOCOL.minReplayTrials ? 'PASS' : 'OPEN',
      'Replay is measured separately; this prototype has no liveness detector.',
    ),
  );
  gates.push(
    gate(
      'REPLAY_CROSS_MATCH',
      'Replay cross-object matches',
      `≤ ${percent(DISCOVERY_PROTOCOL.replayCrossMatchRate)}`,
      replay.length ? `${percent(replayCrossMatchRate)} (${replayCrossMatches}/${replay.length})` : 'OPEN',
      !replay.length
        ? 'OPEN'
        : replayCrossMatchRate <= DISCOVERY_PROTOCOL.replayCrossMatchRate
          ? 'PASS'
          : 'FAIL',
      'A replay of object A must not be mistaken for enrolled object B. A replay matching its own object remains a known limitation, not an authentication result.',
    ),
  );
  gates.push(
    gate(
      'DISTANCE',
      'Distance trials',
      `≥ ${DISCOVERY_PROTOCOL.minDistanceTrials} at ≥ ${percent(DISCOVERY_PROTOCOL.distanceAccuracy)}`,
      distance.length ? `${percent(distanceAccuracy)} (${distanceCorrect}/${distance.length})` : 'OPEN',
      !distance.length
        ? 'OPEN'
        : distance.length >= DISCOVERY_PROTOCOL.minDistanceTrials &&
            distanceAccuracy >= DISCOVERY_PROTOCOL.distanceAccuracy
          ? 'PASS'
          : 'FAIL',
      'Report 1 m and 2 m separately in the condition table; do not claim beyond the tested distance.',
    ),
  );
  gates.push(
    gate(
      'NOISE',
      'Noise trials',
      `≥ ${DISCOVERY_PROTOCOL.minNoiseTrials} at ≥ ${percent(DISCOVERY_PROTOCOL.noiseAccuracy)}`,
      noise.length ? `${percent(noiseAccuracy)} (${noiseCorrect}/${noise.length})` : 'OPEN',
      !noise.length
        ? 'OPEN'
        : noise.length >= DISCOVERY_PROTOCOL.minNoiseTrials &&
            noiseAccuracy >= DISCOVERY_PROTOCOL.noiseAccuracy
          ? 'PASS'
          : 'FAIL',
      'A noise-only recording is correct when it is rejected (UNKNOWN or AMBIGUOUS). Room noise and another appliance are reported separately.',
    ),
  );
  gates.push(
    gate(
      'LATENCY',
      'Median decision latency',
      `≤ ${DISCOVERY_PROTOCOL.maxMedianLatencyMs} ms`,
      trials.length ? `${medianLatencyMs.toFixed(1)} ms` : 'OPEN',
      !trials.length ? 'OPEN' : medianLatencyMs <= DISCOVERY_PROTOCOL.maxMedianLatencyMs ? 'PASS' : 'FAIL',
      'Server-side matching time only. Capture time is not included.',
    ),
  );
  gates.push(
    gate(
      'QUALITY',
      'Mean usable-frame ratio',
      `≥ ${percent(DISCOVERY_PROTOCOL.minUsableRatio)}`,
      trials.length ? percent(meanUsableRatio) : 'OPEN',
      !trials.length ? 'OPEN' : meanUsableRatio >= DISCOVERY_PROTOCOL.minUsableRatio ? 'PASS' : 'FAIL',
      'Clipped, silent and low-level frames are excluded before matching.',
    ),
  );

  const status: DiscoveryEvaluation['status'] =
    trials.length === 0
      ? 'NOT_RUN'
      : gates.some((entry) => entry.status === 'OPEN')
        ? 'INCOMPLETE'
        : gates.some((entry) => entry.status === 'FAIL')
          ? 'FAIL'
          : 'PASS';

  return {
    status,
    metrics: {
      enrollmentCount: profiles.filter((profile) => profile.status === 'READY').length,
      trials: trials.length,
      targetTrials: target.length,
      targetCorrect,
      targetAccuracy,
      falseMatches,
      falseMatchRate,
      unknownTrials: unknown.length,
      unknownRejections,
      unknownRejectionRate,
      ambiguousResults: trials.filter((trial) => trial.result === 'AMBIGUOUS').length,
      replayTrials: replay.length,
      replayAccepted,
      replayCrossMatches,
      replayCrossMatchRate,
      distanceTrials: distance.length,
      distanceCorrect,
      distanceAccuracy,
      noiseTrials: noise.length,
      noiseCorrect,
      noiseAccuracy,
      medianLatencyMs,
      meanUsableRatio,
    },
    confusion: { columns, rows, matrix },
    conditions: [...conditionCounts.values()].filter((entry) => entry.trials > 0),
    gates,
  };
}

export function qualityFromFrames(frames: number[][], frameFlags: string[][]): DiscoveryQuality {
  return qualityFor(frames, frameFlags);
}
