import { predictFrame, type ModelArtifact } from './classifier.ts';
import { summariseQuality, type FeatureFrame } from './features.ts';
import { segmentPredictions, type MeterInterval } from './hysteresis.ts';
import { FEATURE_COUNT, FRAME_MS, type QualityFlag } from './spec.ts';

export type FieldTrialKind = 'THREE_CYCLE' | 'NOISE' | 'DISTANCE' | 'REPLAY';
export type FieldTrialTruth = 'OPERATING' | 'IDLE';

export const FIELD_TRIAL_KINDS: readonly FieldTrialKind[] = [
  'THREE_CYCLE',
  'NOISE',
  'DISTANCE',
  'REPLAY',
];

export interface FieldTimelineSegment {
  startMs: number;
  endMs: number;
  truth: FieldTrialTruth;
}

export interface FieldTrialInput {
  kind: FieldTrialKind;
  frames: number[][];
  frameFlags: string[][];
  timeline: FieldTimelineSegment[];
  durationMs: number;
}

export interface FieldRecordingQuality {
  frameCount: number;
  frameCoverage: number;
  clippedRatio: number;
  silentRatio: number;
  lowLevelRatio: number;
  usableFrames: number;
}

export interface FieldTrialMetrics {
  billedMs: number;
  expectedOperatingMs: number;
  idleTruthMs: number;
  trueBilledMs: number;
  falseBilledMs: number;
  missedOperatingMs: number;
  uncertainMs: number;
  precision: number;
  recall: number;
  falseBillableRatio: number;
  activeRatio: number;
  overbillingRatio: number;
  billingErrorMs: number;
  billingErrorRatio: number;
  cycles: number;
  meanActiveProbability: number;
  soundprintMismatchRatio: number;
}

export interface FieldTrialEvaluation {
  metrics: FieldTrialMetrics;
  quality: FieldRecordingQuality;
  intervals: Array<Pick<MeterInterval, 'startMs' | 'endMs' | 'state' | 'confidence'>>;
}

export const FIELD_GATE_THRESHOLDS = {
  precision: 0.95,
  recall: 0.9,
  falseBillableRatio: 0.02,
  overbillingRatio: 0.02,
  billingErrorRatio: 0.05,
  noiseFalseBillableRatio: 0.02,
  distanceActiveRatio: 0.5,
  replayActiveRatio: 0.05,
  maxSilentRatio: 0.2,
  maxClippedRatio: 0.1,
  minFrameCoverage: 0.85,
} as const;

export const FIELD_PROTOCOL = {
  schema: 'whirr.field-protocol.v1',
  cycles: 3,
  cycleIdleMs: 4_000,
  cycleOperatingMs: 5_000,
  cycleTailIdleMs: 4_000,
  cycleTotalMs: 31_000,
  noiseMs: 12_000,
  distanceMs: 12_000,
  replayMs: 12_000,
  minCycleDurationMs: 29_000,
  maxCycleDurationMs: 33_000,
  minSingleTrialMs: 10_000,
  maxSingleTrialMs: 16_000,
  gates: FIELD_GATE_THRESHOLDS,
} as const;

export function canonicalCycleTimeline(totalMs: number = FIELD_PROTOCOL.cycleTotalMs): FieldTimelineSegment[] {
  const segments: FieldTimelineSegment[] = [];
  let cursor = 0;
  const push = (durationMs: number, truth: FieldTrialTruth) => {
    segments.push({ startMs: cursor, endMs: cursor + durationMs, truth });
    cursor += durationMs;
  };
  for (let cycle = 0; cycle < FIELD_PROTOCOL.cycles; cycle += 1) {
    push(FIELD_PROTOCOL.cycleIdleMs, 'IDLE');
    push(FIELD_PROTOCOL.cycleOperatingMs, 'OPERATING');
  }
  push(FIELD_PROTOCOL.cycleTailIdleMs, 'IDLE');
  if (totalMs > cursor) {
    segments[segments.length - 1]!.endMs = totalMs;
  }
  return segments;
}

export function canonicalSingleTrialTimeline(
  kind: Exclude<FieldTrialKind, 'THREE_CYCLE'>,
  durationMs: number,
): FieldTimelineSegment[] {
  return [
    {
      startMs: 0,
      endMs: durationMs,
      truth: kind === 'DISTANCE' ? 'OPERATING' : 'IDLE',
    },
  ];
}

export function countOperatingSegments(timeline: FieldTimelineSegment[]): number {
  return timeline.filter((segment) => segment.truth === 'OPERATING').length;
}

