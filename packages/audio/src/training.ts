import {
  CLASS_LABELS,
  DEFAULT_POLICY,
  type BaselineMetrics,
  type ClassLabel,
  type DecisionPolicy,
  type ModelArtifact,
  type ModelMetrics,
  type ProbabilityVector,
} from './classifier.ts';
import { segmentPredictions, type MeterInterval, type MeterState } from './hysteresis.ts';
import { buildSoundprint } from './soundprint.ts';
import {
  DISQUALIFYING_FLAGS,
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  FRAME_MS,
  MIN_FRAMES_PER_TAKE,
  type QualityFlag,
} from './spec.ts';

export type TakeLabel = 'idle' | 'active' | 'negative' | 'transition';

export interface TrainingTake {
  id: string;
  label: TakeLabel;
  frames: number[][];
  /** Optional per-frame quality flags. */
  frameFlags?: string[][];
  durationMs?: number;
}

export interface TrainOptions {
  version: string;
  createdAt: string;
  datasetHash: string;
  provenance: 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';
  seed?: number;
  iterations?: number;
  foldIterations?: number;
  learningRate?: number;
  l2?: number;
  notes?: string;
}

interface LabelledFrames {
  take: TrainingTake;
  labelClass: ClassLabel;
  frames: number[][];
  flags: string[][];
}

export interface TrainingResult {
  artifact: ModelArtifact;
  rejected: boolean;
}

const CLASSIFIER_SEED = 0x5eed;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function classOfLabel(label: TakeLabel): ClassLabel {
  if (label === 'active') return 'active';
  if (label === 'idle') return 'idle';
  return 'other';
}

function prepare(takes: TrainingTake[]): LabelledFrames[] {
  return takes.map((take) => {
    const flags = take.frameFlags ?? [];
    const frames = take.frames.filter((frame, index) => {
      if (frame.length !== FEATURE_NAMES.length) return false;
      if (!frame.every((v) => Number.isFinite(v))) return false;
      const f = flags[index] ?? [];
      if (f.some((flag) => DISQUALIFYING_FLAGS.includes(flag as QualityFlag))) return false;
      return true;
    });
    const keptFlags = take.frameFlags
      ? take.frames
          .map((frame, index) => ({ frame, index }))
          .filter(({ frame, index }) => {
            if (frame.length !== FEATURE_NAMES.length) return false;
            if (!frame.every((v) => Number.isFinite(v))) return false;
            const f = flags[index] ?? [];
            return !f.some((flag) => DISQUALIFYING_FLAGS.includes(flag as QualityFlag));
          })
          .map(({ index }) => flags[index] ?? [])
      : frames.map(() => []);
    return { take, labelClass: classOfLabel(take.label), frames, flags: keptFlags };
  });
}

function standardisation(rows: number[][]): { mean: number[]; std: number[] } {
  const dims = FEATURE_NAMES.length;
  const mean = new Array<number>(dims).fill(0);
  const std = new Array<number>(dims).fill(0);
  if (rows.length === 0) {
    return { mean, std: std.map(() => 1) };
  }
  for (const row of rows) {
    for (let i = 0; i < dims; i += 1) mean[i] += row[i]!;
  }
  for (let i = 0; i < dims; i += 1) mean[i] /= rows.length;
  for (const row of rows) {
    for (let i = 0; i < dims; i += 1) {
      const diff = row[i]! - mean[i]!;
      std[i] += diff * diff;
    }
  }
  for (let i = 0; i < dims; i += 1) {
    std[i] = Math.sqrt(std[i] / rows.length);
    if (!Number.isFinite(std[i]) || std[i] < 1e-8) std[i] = 1;
  }
  return { mean, std };
}

function standardiseRow(row: number[], mean: number[], std: number[]): number[] {
  return row.map((v, i) => (v - mean[i]!) / (std[i] || 1));
}

