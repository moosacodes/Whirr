import {
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  type QualityFlag,
} from './spec.ts';
import { soundprintScore, type Soundprint } from './soundprint.ts';

export type ClassLabel = 'idle' | 'active' | 'other';

export const CLASS_LABELS: readonly ClassLabel[] = ['idle', 'active', 'other'];

export type ModelStatus = 'READY' | 'LIMITED' | 'REJECTED';
export type ModelProvenance = 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';

export interface DecisionPolicy {
  /** Minimum smoothed p(active) to consider a frame strongly active. */
  activeThreshold: number;
  /** Minimum smoothed p(idle) for a confident idle frame. */
  idleThreshold: number;
  /** Required lead of p(active) over p(idle) for a confident active frame. */
  activeMargin: number;
  /** EMA smoothing factor applied to probabilities (0..1). */
  smoothing: number;
  /** Consecutive strong frames required to enter ACTIVE. */
  onFrames: number;
  /** Consecutive non-strong frames required to leave ACTIVE. */
  offFrames: number;
}

export const DEFAULT_POLICY: DecisionPolicy = {
  activeThreshold: 0.9,
  idleThreshold: 0.5,
  activeMargin: 0.1,
  smoothing: 0.45,
  onFrames: 4,
  offFrames: 5,
};

export interface ModelMetrics {
  method: 'LEAVE_ONE_TAKE_OUT';
  precision: number;
  recall: number;
  falseBillableRatio: number;
  billedActiveMs: number;
  trueActiveMs: number;
  falseBilledMs: number;
  nonActiveMs: number;
  frameAccuracy: number;
  confusion: number[][];
  confusionLabels: ClassLabel[];
  takeCounts: { idle: number; active: number; negative: number; transition: number };
  totalTakeFrames: number;
  totalDurationMs: number;
  perTake: Array<{
    takeId: string;
    label: string;
    billedActiveMs: number;
    durationMs: number;
  }>;
}

export interface BaselineMetrics {
  method: 'RMS_THRESHOLD';
  thresholdLogRms: number;
  precision: number;
  recall: number;
  falseBillableRatio: number;
  billedActiveMs: number;
}

export interface ModelArtifact {
  schema: 'whirr.model.v1';
  version: string;
  createdAt: string;
  algo: 'multinomial-logistic-regression';
  featureSpecVersion: string;
  featureNames: string[];
  classes: ClassLabel[];
  mean: number[];
  std: number[];
  weights: number[][];
  bias: number[];
  policy: DecisionPolicy;
  training: {
    takeCount: number;
    frameCount: number;
    durationMs: number;
    datasetHash: string;
    seed: number;
    iterations: number;
    learningRate: number;
    l2: number;
    classFrames: Record<ClassLabel, number>;
  };
  metrics: ModelMetrics;
  baseline: BaselineMetrics;
  featureImportance: Array<{ name: string; weight: number; abs: number }>;
  status: ModelStatus;
  statusReasons: string[];
  limitations: string[];
  provenance: ModelProvenance;
  /** Present on models trained after the acoustic passport was introduced. */
  soundprint?: Soundprint;
  notes?: string;
}

export interface FramePrediction {
  startMs: number;
  endMs: number;
  pIdle: number;
  pActive: number;
  pOther: number;
  flags: QualityFlag[];
  /** Cosine similarity to the enrolled soundprint, when one is active. */
  soundprintScore?: number;
  soundprintMismatch?: boolean;
}

export interface ProbabilityVector {
  idle: number;
  active: number;
  other: number;
}