/** Structural validation. The server uses the same rules as the guided UI. */
export function validateFieldTimeline(
  kind: FieldTrialKind,
  timeline: FieldTimelineSegment[],
  durationMs: number,
): string[] {
  const problems: string[] = [];
  if (timeline.length === 0) return ['Timeline is empty.'];
  if (timeline[0]!.startMs !== 0) problems.push('Timeline must start at 0 ms.');
  if (Math.abs(timeline[timeline.length - 1]!.endMs - durationMs) > 2) {
    problems.push('Timeline must end at the captured duration.');
  }
  for (let index = 0; index < timeline.length; index += 1) {
    const segment = timeline[index]!;
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.endMs <= segment.startMs) {
      problems.push(`Timeline segment ${index + 1} has an invalid range.`);
    }
    if (segment.truth !== 'OPERATING' && segment.truth !== 'IDLE') {
      problems.push(`Timeline segment ${index + 1} has an unknown truth label.`);
    }
    if (index > 0 && segment.startMs !== timeline[index - 1]!.endMs) {
      problems.push('Timeline segments must be contiguous.');
    }
  }
  if (problems.length > 0) return problems;

  if (kind === 'THREE_CYCLE') {
    if (durationMs < FIELD_PROTOCOL.minCycleDurationMs || durationMs > FIELD_PROTOCOL.maxCycleDurationMs) {
      problems.push(
        `The three-cycle trial must last ${FIELD_PROTOCOL.minCycleDurationMs / 1000}–${FIELD_PROTOCOL.maxCycleDurationMs / 1000} seconds.`,
      );
    }
    const operating = timeline.filter((segment) => segment.truth === 'OPERATING');
    if (operating.length !== FIELD_PROTOCOL.cycles) {
      problems.push(`Expected exactly ${FIELD_PROTOCOL.cycles} OPERATING segments.`);
    }
    for (const segment of operating) {
      const span = segment.endMs - segment.startMs;
      if (span < FIELD_PROTOCOL.cycleOperatingMs - 500 || span > FIELD_PROTOCOL.cycleOperatingMs + 500) {
        problems.push('Each ON phase must last about five seconds.');
        break;
      }
    }
    if (timeline[0]!.truth !== 'IDLE' || timeline[timeline.length - 1]!.truth !== 'IDLE') {
      problems.push('The recording must begin and end with the object off.');
    }
    if (timeline.some((segment) => segment.truth === 'IDLE' && segment.endMs - segment.startMs < 3_000)) {
      problems.push('Each OFF phase must last at least three seconds.');
    }
  } else {
    if (timeline.length !== 1) problems.push('This trial must contain one contiguous phase.');
    if (durationMs < FIELD_PROTOCOL.minSingleTrialMs || durationMs > FIELD_PROTOCOL.maxSingleTrialMs) {
      problems.push(
        `This trial must last ${FIELD_PROTOCOL.minSingleTrialMs / 1000}–${FIELD_PROTOCOL.maxSingleTrialMs / 1000} seconds.`,
      );
    }
    if (kind === 'DISTANCE' && timeline[0]!.truth !== 'OPERATING') {
      problems.push('The distance trial must be recorded with the object running.');
    }
    if ((kind === 'NOISE' || kind === 'REPLAY') && timeline[0]!.truth !== 'IDLE') {
      problems.push('This trial expects the recorded sound to be non-billable.');
    }
  }
  return problems;
}