export function trainLogisticRegression(
  rows: number[][],
  labels: ClassLabel[],
  opts: { iterations: number; learningRate: number; l2: number; seed: number },
): { weights: number[][]; bias: number[] } {
  const dims = rows.length ? rows[0]!.length : FEATURE_NAMES.length;
  const classes = CLASS_LABELS;
  const weights = classes.map(() => new Array<number>(dims).fill(0));
  const bias = classes.map(() => 0);
  const velocityW = classes.map(() => new Array<number>(dims).fill(0));
  const velocityB = classes.map(() => 0);
  const counts = classes.map((label) => labels.filter((l) => l === label).length);
  const total = labels.length || 1;
  // Balanced class weights so rare negatives are not ignored.
  const classWeights = counts.map((count) => (count > 0 ? total / (classes.length * count) : 0));
  const random = mulberry32(opts.seed);

  for (let iteration = 0; iteration < opts.iterations; iteration += 1) {
    const gradW = classes.map(() => new Array<number>(dims).fill(0));
    const gradB = classes.map(() => 0);
    for (let n = 0; n < rows.length; n += 1) {
      const row = rows[n]!;
      const label = labels[n]!;
      const logits = classes.map((_, c) => {
        let v = bias[c]!;
        const w = weights[c]!;
        for (let i = 0; i < dims; i += 1) v += w[i]! * row[i]!;
        return v;
      });
      const max = Math.max(...logits);
      const exps = logits.map((v) => Math.exp(v - max));
      const sum = exps.reduce((a, b) => a + b, 0) || 1;
      const weight = classWeights[classes.indexOf(label)] || 1;
      for (let c = 0; c < classes.length; c += 1) {
        const error = (exps[c]! / sum - (classes[c] === label ? 1 : 0)) * weight;
        gradB[c] = (gradB[c] ?? 0) + error;
        const gw = gradW[c]!;
        for (let i = 0; i < dims; i += 1) gw[i] += error * row[i]!;
      }
    }

    const scale = 1 / Math.max(1, rows.length);
    for (let c = 0; c < classes.length; c += 1) {
      velocityB[c] = 0.9 * velocityB[c]! - opts.learningRate * gradB[c]! * scale;
      bias[c] = bias[c]! + velocityB[c]!;
      const w = weights[c]!;
      const v = velocityW[c]!;
      const gw = gradW[c]!;
      for (let i = 0; i < dims; i += 1) {
        const gradient = gw[i]! * scale + opts.l2 * w[i]!;
        v[i] = 0.9 * v[i]! - opts.learningRate * gradient;
        w[i] = w[i]! + v[i]!;
      }
    }
    // Warm-up suppression only; jitter is unnecessary because updates are full batch.
    if (!Number.isFinite(random())) break;
  }

  return { weights, bias };
}

function buildPredictions(
  rows: number[][],
  flags: string[][],
  weights: number[][],
  bias: number[],
  mean: number[],
  std: number[],
  frameMs: number,
): ProbabilityVector[] {
  return rows.map((row) => {
    const z = standardiseRow(row, mean, std);
    const logits = CLASS_LABELS.map((_, c) => {
      let v = bias[c] ?? 0;
      const w = weights[c]!;
      for (let i = 0; i < z.length; i += 1) v += (w[i] ?? 0) * z[i]!;
      return v;
    });
    const max = Math.max(...logits);
    const exps = logits.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map((v) => v / sum);
    void frameMs;
    return {
      idle: probs[0]!,
      active: probs[1]!,
      other: probs[2]!,
    };
  });
}

function intervalsForTake(
  probs: ProbabilityVector[],
  flags: string[][],
  policy: DecisionPolicy,
  frameMs: number,
): MeterInterval[] {
  const predictions = probs.map((p, index) => ({
    startMs: index * frameMs,
    endMs: (index + 1) * frameMs,
    pIdle: p.idle,
    pActive: p.active,
    pOther: p.other,
    flags: (flags[index] ?? []) as QualityFlag[],
  }));
  return segmentPredictions(predictions, policy);
}

