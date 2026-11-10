import { canonicalJson, sha256HexSync } from '../../protocol/src/index.ts';
import type { QualityFlag } from './spec.ts';
import { DISQUALIFYING_FLAGS, FEATURE_NAMES } from './spec.ts';
import type { TakeLabel } from './training.ts';

export const EVENT_CLASSES = ['IDLE', 'RUNNING', 'BACKGROUND', 'INTERRUPTED'] as const;
export type EventClass = (typeof EVENT_CLASSES)[number];

/**
 * Only these classes are learned acoustic identities. START, RUNNING and
 * EXPECTED_STOP are temporal contract states, and INTERRUPTED is normally
 * inferred from an early return to idle. A transition capture is optional
 * negative evidence, never a required acoustic completion claim.
 */
export const CORE_EVENT_CLASSES = ['IDLE', 'RUNNING', 'BACKGROUND'] as const;

export type EventProvenance = 'SYNTHETIC_REFERENCE' | 'USER_CALIBRATION';

export interface EventDemonstration {
  id: string;
  objectId: string;
  label: TakeLabel;
  frames: number[][];
  frameFlags?: string[][];
  durationMs: number;
  featureSpecVersion: string;
  source: 'live' | 'import' | 'synthetic';
  provenance: EventProvenance;
  sessionGroup: string;
  deviceLabel?: string;
  notes?: string;
  createdAt: string;
}

export interface EventClassMetrics {
  precision: number;
  recall: number;
  support: number;
}

export interface EventModelArtifact {
  schema: 'whirr.event-model.v1';
  version: string;
  createdAt: string;
  featureSpecVersion: string;
  featureNames: string[];
  classes: EventClass[];
  mean: number[];
  std: number[];
  centroids: number[][];
  /** Per-demonstration centroids. Multiple prototypes let one class contain distinct machines or rooms. */
  prototypes?: number[][][];
  policy: {
    minTopSimilarity: number;
    minMargin: number;
    minUsableFrames: number;
  };
  training: {
    takeCount: number;
    frameCount: number;
    durationMs: number;
    datasetHash: string;
    groupCount: number;
    provenance: EventProvenance;
    takeIds: string[];
    classTakes: Record<EventClass, number>;
  };
  metrics: {
    method: 'LEAVE_ONE_TAKE_OUT';
    frameAccuracy: number;
    macroRecall: number;
    perClass: Record<EventClass, EventClassMetrics>;
    confusion: number[][];
    confusionLabels: EventClass[];
    unknownRate: number;
  };
  status: 'READY' | 'LIMITED' | 'REJECTED';
  statusReasons: string[];
  limitations: string[];
}

export interface EventPrediction {
  event: EventClass | 'UNKNOWN';
  similarity: number;
  margin: number;
  scores: Array<{ event: EventClass; similarity: number }>;
}

export interface EventTrainingResult {
  artifact: EventModelArtifact;
  accepted: boolean;
}

const CLASS_OF_LABEL: Record<TakeLabel, EventClass> = {
  idle: 'IDLE',
  active: 'RUNNING',
  negative: 'BACKGROUND',
  transition: 'INTERRUPTED',
};

const LABEL_OF_CLASS: Record<EventClass, TakeLabel> = {
  IDLE: 'idle',
  RUNNING: 'active',
  BACKGROUND: 'negative',
  INTERRUPTED: 'transition',
};

function sanitiseTake(take: EventDemonstration): { frames: number[][]; flags: string[][] } {
  const flags = take.frameFlags ?? [];
  const frames: number[][] = [];
  const keptFlags: string[][] = [];
  take.frames.forEach((frame, index) => {
    if (frame.length !== FEATURE_NAMES.length || !frame.every((value) => Number.isFinite(value))) return;
    const frameFlags = flags[index] ?? [];
    if (frameFlags.some((flag) => DISQUALIFYING_FLAGS.includes(flag as QualityFlag))) return;
    frames.push(frame);
    keptFlags.push(frameFlags);
  });
  return { frames, flags: keptFlags };
}