function sigmoidStable(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

export function predictProbabilities(model: ModelArtifact, features: number[]): ProbabilityVector {
  if (features.length !== model.featureNames.length) {
    throw new Error(`Model expects ${model.featureNames.length} features, received ${features.length}`);
  }
  const logits = model.classes.map((_, classIndex) => {
    let value = model.bias[classIndex] ?? 0;
    const weights = model.weights[classIndex]!;
    for (let i = 0; i < features.length; i += 1) {
      const std = model.std[i] || 1;
      const z = (features[i]! - (model.mean[i] ?? 0)) / std;
      const w = weights[i] ?? 0;
      value += w * z;
    }
    return value;
  });
  const probs = softmax(logits);
  return {
    idle: probs[model.classes.indexOf('idle')] ?? 0,
    active: probs[model.classes.indexOf('active')] ?? 0,
    other: probs[model.classes.indexOf('other')] ?? 0,
  };
}

export function predictFrame(
  model: ModelArtifact,
  features: number[],
  flags: QualityFlag[],
  startMs: number,
  endMs: number,
): FramePrediction {
  const probs = predictProbabilities(model, features);
  const score =
    model.soundprint?.gateEnabled ? soundprintScore(model.soundprint, features) : undefined;
  const mismatch =
    score !== undefined && model.soundprint !== undefined && score < model.soundprint.matchThreshold;
  const effectiveFlags =
    mismatch && !flags.includes('SOUNDPRINT_MISMATCH')
      ? [...flags, 'SOUNDPRINT_MISMATCH' as const]
      : flags;
  return {
    startMs,
    endMs,
    pIdle: probs.idle,
    pActive: probs.active,
    pOther: probs.other,
    flags: effectiveFlags,
    ...(score !== undefined ? { soundprintScore: score, soundprintMismatch: mismatch } : {}),
  };
}

export interface FeatureContribution {
  name: string;
  value: number;
  contribution: number;
}

/**
 * A compact, deterministic explanation of the active-class logit for one
 * frame. It contains feature names and standardised contributions only; it
 * never carries audio. The explanation is metadata, not a new classifier.
 */
export function explainPrediction(
  model: ModelArtifact,
  features: number[],
  passportScore: number | undefined,
): {
  passportScore: number | null;
  topFeatures: FeatureContribution[];
  summary: string;
} {
  const activeIndex = Math.max(0, model.classes.indexOf('active'));
  const contributions = model.featureNames.map((name, index) => {
    const std = model.std[index] || 1;
    const z = (features[index]! - (model.mean[index] ?? 0)) / std;
    const contribution = z * (model.weights[activeIndex]?.[index] ?? 0);
    return { name, value: features[index]!, contribution };
  });
  const topFeatures = contributions
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);
  const direction = topFeatures[0]
    ? topFeatures[0].contribution >= 0
      ? 'toward active'
      : 'away from active'
    : 'no dominant feature';
  return {
    passportScore: passportScore ?? null,
    topFeatures,
    summary: `Leading evidence: ${topFeatures.map((item) => item.name).join(', ') || 'none'} (${direction}).`,
  };
}

export function argmaxClass(probs: ProbabilityVector): ClassLabel {
  if (probs.active >= probs.idle && probs.active >= probs.other) return 'active';
  if (probs.idle >= probs.other) return 'idle';
  return 'other';
}

/** Numerically stable logistic function re-exported for baselines and tests. */
export { sigmoidStable as sigmoid };

export const CLASSIFIER_VERSION = 'multinomial-logistic-regression-v1';

export function assertModelArtifact(value: unknown): asserts value is ModelArtifact {
  if (!value || typeof value !== 'object') throw new Error('Model artifact must be an object');
  const model = value as Partial<ModelArtifact>;
  if (model.schema !== 'whirr.model.v1') throw new Error('Unsupported model schema');
  if (model.featureSpecVersion !== FEATURE_SPEC_VERSION) throw new Error('Feature spec mismatch');
  if (!Array.isArray(model.featureNames) || model.featureNames.length !== FEATURE_NAMES.length) {
    throw new Error('Model feature list does not match the frozen feature spec');
  }
  if (!Array.isArray(model.classes) || model.classes.length !== 3) throw new Error('Invalid classes');
  if (!Array.isArray(model.weights) || model.weights.length !== 3) throw new Error('Invalid weights');
  if (!Array.isArray(model.bias) || model.bias.length !== 3) throw new Error('Invalid bias');
  if (model.soundprint !== undefined) {
    if (model.soundprint.schema !== 'whirr.soundprint.v1') throw new Error('Unsupported soundprint schema');
    if (!Array.isArray(model.soundprint.bands) || model.soundprint.bands.length !== 8) {
      throw new Error('Invalid soundprint bands');
    }
    if (typeof model.soundprint.gateEnabled !== 'boolean') throw new Error('Invalid soundprint gate');
    if (!Number.isFinite(model.soundprint.matchThreshold)) throw new Error('Invalid soundprint threshold');
  }
}