interface MetricsAccumulator {
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
  perTake: Array<{ takeId: string; label: string; billedActiveMs: number; durationMs: number }>;
}

function evaluateCandidate(
  labelled: LabelledFrames[],
  predictionsByTake: Map<string, ProbabilityVector[]>,
  policy: DecisionPolicy,
): MetricsAccumulator {
  let billed = 0;
  let trueBilled = 0;
  let falseBilled = 0;
  let nonActive = 0;
  let trueActive = 0;
  let totalFrames = 0;
  let correctFrames = 0;
  const confusion = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const takeCounts = { idle: 0, active: 0, negative: 0, transition: 0 };
  const perTake: MetricsAccumulator['perTake'] = [];
  let totalDurationMs = 0;

  for (const item of labelled) {
    const probs = predictionsByTake.get(item.take.id) ?? [];
    takeCounts[item.take.label] += 1;
    const frames = item.frames.length;
    const durationMs = item.take.durationMs ?? frames * FRAME_MS;
    totalDurationMs += durationMs;
    totalFrames += frames;
    const intervals = intervalsForTake(probs, item.flags, policy, FRAME_MS);
    let activeMs = 0;
    for (const interval of intervals) {
      if (interval.state === ('ACTIVE_CONFIDENT' as MeterState)) {
        activeMs += interval.endMs - interval.startMs;
      }
    }
    billed += activeMs;
    if (item.labelClass === 'active') {
      trueBilled += activeMs;
      trueActive += durationMs;
    } else {
      falseBilled += activeMs;
      nonActive += durationMs;
    }
    perTake.push({ takeId: item.take.id, label: item.take.label, billedActiveMs: activeMs, durationMs });

    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i]!;
      const predicted: ClassLabel =
        p.active >= p.idle && p.active >= p.other ? 'active' : p.idle >= p.other ? 'idle' : 'other';
      const actual = item.labelClass;
      confusion[CLASS_LABELS.indexOf(actual)]![CLASS_LABELS.indexOf(predicted)]! += 1;
      if (predicted === actual) correctFrames += 1;
    }
  }

  return {
    precision: billed > 0 ? trueBilled / billed : 0,
    recall: trueActive > 0 ? trueBilled / trueActive : 0,
    falseBillableRatio: nonActive > 0 ? falseBilled / nonActive : 0,
    billedActiveMs: Math.round(billed),
    trueActiveMs: Math.round(trueActive),
    falseBilledMs: Math.round(falseBilled),
    nonActiveMs: Math.round(nonActive),
    frameAccuracy: totalFrames > 0 ? correctFrames / totalFrames : 0,
    confusion,
    confusionLabels: [...CLASS_LABELS],
    takeCounts,
    totalTakeFrames: totalFrames,
    totalDurationMs: Math.round(totalDurationMs),
    perTake,
  };
}

function candidateThresholds(): number[] {
  const out: number[] = [];
  for (let t = 0.5; t <= 0.99001; t += 0.01) out.push(Number(t.toFixed(3)));
  return out;
}

function scoreCandidate(metrics: MetricsAccumulator): number {
  // Precision-first objective: maximise recall subject to precision, then FBT.
  const precisionPenalty = metrics.precision < 0.95 ? (0.95 - metrics.precision) * 10 : 0;
  const fbtPenalty = metrics.falseBillableRatio > 0.02 ? (metrics.falseBillableRatio - 0.02) * 5 : 0;
  return metrics.recall - precisionPenalty - fbtPenalty;
}

