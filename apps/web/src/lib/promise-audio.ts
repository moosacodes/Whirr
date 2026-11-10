import { classifyEventFrame, type EventModelArtifact, type EventPrediction } from '../../../../packages/audio/src/event-model.ts';
import type { PromiseObservation } from '../../../../packages/promise/src/types.ts';
import type { CapturedFrame } from './audio.ts';

export interface LivePromiseCollectorOptions {
  artifact: EventModelArtifact;
  minRunMs: number;
  onTick: (snapshot: PromiseLiveSnapshot) => void;
}

export interface PromiseLiveSnapshot {
  elapsedMs: number;
  state: PromiseObservation['state'] | 'CLOSED';
  confidence: number;
  event: EventPrediction['event'] | null;
  eventMatch: number;
  runMs: number;
  idleMs: number;
  uncertainMs: number;
  sensorLossMs: number;
  started: boolean;
  completed: boolean;
  currentRunStartMs: number | null;
  currentRunMs: number;
}

export class PromiseObservationCollector {
  private readonly artifact: EventModelArtifact;
  private readonly minRunMs: number;
  private readonly onTick: (snapshot: PromiseLiveSnapshot) => void;
  private observations: PromiseObservation[] = [];
  private pending: PromiseObservation[] = [];
  private seq = 1;
  private cursorMs = 0;
  private state: PromiseObservation['state'] | 'CLOSED' = 'CLOSED';
  private stateStartMs = 0;
  private confidenceSum = 0;
  private confidenceCount = 0;
  private eventMatches: number[] = [];
  private runMs = 0;
  private idleMs = 0;
  private uncertainMs = 0;
  private sensorLossMs = 0;
  private started = false;
  private completed = false;
  private currentRunStartMs: number | null = null;
  private lastEvent: EventPrediction['event'] | null = null;
  private lastEventMatch = 0;
  private elapsedMs = 0;

  constructor(options: LivePromiseCollectorOptions) {
    this.artifact = options.artifact;
    this.minRunMs = options.minRunMs;
    this.onTick = options.onTick;
  }

  get snapshot(): PromiseLiveSnapshot {
    return {
      elapsedMs: this.elapsedMs,
      state: this.state,
      confidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0,
      event: this.lastEvent,
      eventMatch: this.lastEventMatch,
      runMs: this.runMs,
      idleMs: this.idleMs,
      uncertainMs: this.uncertainMs,
      sensorLossMs: this.sensorLossMs,
      started: this.started,
      completed: this.completed,
      currentRunStartMs: this.currentRunStartMs,
      currentRunMs: this.currentRunStartMs === null ? 0 : Math.max(0, this.cursorMs - this.currentRunStartMs),
    };
  }

  open(): void {
    this.state = 'IDLE';
    this.stateStartMs = 0;
    this.cursorMs = 0;
    this.emit();
  }

  pushFrame(frame: CapturedFrame): void {
    if (this.state === 'CLOSED' || this.completed) return;
    this.elapsedMs = frame.endMs;
    const prediction = classifyEventFrame(this.artifact, frame.features, frame.flags);
    this.lastEvent = prediction.event;
    this.lastEventMatch = prediction.similarity;
    if (prediction.refused) {
      this.transition('UNCERTAIN', frame.endMs - 32);
      this.eventMatches.push(0);
      this.emit();
      return;
    }
    let nextState: PromiseObservation['state'] = this.state === 'ACTIVE_CONFIDENT' ? 'ACTIVE_CONFIDENT' : 'IDLE';
    if (prediction.event === 'RUNNING') nextState = 'ACTIVE_CONFIDENT';
    if (prediction.event === 'BACKGROUND' || prediction.event === 'INTERRUPTED') {
      nextState = this.state === 'ACTIVE_CONFIDENT' ? 'ACTIVE_CONFIDENT' : 'IDLE';
    }
    this.eventMatches.push(prediction.event === 'RUNNING' && nextState === 'ACTIVE_CONFIDENT' ? prediction.similarity : 0.8);
    this.transition(nextState, frame.endMs - 32);
    this.emit();
  }

  private transition(next: PromiseObservation['state'], atMs: number): void {
    if (next === this.state) {
      this.confidenceSum += this.lastEventMatch;
      this.confidenceCount += 1;
      return;
    }
    this.closeInterval(atMs);
    this.state = next;
    this.stateStartMs = atMs;
    this.confidenceSum = this.lastEventMatch;
    this.confidenceCount = 1;
    if (next === 'ACTIVE_CONFIDENT' && this.currentRunStartMs === null) {
      this.currentRunStartMs = atMs;
      this.started = true;
    }
    if (next === 'IDLE' && this.currentRunStartMs !== null) {
      const duration = atMs - this.currentRunStartMs;
      this.currentRunStartMs = null;
      if (duration >= this.minRunMs) this.completed = true;
    }
  }

  private closeInterval(atMs: number): void {
    if (this.state === 'CLOSED' || atMs <= this.stateStartMs) return;
    const duration = atMs - this.stateStartMs;
    if (duration < 32) return;
    if (this.state === 'ACTIVE_CONFIDENT') this.runMs += duration;
    if (this.state === 'IDLE') this.idleMs += duration;
    if (this.state === 'UNCERTAIN') this.uncertainMs += duration;
    if (this.state === 'DISCONNECTED') this.sensorLossMs += duration;
    const confidence = this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0;
    const matches = this.eventMatches.length > 0 ? this.eventMatches.reduce((sum, value) => sum + value, 0) / this.eventMatches.length : undefined;
    const closed: PromiseObservation = {
      seq: this.seq,
      startMs: this.stateStartMs,
      endMs: atMs,
      state: this.state,
      confidence: Math.max(0, Math.min(1, confidence)),
      qualityFlags: [],
      ...(matches === undefined ? {} : { eventMatch: Math.max(0, Math.min(1, matches)) }),
    };
    this.observations.push(closed);
    this.pending.push(closed);
    this.seq += 1;
    this.cursorMs = atMs;
    this.confidenceSum = 0;
    this.confidenceCount = 0;
    this.eventMatches = [];
  }

  disconnect(reason = 'MICROPHONE_ENDED'): PromiseObservation[] {
    if (this.state === 'CLOSED') return this.observations;
    const at = Math.max(this.cursorMs, this.elapsedMs);
    this.closeInterval(at);
    if (this.state !== 'DISCONNECTED') {
      this.state = 'DISCONNECTED';
      this.stateStartMs = at;
      this.confidenceSum = 0;
      this.confidenceCount = 0;
    }
    this.closeInterval(at + 32);
    this.state = 'CLOSED';
    void reason;
    this.emit();
    return this.observations;
  }

  finish(atMs: number): PromiseObservation[] {
    if (this.state === 'CLOSED') return this.observations;
    this.closeInterval(atMs);
    this.state = 'CLOSED';
    this.emit();
    return this.observations;
  }

  /** Returns newly closed intervals and clears the local upload queue. */
  drain(): PromiseObservation[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  private emit(): void {
    this.onTick(this.snapshot);
  }
}