export function validateFieldFrames(
  frames: number[][],
  frameFlags: string[][],
  durationMs: number,
): string[] {
  const problems: string[] = [];
  if (frames.length < 200) problems.push('The recording is too short to evaluate.');
  if (frameFlags.length !== 0 && frameFlags.length !== frames.length) {
    problems.push('Quality flags must align with frames.');
  }
  if (frames.some((frame) => frame.length !== FEATURE_COUNT || frame.some((value) => !Number.isFinite(value)))) {
    problems.push(`Every frame must contain ${FEATURE_COUNT} finite features from the frozen feature spec.`);
  }
  const coverage = frames.length * FRAME_MS / Math.max(1, durationMs);
  if (coverage < FIELD_GATE_THRESHOLDS.minFrameCoverage) {
    problems.push(
      `The capture delivered only ${(coverage * 100).toFixed(0)}% of the expected frames; keep the tab visible and the microphone connected.`,
    );
  }
  return problems;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Runs the frozen model over a held-out trial and compares the billable
 * intervals with the protocol's ground-truth ON/OFF timeline. Nothing is
 * supplied by the client except the captured features and the protocol
 * timeline; every metric is recomputed here.
 */
export function evaluateFieldTrial(model: ModelArtifact, input: FieldTrialInput): FieldTrialEvaluation {
  const durationMs = Math.max(1, input.durationMs);
  const predictions = input.frames.map((features, index) => {
    const flags = (input.frameFlags[index] ?? []) as QualityFlag[];
    const startMs = index * FRAME_MS;
    return predictFrame(model, features, flags, startMs, startMs + FRAME_MS);
  });
  const intervals = segmentPredictions(predictions, model.policy).map((interval) => ({
    startMs: Math.round(interval.startMs),
    endMs: Math.min(durationMs, Math.round(interval.endMs)),
    state: interval.state,
    confidence: interval.confidence,
  }));

  const billed = intervals.filter((interval) => interval.state === 'ACTIVE_CONFIDENT');
  const billedMs = billed.reduce((total, interval) => total + Math.max(0, interval.endMs - interval.startMs), 0);
  const operating = input.timeline.filter((segment) => segment.truth === 'OPERATING');
  const expectedOperatingMs = operating.reduce(
    (total, segment) => total + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const idleTruthMs = Math.max(0, durationMs - expectedOperatingMs);
  let trueBilledMs = 0;
  for (const interval of billed) {
    for (const segment of operating) {
      trueBilledMs += overlapMs(interval.startMs, interval.endMs, segment.startMs, Math.min(durationMs, segment.endMs));
    }
  }
  const falseBilledMs = Math.max(0, billedMs - trueBilledMs);
  const missedOperatingMs = Math.max(0, expectedOperatingMs - trueBilledMs);
  const uncertainMs = intervals
    .filter((interval) => interval.state === 'UNCERTAIN' || interval.state === 'DISCONNECTED')
    .reduce((total, interval) => total + Math.max(0, interval.endMs - interval.startMs), 0);
  const precision = billedMs > 0 ? trueBilledMs / billedMs : expectedOperatingMs > 0 ? 0 : 1;
  const recall = expectedOperatingMs > 0 ? trueBilledMs / expectedOperatingMs : 0;
  const falseBillableRatio = idleTruthMs > 0 ? falseBilledMs / idleTruthMs : 0;
  const activeRatio = billedMs / durationMs;
  const overbillingRatio =
    expectedOperatingMs > 0 ? Math.max(0, billedMs - expectedOperatingMs) / expectedOperatingMs : 0;
  const billingErrorMs = falseBilledMs + missedOperatingMs;
  const meanActiveProbability =
    predictions.length > 0
      ? predictions.reduce((total, prediction) => total + prediction.pActive, 0) / predictions.length
      : 0;
  const soundprintMismatchRatio =
    predictions.length > 0
      ? predictions.filter((prediction) => prediction.soundprintMismatch).length / predictions.length
      : 0;

  const featureFrames: FeatureFrame[] = input.frames.map((features, index) => ({
    endMs: (index + 1) * FRAME_MS,
    features,
    flags: (input.frameFlags[index] ?? []) as QualityFlag[],
  }));
  const summary = summariseQuality(featureFrames);

  return {
    metrics: {
      billedMs: Math.round(billedMs),
      expectedOperatingMs: Math.round(expectedOperatingMs),
      idleTruthMs: Math.round(idleTruthMs),
      trueBilledMs: Math.round(trueBilledMs),
      falseBilledMs: Math.round(falseBilledMs),
      missedOperatingMs: Math.round(missedOperatingMs),
      uncertainMs: Math.round(uncertainMs),
      precision,
      recall,
      falseBillableRatio,
      activeRatio,
      overbillingRatio,
      billingErrorMs: Math.round(billingErrorMs),
      billingErrorRatio: billingErrorMs / durationMs,
      cycles: input.kind === 'THREE_CYCLE' ? countOperatingSegments(input.timeline) : 0,
      meanActiveProbability,
      soundprintMismatchRatio,
    },
    quality: {
      frameCount: summary.frameCount,
      frameCoverage: summary.frameCount * FRAME_MS / durationMs,
      clippedRatio: summary.clippedRatio,
      silentRatio: summary.silentRatio,
      lowLevelRatio: summary.lowLevelRatio,
      usableFrames: summary.usableFrames,
    },
    intervals,
  };
}

export function trialMeetsThresholds(kind: FieldTrialKind, metrics: FieldTrialMetrics): boolean {
  switch (kind) {
    case 'THREE_CYCLE':
      return (
        metrics.cycles === FIELD_PROTOCOL.cycles &&
        metrics.precision >= FIELD_GATE_THRESHOLDS.precision &&
        metrics.recall >= FIELD_GATE_THRESHOLDS.recall &&
        metrics.falseBillableRatio <= FIELD_GATE_THRESHOLDS.falseBillableRatio &&
        metrics.overbillingRatio <= FIELD_GATE_THRESHOLDS.overbillingRatio &&
        metrics.billingErrorRatio <= FIELD_GATE_THRESHOLDS.billingErrorRatio
      );
    case 'NOISE':
      return metrics.falseBillableRatio <= FIELD_GATE_THRESHOLDS.noiseFalseBillableRatio;
    case 'DISTANCE':
      return metrics.activeRatio >= FIELD_GATE_THRESHOLDS.distanceActiveRatio;
    case 'REPLAY':
      return metrics.activeRatio <= FIELD_GATE_THRESHOLDS.replayActiveRatio;
    default:
      return false;
  }
}

export function recordingQualityPasses(quality: FieldRecordingQuality): boolean {
  return (
    quality.frameCoverage >= FIELD_GATE_THRESHOLDS.minFrameCoverage &&
    quality.silentRatio <= FIELD_GATE_THRESHOLDS.maxSilentRatio &&
    quality.clippedRatio <= FIELD_GATE_THRESHOLDS.maxClippedRatio
  );
}

export function fieldProtocolSummary(): string {
  return `3 guided ON/OFF cycles (${FIELD_PROTOCOL.cycleTotalMs / 1000}s), then separate ${FIELD_PROTOCOL.noiseMs / 1000}s noise, distance and replay trials.`;
}