function evaluateRmsBaseline(labelled: LabelledFrames[]): BaselineMetrics {
  if (labelled.length === 0) {
    return {
      method: 'RMS_THRESHOLD',
      thresholdLogRms: -2,
      precision: 0,
      recall: 0,
      falseBillableRatio: 0,
      billedActiveMs: 0,
    };
  }
  let best: BaselineMetrics | null = null;
  for (let threshold = -3.8; threshold <= -0.4; threshold += 0.04) {
    let billed = 0;
    let trueBilled = 0;
    let falseBilled = 0;
    let nonActive = 0;
    let trueActive = 0;
    for (const item of labelled) {
      let activeFrames = 0;
      for (const row of item.frames) if ((row[0] ?? -10) > threshold) activeFrames += 1;
      const activeMs = activeFrames * FRAME_MS;
      const durationMs = item.take.durationMs ?? item.frames.length * FRAME_MS;
      billed += activeMs;
      if (item.labelClass === 'active') {
        trueBilled += activeMs;
        trueActive += durationMs;
      } else {
        falseBilled += activeMs;
        nonActive += durationMs;
      }
    }
    const precision = billed > 0 ? trueBilled / billed : 0;
    const recall = trueActive > 0 ? trueBilled / trueActive : 0;
    const fbt = nonActive > 0 ? falseBilled / nonActive : 0;
    const candidate: BaselineMetrics = {
      method: 'RMS_THRESHOLD',
      thresholdLogRms: Number(threshold.toFixed(3)),
      precision,
      recall,
      falseBillableRatio: fbt,
      billedActiveMs: Math.round(billed),
    };
    if (!best) best = candidate;
    else {
      const bestScore = scoreCandidate({
        ...emptyMetrics(),
        precision: best.precision,
        recall: best.recall,
        falseBillableRatio: best.falseBillableRatio,
      });
      const candidateScore = scoreCandidate({
        ...emptyMetrics(),
        precision: candidate.precision,
        recall: candidate.recall,
        falseBillableRatio: candidate.falseBillableRatio,
      });
      if (candidateScore > bestScore) best = candidate;
    }
  }
  return best!;
}

function emptyMetrics(): MetricsAccumulator {
  return {
    precision: 0,
    recall: 0,
    falseBillableRatio: 0,
    billedActiveMs: 0,
    trueActiveMs: 0,
    falseBilledMs: 0,
    nonActiveMs: 0,
    frameAccuracy: 0,
    confusion: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    confusionLabels: [...CLASS_LABELS],
    takeCounts: { idle: 0, active: 0, negative: 0, transition: 0 },
    totalTakeFrames: 0,
    totalDurationMs: 0,
    perTake: [],
  };
}

