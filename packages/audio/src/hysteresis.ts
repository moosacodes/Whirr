import type { DecisionPolicy, FramePrediction } from './classifier.ts';

export type MeterState = 'ACTIVE_CONFIDENT' | 'IDLE' | 'UNCERTAIN' | 'DISCONNECTED';

export const METER_STATES: readonly MeterState[] = [
  'ACTIVE_CONFIDENT',
  'IDLE',
  'UNCERTAIN',
  'DISCONNECTED',
];

export interface MeterInterval {
  startMs: number;
  endMs: number;
  state: MeterState;
  confidence: number;
  qualityFlags: string[];
}

const DISQUALIFYING = new Set([
  'CLIPPED',
  'SILENT',
  'LOW_LEVEL',
  'GAP',
  'DEVICE_LOST',
  'TAB_HIDDEN',
  'SOUNDPRINT_MISMATCH',
  'UNKNOWN_OBJECT',
  'LOW_CONFIDENCE',
]);

/**
 * Streaming hysteresis state machine.
 *
 * Precision-first: enters ACTIVE only after repeated strongly-active frames,
 * and treats weak, clipped, silent or low-level frames as UNCERTAIN (never
 * billable). Uncertain frames inside an active run split the interval, so the
 * renter is never charged for ambiguous audio.
 */
export class MeterStream {
  readonly policy: DecisionPolicy;
  private smoothedActive: number | null = null;
  private smoothedIdle: number | null = null;
  private internal: 'IDLE' | 'ACTIVE' = 'IDLE';
  private observed: MeterState = 'IDLE';
  private intervalStartMs = 0;
  private lastEndMs = 0;
  private confidenceSum = 0;
  private frameCount = 0;
  private flags = new Set<string>();
  private strongCount = 0;
  private offCount = 0;

  constructor(policy: DecisionPolicy) {
    this.policy = { ...policy };
  }

  get currentState(): MeterState {
    return this.observed;
  }

  get currentStartMs(): number {
    return this.intervalStartMs;
  }

  get lastFrameEndMs(): number {
    return this.lastEndMs;
  }

  reset(startMs = 0): void {
    this.smoothedActive = null;
    this.smoothedIdle = null;
    this.internal = 'IDLE';
    this.observed = 'IDLE';
    this.intervalStartMs = startMs;
    this.lastEndMs = startMs;
    this.confidenceSum = 0;
    this.frameCount = 0;
    this.flags = new Set();
    this.strongCount = 0;
    this.offCount = 0;
  }

  push(prediction: FramePrediction): MeterInterval[] {
    if (prediction.endMs <= prediction.startMs) {
      throw new Error('Frame end must be after start');
    }
    if (this.frameCount === 0) {
      this.intervalStartMs = prediction.startMs;
    }

    const alpha = Math.min(0.99, Math.max(0.05, this.policy.smoothing));
    this.smoothedActive =
      this.smoothedActive === null
        ? prediction.pActive
        : this.smoothedActive + alpha * (prediction.pActive - this.smoothedActive);
    this.smoothedIdle =
      this.smoothedIdle === null
        ? prediction.pIdle
        : this.smoothedIdle + alpha * (prediction.pIdle - this.smoothedIdle);

    const disqualified = prediction.flags.some((flag) => DISQUALIFYING.has(flag));
    const active = this.smoothedActive;
    const idle = this.smoothedIdle;
    const strong =
      !disqualified &&
      active >= this.policy.activeThreshold &&
      active - idle >= this.policy.activeMargin;
    const idleish =
      !disqualified && idle >= this.policy.idleThreshold && active < this.policy.activeThreshold;

    let observed: MeterState;
    if (this.internal === 'ACTIVE') {
      if (strong) {
        this.offCount = 0;
        observed = 'ACTIVE_CONFIDENT';
      } else {
        this.offCount += 1;
        if (this.offCount >= this.policy.offFrames && idleish) {
          this.internal = 'IDLE';
          this.strongCount = 0;
          observed = 'IDLE';
        } else {
          observed = 'UNCERTAIN';
        }
      }
    } else if (strong) {
      this.strongCount += 1;
      if (this.strongCount >= this.policy.onFrames) {
        this.internal = 'ACTIVE';
        this.offCount = 0;
        observed = 'ACTIVE_CONFIDENT';
      } else {
        observed = 'UNCERTAIN';
      }
    } else {
      this.strongCount = 0;
      observed = idleish ? 'IDLE' : 'UNCERTAIN';
    }

    const closed: MeterInterval[] = [];
    if (observed !== this.observed) {
      const interval = this.closeInterval(prediction.startMs);
      if (interval) closed.push(interval);
      this.observed = observed;
      this.intervalStartMs = prediction.startMs;
      this.confidenceSum = 0;
      this.frameCount = 0;
      this.flags = new Set();
    }

    this.frameCount += 1;
    this.confidenceSum += Math.max(prediction.pActive, prediction.pIdle, prediction.pOther);
    for (const flag of prediction.flags) this.flags.add(flag);
    this.lastEndMs = prediction.endMs;
    return closed;
  }

  /** Force a DISCONNECTED interval, e.g. when the microphone ends. */
  disconnect(atMs: number, reason = 'DEVICE_LOST'): MeterInterval[] {
    if (atMs < this.lastEndMs) atMs = this.lastEndMs;
    const closed: MeterInterval[] = [];
    const current = this.closeInterval(atMs);
    if (current && current.endMs > current.startMs) closed.push(current);
    this.observed = 'DISCONNECTED';
    this.internal = 'IDLE';
    this.intervalStartMs = atMs;
    this.lastEndMs = atMs;
    this.confidenceSum = 0;
    this.frameCount = 0;
    this.flags = new Set([reason]);
    this.strongCount = 0;
    this.offCount = 0;
    return closed;
  }

  /** Closes the open interval at `atMs` and returns the final evidence. */
  flush(atMs: number = this.lastEndMs): MeterInterval[] {
    const interval = this.closeInterval(atMs);
    this.observed = 'IDLE';
    this.internal = 'IDLE';
    this.intervalStartMs = atMs;
    this.lastEndMs = atMs;
    this.confidenceSum = 0;
    this.frameCount = 0;
    this.flags = new Set();
    this.strongCount = 0;
    this.offCount = 0;
    return interval ? [interval] : [];
  }

  private closeInterval(endMs: number): MeterInterval | null {
    const end = Math.max(endMs, this.intervalStartMs);
    if (end <= this.intervalStartMs) return null;
    if (this.frameCount === 0 && this.observed === 'IDLE' && this.intervalStartMs === 0) {
      // Nothing observed yet.
      return null;
    }
    return {
      startMs: this.intervalStartMs,
      endMs: end,
      state: this.observed,
      confidence: this.frameCount ? this.confidenceSum / this.frameCount : 0,
      qualityFlags: [...this.flags],
    };
  }
}

/**
 * Deterministic offline segmentation used for model evaluation. Applies the
 * same hysteresis policy frame by frame.
 */
export function segmentPredictions(
  predictions: FramePrediction[],
  policy: DecisionPolicy,
): MeterInterval[] {
  const stream = new MeterStream(policy);
  const intervals: MeterInterval[] = [];
  for (const prediction of predictions) {
    intervals.push(...stream.push(prediction));
  }
  const end = predictions.length ? predictions[predictions.length - 1]!.endMs : 0;
  intervals.push(...stream.flush(end));
  return intervals.filter((i) => i.endMs > i.startMs);
}