function standardisation(rows: number[][]): { mean: number[]; std: number[] } {
  const dims = FEATURE_NAMES.length;
  const mean = new Array<number>(dims).fill(0);
  const std = new Array<number>(dims).fill(1);
  if (rows.length === 0) return { mean, std };
  for (const row of rows) for (let i = 0; i < dims; i += 1) mean[i] += row[i]!;
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

function standardise(row: number[], mean: number[], std: number[]): number[] {
  return row.map((value, index) => (value - mean[index]!) / (std[index] || 1));
}

function centroidOf(rows: number[][]): number[] {
  const dims = FEATURE_NAMES.length;
  const centroid = new Array<number>(dims).fill(0);
  if (rows.length === 0) return centroid;
  for (const row of rows) for (let i = 0; i < dims; i += 1) centroid[i] += row[i]!;
  for (let i = 0; i < dims; i += 1) centroid[i] /= rows.length;
  return centroid;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function ranking(row: number[], prototypes: number[][][]): EventPrediction {
  const scores = EVENT_CLASSES.map((event, index) => ({
    event,
    similarity: Math.max(0, ...(prototypes[index] ?? []).map((prototype) => cosine(row, prototype))),
  })).sort((a, b) => b.similarity - a.similarity || a.event.localeCompare(b.event));
  const top = scores[0]!;
  const second = scores[1] ?? { event: 'UNKNOWN' as const, similarity: 0 };
  const margin = top.similarity - second.similarity;
  return {
    event: top.event,
    similarity: top.similarity,
    margin,
    scores,
  };
}

export function classifyEventFrame(
  artifact: EventModelArtifact,
  features: number[],
  frameFlags: string[] = [],
): EventPrediction & { refused: boolean; reason: string | null } {
  if (features.length !== FEATURE_NAMES.length || !features.every((value) => Number.isFinite(value))) {
    return { event: 'UNKNOWN', similarity: 0, margin: 0, scores: [], refused: true, reason: 'Malformed feature vector.' };
  }
  if (frameFlags.some((flag) => DISQUALIFYING_FLAGS.includes(flag as QualityFlag))) {
    return { event: 'UNKNOWN', similarity: 0, margin: 0, scores: [], refused: true, reason: 'Frame quality gate failed.' };
  }
  const row = standardise(features, artifact.mean, artifact.std);
  const prototypes = artifact.prototypes ?? artifact.centroids.map((centroid) => [centroid]);
  const prediction = ranking(row, prototypes);
  if (prediction.similarity < artifact.policy.minTopSimilarity) {
    return { ...prediction, refused: true, reason: 'No learned event is similar enough to this sound.' };
  }
  if (prediction.margin < artifact.policy.minMargin) {
    return { ...prediction, refused: true, reason: 'Two event classes are too close to call.' };
  }
  return { ...prediction, refused: false, reason: null };
}

function trainCentroids(
  takes: EventDemonstration[],
  standardised: Map<string, number[][]>,
  mean: number[],
  std: number[],
): number[][] {
  return EVENT_CLASSES.map((event) => {
    const rows = takes
      .filter((take) => CLASS_OF_LABEL[take.label] === event)
      .flatMap((take) => standardised.get(take.id) ?? []);  return centroidOf(rows);
});
}

function trainPrototypes(
  takes: EventDemonstration[],
  standardised: Map<string, number[][]>,
): number[][][] {
  return EVENT_CLASSES.map((event) =>
    takes
      .filter((take) => CLASS_OF_LABEL[take.label] === event)
      .map((take) => centroidOf(standardised.get(take.id) ?? []))
      .filter((prototype) => prototype.some((value) => value !== 0)),
  );
}

export function trainEventModel(input: {
  takes: EventDemonstration[];
  version: string;
  createdAt: string;
  featureSpecVersion: string;
  provenance: EventProvenance;
}): EventTrainingResult {
  const clean = input.takes
    .map((take) => ({ take, ...sanitiseTake(take) }))
    .filter((entry) => entry.frames.length > 0);
  const allRows = clean.flatMap((entry) => entry.frames);
  const datasetHash = sha256HexSync(canonicalJson({
    schema: 'whirr.event-dataset.v1',
    featureSpecVersion: input.featureSpecVersion,
    provenance: input.provenance,
    takes: input.takes.map((take) => ({
      id: take.id,
      objectId: take.objectId,
      label: take.label,
      frameCount: take.frames.length,
      durationMs: take.durationMs,
      source: take.source,
      sessionGroup: take.sessionGroup,
      createdAt: take.createdAt,
    })),
  }));
  const { mean, std } = standardisation(allRows);
  const standardised = new Map<string, number[][]>();
  for (const entry of clean) {
    standardised.set(entry.take.id, entry.frames.map((row) => standardise(row, mean, std)));
  }
  const centroids = trainCentroids(clean.map((entry) => entry.take), standardised, mean, std);
  const prototypes = trainPrototypes(clean.map((entry) => entry.take), standardised);

  const confusion = EVENT_CLASSES.map(() => EVENT_CLASSES.map(() => 0));
  const classTakes = Object.fromEntries(EVENT_CLASSES.map((event) => [event, 0])) as Record<EventClass, number>;
  const classFrames = Object.fromEntries(EVENT_CLASSES.map((event) => [event, 0])) as Record<EventClass, number>;
  let totalFrames = 0;
  let unknownFrames = 0;
  let correctFrames = 0;

  for (const heldOut of clean) {
    const truth = CLASS_OF_LABEL[heldOut.take.label];
    classTakes[truth] += 1;
    totalFrames += heldOut.frames.length;
    classFrames[truth] += heldOut.frames.length;
    const training = clean.filter((entry) => entry.take.id !== heldOut.take.id);
    const foldPrototypes = trainPrototypes(training.map((entry) => entry.take), standardised);
    for (const row of standardised.get(heldOut.take.id) ?? []) {
      const prediction = ranking(row, foldPrototypes);
      if (prediction.event === 'UNKNOWN' || prediction.similarity < 0.5 || prediction.margin < 0.01) {
        unknownFrames += 1;
        continue;
      }
      const predictedIndex = EVENT_CLASSES.indexOf(prediction.event);
      const truthIndex = EVENT_CLASSES.indexOf(truth);
      confusion[truthIndex]![predictedIndex] = (confusion[truthIndex]![predictedIndex] ?? 0) + 1;
      if (prediction.event === truth) correctFrames += 1;
    }
  }

  const perClass = Object.fromEntries(
    EVENT_CLASSES.map((event, classIndex) => {
      const support = classFrames[event] ?? 0;
      const truePositive = confusion[classIndex]![classIndex] ?? 0;
      const predicted = confusion.reduce((sum, row) => sum + (row[classIndex] ?? 0), 0);
      return [
        event,
        {
          precision: predicted > 0 ? truePositive / predicted : 0,
          recall: support > 0 ? truePositive / support : 0,
          support,
        },
      ];
    }),
  ) as Record<EventClass, EventClassMetrics>;
  const macroRecall =
    CORE_EVENT_CLASSES.reduce((sum, event) => sum + perClass[event].recall, 0) / CORE_EVENT_CLASSES.length;

  const statusReasons: string[] = [];
  const missing = CORE_EVENT_CLASSES.filter((event) => (classTakes[event] ?? 0) < 2);
  for (const event of missing) statusReasons.push(`${event} has fewer than two separate demonstrations.`);
  for (const event of CORE_EVENT_CLASSES) {
    if (perClass[event].support > 0 && perClass[event].recall < 0.6) {
      statusReasons.push(`${event} held-out recall is ${(perClass[event].recall * 100).toFixed(1)}%, below 60%.`);
    }
  }
  if (macroRecall < 0.65) statusReasons.push(`Macro recall is ${(macroRecall * 100).toFixed(1)}%, below 65%.`);
  if (totalFrames < 240) statusReasons.push('Fewer than 240 usable frames were supplied.');

  let status: EventModelArtifact['status'] = 'READY';
  if (clean.length === 0 || missing.length === CORE_EVENT_CLASSES.length) status = 'REJECTED';
  else if (statusReasons.length > 0) status = 'LIMITED';

  const artifact: EventModelArtifact = {
    schema: 'whirr.event-model.v1',
    version: input.version,
    createdAt: input.createdAt,
    featureSpecVersion: input.featureSpecVersion,
    featureNames: [...FEATURE_NAMES],
    classes: [...EVENT_CLASSES],
    mean,
    std,
    centroids,
    prototypes,
    policy: { minTopSimilarity: 0.55, minMargin: 0.04, minUsableFrames: 60 },
    training: {
      takeCount: clean.length,
      frameCount: totalFrames,
      durationMs: clean.reduce((sum, entry) => sum + entry.take.durationMs, 0),
      datasetHash,
      groupCount: new Set(clean.map((entry) => entry.take.sessionGroup)).size,
      provenance: input.provenance,
      takeIds: clean.map((entry) => entry.take.id),
      classTakes,
    },
    metrics: {
      method: 'LEAVE_ONE_TAKE_OUT',
      frameAccuracy: totalFrames > 0 ? correctFrames / totalFrames : 0,
      macroRecall,
      perClass,
      confusion,
      confusionLabels: [...EVENT_CLASSES],
      unknownRate: totalFrames > 0 ? unknownFrames / totalFrames : 1,
    },
    status,
    statusReasons,
    limitations: [
      'The event model is trained from demonstrations on one object and microphone placement. It is not a general appliance classifier.',
      'Each demonstration contributes a local prototype, so a background class may contain several distinct machines. This helps known distractors; it does not turn an untaught machine into a known class.',
      'START, RUNNING, and EXPECTED_STOP are temporal contract states. Only IDLE, RUNNING, BACKGROUND, and INTERRUPTED samples are acoustic training classes.',
      'A confident prediction is not proof that a physical task succeeded. It only supports the observed operating sequence.',
      'The browser computes demonstration scores and can be manipulated by its operator. Whirr binds the evidence but does not independently prove microphone honesty.',
      'A READY event model passed the local leave-one-take-out gate, not a guarantee of field reliability.',
    ],
  };
  return { artifact, accepted: status === 'READY' };
}

export function parseEventModel(value: unknown): EventModelArtifact {
  if (!value || typeof value !== 'object') throw new Error('Event model must be an object.');
  const model = value as Partial<EventModelArtifact>;
  if (model.schema !== 'whirr.event-model.v1') throw new Error('Unsupported event model schema.');
  if (!Array.isArray(model.classes) || model.classes.length !== EVENT_CLASSES.length) throw new Error('Event model classes are invalid.');
  if (!Array.isArray(model.centroids) || model.centroids.length !== EVENT_CLASSES.length) throw new Error('Event model centroids are invalid.');
  if (model.centroids.some((row) => !Array.isArray(row) || row.length !== FEATURE_NAMES.length)) {
    throw new Error('Event model centroid dimensions do not match the frozen feature specification.');
  }
  if (model.prototypes !== undefined) {
    const valid =
      Array.isArray(model.prototypes) &&
      model.prototypes.length === EVENT_CLASSES.length &&
      model.prototypes.every(
        (classPrototypes) =>
          Array.isArray(classPrototypes) &&
          classPrototypes.every(
            (prototype) => Array.isArray(prototype) && prototype.length === FEATURE_NAMES.length && prototype.every(Number.isFinite),
          ),
      );
    if (!valid) throw new Error('Event model prototype dimensions do not match the frozen feature specification.');
  }
  return model as EventModelArtifact;
}

export function demonstrationLabelForClass(event: EventClass): TakeLabel {
  return LABEL_OF_CLASS[event];
}