export function trainModelFromTakes(takes: TrainingTake[], opts: TrainOptions): TrainingResult {
  const seed = opts.seed ?? CLASSIFIER_SEED;
  const iterations = opts.iterations ?? 600;
  const foldIterations = opts.foldIterations ?? 320;
  const learningRate = opts.learningRate ?? 0.14;
  const l2 = opts.l2 ?? 1e-4;

  const labelled = prepare(takes);
  const allRows: number[][] = [];
  const allLabels: ClassLabel[] = [];
  for (const item of labelled) {
    for (const frame of item.frames) {
      allRows.push(frame);
      allLabels.push(item.labelClass);
    }
  }

  const reasons: string[] = [];
  const takeCounts = { idle: 0, active: 0, negative: 0, transition: 0 };
  for (const item of labelled) {
    takeCounts[item.take.label] += 1;
    if (item.frames.length < MIN_FRAMES_PER_TAKE) {
      reasons.push(
        `The ${item.take.label} take ${item.take.id} is too short (${item.frames.length} usable frames; need ${MIN_FRAMES_PER_TAKE}).`,
      );
    }
  }
  if (takeCounts.idle < 2) reasons.push('Record at least two separate idle takes of 5+ seconds.');
  if (takeCounts.active < 2) reasons.push('Record at least two separate active takes of 5+ seconds.');
  if (takeCounts.negative < 1) {
    reasons.push('Record at least one background/negative take (other appliance, speech or room noise).');
  }
  const idleFrames = labelled
    .filter((t) => t.labelClass === 'idle')
    .reduce((sum, t) => sum + t.frames.length, 0);
  const activeFrames = labelled
    .filter((t) => t.labelClass === 'active')
    .reduce((sum, t) => sum + t.frames.length, 0);
  if (idleFrames < 120) reasons.push('Not enough usable idle audio. Record a longer, quieter idle take.');
  if (activeFrames < 120) reasons.push('Not enough usable active audio. Record a longer active take.');

  const classFrames: Record<ClassLabel, number> = {
    idle: idleFrames,
    active: activeFrames,
    other: labelled
      .filter((t) => t.labelClass === 'other')
      .reduce((sum, t) => sum + t.frames.length, 0),
  };
  for (const label of CLASS_LABELS) {
    if (classFrames[label] === 0) reasons.push(`No usable ${label} frames after quality filtering.`);
  }

  // Acoustic separation check: active must be meaningfully louder than idle.
  const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const idleRms = labelled
    .filter((t) => t.labelClass === 'idle')
    .flatMap((t) => t.frames.map((f) => f[0] ?? -10));
  const activeRms = labelled
    .filter((t) => t.labelClass === 'active')
    .flatMap((t) => t.frames.map((f) => f[0] ?? -10));
  const separation = median(activeRms) - median(idleRms);
  if (idleRms.length && activeRms.length && separation < 0.15) {
    reasons.push(
      'Idle and active recordings have almost the same loudness. Move the microphone closer to the object or pick a louder operating state.',
    );
  }

  const hardDataFailure = reasons.length > 0;

  // Build session-held-out (leave-one-take-out) predictions.
  const candidates = candidateThresholds();
  const foldPredictions = new Map<string, ProbabilityVector[]>();
  for (const heldOut of labelled) {
    const trainRows: number[][] = [];
    const trainLabels: ClassLabel[] = [];
    for (const item of labelled) {
      if (item.take.id === heldOut.take.id) continue;
      for (const frame of item.frames) {
        trainRows.push(frame);
        trainLabels.push(item.labelClass);
      }
    }
    if (trainRows.length === 0 || heldOut.frames.length === 0) continue;
    const { mean, std } = standardisation(trainRows);
    const scaled = trainRows.map((row) => standardiseRow(row, mean, std));
    const { weights, bias } = trainLogisticRegression(scaled, trainLabels, {
      iterations: foldIterations,
      learningRate,
      l2,
      seed,
    });
    const probs = buildPredictions(heldOut.frames, heldOut.flags, weights, bias, mean, std, FRAME_MS);
    foldPredictions.set(heldOut.take.id, probs);
  }

  let chosenPolicy: DecisionPolicy = { ...DEFAULT_POLICY };
  let chosenMetrics: MetricsAccumulator | null = null;
  let chosenScore = -Infinity;
  if (!hardDataFailure) {
    for (const threshold of candidates) {
      const policy: DecisionPolicy = { ...DEFAULT_POLICY, activeThreshold: threshold };
      const metrics = evaluateCandidate(labelled, foldPredictions, policy);
      const score = scoreCandidate(metrics);
      if (score > chosenScore + 1e-9) {
        chosenScore = score;
        chosenMetrics = metrics;
        chosenPolicy = policy;
      }
    }
  }

  // Final model uses every usable frame.
  const { mean, std } = standardisation(allRows);
  const scaledAll = allRows.map((row) => standardiseRow(row, mean, std));
  const { weights, bias } = trainLogisticRegression(scaledAll, allLabels, {
    iterations,
    learningRate,
    l2,
    seed,
  });

  const metrics: MetricsAccumulator =
    chosenMetrics ??
    evaluateCandidate(labelled, foldPredictions, chosenPolicy);
  const baseline = evaluateRmsBaseline(labelled);

  const importance = FEATURE_NAMES.map((name, index) => {
    const activeWeight = weights[CLASS_LABELS.indexOf('active')]![index] ?? 0;
    const idleWeight = weights[CLASS_LABELS.indexOf('idle')]![index] ?? 0;
    const weight = activeWeight - idleWeight;
    return { name, weight, abs: Math.abs(weight) };
  })
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 10);

  const statusReasons = [...reasons];
  let status: ModelArtifact['status'] = 'READY';
  if (!hardDataFailure) {
    if (metrics.precision >= 0.95 && metrics.falseBillableRatio <= 0.02 && metrics.recall >= 0.4) {
      status = 'READY';
    } else if (metrics.precision >= 0.85 && metrics.falseBillableRatio <= 0.08 && metrics.recall >= 0.35) {
      status = 'LIMITED';
      statusReasons.push(
        `Held-out precision is ${(metrics.precision * 100).toFixed(1)}% with ${(metrics.falseBillableRatio * 100).toFixed(1)}% false billable time. Billing requires operator review of every session.`,
      );
    } else {
      status = 'REJECTED';
      statusReasons.push(
        `Held-out precision ${(metrics.precision * 100).toFixed(1)}% / false billable ${(metrics.falseBillableRatio * 100).toFixed(1)}% does not meet the billing safety floor. Retake clearer idle and active samples.`,
      );
    }
  } else {
    status = 'REJECTED';
  }

  const totalDurationMs = labelled.reduce(
    (sum, item) => sum + (item.take.durationMs ?? item.frames.length * FRAME_MS),
    0,
  );

  const activeFrameRows = labelled
    .filter((item) => item.labelClass === 'active')
    .flatMap((item) => item.frames);
  const nonActiveFrameRows = labelled
    .filter((item) => item.labelClass !== 'active')
    .flatMap((item) => item.frames);
  const soundprint = buildSoundprint(activeFrameRows, nonActiveFrameRows, takeCounts.active);

  const limitations = [
    'The acoustic passport is a calibration-fit consistency check, not an anti-spoof or identity guarantee. A similar machine can share the same spectral shape.',
    'Audio-only sensing cannot detect speaker playback of a previously recorded machine. Supervised venues are required.',
    'Two identical machines running at the same time cannot be reliably distinguished by one microphone.',
    'A renter-controlled phone or laptop cannot secure an unattended object; this system does not physically lock anything.',
    'Tab suspension, sleep or microphone loss stops accrual, but creates an evidence gap that is not billed.',
    'The classifier is trained on one object in one acoustic environment; it is not a universal appliance recogniser.',
  ];
  if (opts.provenance === 'SYNTHETIC_REFERENCE') {
    limitations.unshift(
      'This bundled model is trained on procedurally synthesised fixtures, not on a physical appliance. Its metrics demonstrate the pipeline only and must not be read as real-world accuracy.',
    );
  }

  if (!soundprint) {
    limitations.push(
      'No acoustic passport could be enrolled because there were not enough usable active and non-active frames.',
    );
  } else if (!soundprint.gateEnabled) {
    limitations.push(
      'The acoustic passport is WEAK: active and non-active calibration profiles overlapped, so the identity gate is disabled rather than guessed.',
    );
  }

  const artifact: ModelArtifact = {
    schema: 'whirr.model.v1',
    version: opts.version,
    createdAt: opts.createdAt,
    algo: 'multinomial-logistic-regression',
    featureSpecVersion: FEATURE_SPEC_VERSION,
    featureNames: [...FEATURE_NAMES],
    classes: [...CLASS_LABELS],
    mean,
    std,
    weights,
    bias,
    policy: chosenPolicy,
    training: {
      takeCount: labelled.length,
      frameCount: allRows.length,
      durationMs: Math.round(totalDurationMs),
      datasetHash: opts.datasetHash,
      seed,
      iterations,
      learningRate,
      l2,
      classFrames,
    },
    metrics: {
      ...metrics,
      method: 'LEAVE_ONE_TAKE_OUT',
    } as ModelMetrics,
    baseline,
    featureImportance: importance,
    status,
    statusReasons: [...new Set(statusReasons)],
    limitations,
    provenance: opts.provenance,
    ...(soundprint ? { soundprint } : {}),
    notes: opts.notes,
  };

  return { artifact, rejected: status === 'REJECTED' };
}
