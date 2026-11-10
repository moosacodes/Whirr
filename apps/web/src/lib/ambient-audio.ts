import {
  classifyEventFrame,
  type EventModelArtifact,
  type EventPrediction,
} from '../../../../packages/audio/src/event-model.ts';
import type { AmbientObservation, SourceState } from '../../../../packages/ambient-engine/src/types.ts';
import type { CapturedFrame } from './audio.ts';

export type AmbientCollectorState = SourceState | 'CLOSED';

export interface AmbientLiveSnapshot {
  elapsedMs: number;
  state: AmbientCollectorState;
  confidence: number;
  event: EventPrediction['event'] | null;
  eventMatch: number;
  baselineActiveMs: number;
  inactiveMs: number;
  unknownMs: number;
  sensorLossMs: number;
  currentInactiveMs: number;
  longestInactiveMs: number;
  targetInactiveMs: number;
  progress: number;
  started: boolean;
  qualified: boolean;
}

export interface AmbientCollectorOptions {
  artifact: EventModelArtifact;
  requiredBaselineActiveMs: number;
  requiredInactiveMs: number;
  confidenceFloor: number;
  onTick: (snapshot: AmbientLiveSnapshot) => void;
}

/**
 * Local-only negative-space collector. It uploads interval states and
 * confidence, never raw audio. A missing source is only "INACTIVE"; it is never
 * treated as proof that a machine is powered off or that the room is silent.
 */
export class AmbientObservationCollector {
  private readonly artifact: EventModelArtifact;
  private readonly requiredBaselineActiveMs: number;
  private readonly requiredInactiveMs: number;
  private readonly confidenceFloor: number;
  private readonly onTick: (snapshot: AmbientLiveSnapshot) => void;
  private observations: AmbientObservation[] = [];
  private pending: AmbientObservation[] = [];
  private seq = 1;
  private cursorMs = 0;
  private elapsedMs = 0;
  private state: AmbientCollectorState = 'CLOSED';
  private stateStartMs = 0;
  private confidenceSum = 0;
  private confidenceCount = 0;
  private eventMatches: number[] = [];
  private currentFlags: string[] = [];
  private baselineActiveMs = 0;
  private inactiveMs = 0;
  private unknownMs = 0;
  private sensorLossMs = 0;
  private currentInactiveMs = 0;
  private longestInactiveMs = 0;
  private started = false;
  private baselineMet = false;
  private qualified = false;
  private lastEvent: EventPrediction['event'] | null = null;
  private lastEventMatch = 0;

  constructor(options: AmbientCollectorOptions) {
    this.artifact = options.artifact;
    this.requiredBaselineActiveMs = options.requiredBaselineActiveMs;
    this.requiredInactiveMs = options.requiredInactiveMs;
    this.confidenceFloor = options.confidenceFloor;
    this.onTick = options.onTick;
  }

  get snapshot(): AmbientLiveSnapshot {
    return {
      elapsedMs: this.elapsedMs,
      state: this.state,
      confidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0,
      event: this.lastEvent,
      eventMatch: this.lastEventMatch,
      baselineActiveMs: this.baselineActiveMs,
      inactiveMs: this.inactiveMs,
      unknownMs: this.unknownMs,
      sensorLossMs: this.sensorLossMs,
      currentInactiveMs: this.currentInactiveMs,
      longestInactiveMs: this.longestInactiveMs,
      targetInactiveMs: this.requiredInactiveMs,
      progress: Math.min(1, this.currentInactiveMs / this.requiredInactiveMs),
      started: this.started,
      qualified: this.qualified,
    };
  }

  open(): void {
    this.observations = [];
    this.pending = [];
    this.seq = 1;
    this.cursorMs = 0;
    this.elapsedMs = 0;
    this.state = 'CLOSED';
    this.stateStartMs = 0;
    this.confidenceSum = 0;
    this.confidenceCount = 0;
    this.eventMatches = [];
    this.currentFlags = [];
    this.baselineActiveMs = 0;
    this.inactiveMs = 0;
    this.unknownMs = 0;
    this.sensorLossMs = 0;
    this.currentInactiveMs = 0;
    this.longestInactiveMs = 0;
    this.started = false;
    this.baselineMet = false;
    this.qualified = false;
    this.lastEvent = null;
    this.lastEventMatch = 0;
    this.transition('INACTIVE', 0, []);
    this.emit();
  }

  pushFrame(frame: CapturedFrame): void {
    if (this.qualified) return;
    const atMs = Math.max(0, frame.endMs - 32);
    this.elapsedMs = frame.endMs;
    const prediction = classifyEventFrame(this.artifact, frame.features, frame.flags);
    this.lastEvent = prediction.event;
    this.lastEventMatch = prediction.similarity;
    const flags: string[] = [...frame.flags];
    let next: AmbientCollectorState = 'UNKNOWN';
    if (!prediction.refused && prediction.event === 'RUNNING' && prediction.similarity >= this.confidenceFloor) {
      next = 'ACTIVE';
    } else if (
      !prediction.refused &&
      (prediction.event === 'IDLE' || prediction.event === 'BACKGROUND') &&
      prediction.similarity >= this.confidenceFloor
    ) {
      next = 'INACTIVE';
    } else if (prediction.refused) {
      flags.push('MODEL_REFUSED');
    }
    if (prediction.event === 'INTERRUPTED') flags.push('TRANSITION_UNCERTAIN');
    this.transition(next, atMs, flags);
    this.emit();
  }

  private transition(next: AmbientCollectorState, atMs: number, flags: string[]): void {
    if (next === this.state) {
      const duration = Math.max(0, atMs - this.stateStartMs);
      if (next === 'ACTIVE') this.addActive(duration);
      if (next === 'INACTIVE') this.addInactive(duration);
      if (next === 'UNKNOWN') this.unknownMs += duration;
      if (next === 'DISCONNECTED') this.sensorLossMs += duration;
      this.currentFlags = flags.length > 0 ? flags : this.currentFlags;
      this.confidenceSum += this.lastEventMatch;
      this.confidenceCount += 1;
      return;
    }
    this.closeInterval(atMs);
    this.state = next;
    this.stateStartMs = atMs;
    this.currentFlags = flags;
    this.confidenceSum = this.lastEventMatch;
    this.confidenceCount = 1;
    if (next === 'ACTIVE') {
      this.started = true;
      this.currentInactiveMs = 0;
    }
    if (next === 'UNKNOWN' || next === 'DISCONNECTED') {
      this.currentInactiveMs = 0;
    }
  }

  private addActive(duration: number): void {
    if (!this.started) this.started = true;
    if (!this.baselineMet) {
      this.baselineActiveMs += duration;
      if (this.baselineActiveMs >= this.requiredBaselineActiveMs) this.baselineMet = true;
    }
    this.currentInactiveMs = 0;
  }

  private addInactive(duration: number): void {
    if (!this.baselineMet) return;
    this.inactiveMs += duration;
    this.currentInactiveMs += duration;
    this.longestInactiveMs = Math.max(this.longestInactiveMs, this.currentInactiveMs);
    if (this.currentInactiveMs >= this.requiredInactiveMs) this.qualified = true;
  }

  private closeInterval(atMs: number): void {
    if (this.state === 'CLOSED' || atMs <= this.stateStartMs) return;
    const duration = atMs - this.stateStartMs;
    if (duration < 32) return;
    if (this.state === 'ACTIVE') this.addActive(duration);
    if (this.state === 'INACTIVE') this.addInactive(duration);
    if (this.state === 'UNKNOWN') this.unknownMs += duration;
    if (this.state === 'DISCONNECTED') this.sensorLossMs += duration;
    const confidence = this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0;
    const matches = this.eventMatches.length > 0
      ? this.eventMatches.reduce((sum, value) => sum + value, 0) / this.eventMatches.length
      : undefined;
    const interval: AmbientObservation = {
      seq: this.seq,
      startMs: this.stateStartMs,
      endMs: atMs,
      sourceState: this.state,
      confidence: Math.max(0, Math.min(1, confidence)),
      qualityFlags: this.currentFlags,
      ...(matches === undefined ? {} : { eventMatch: Math.max(0, Math.min(1, matches)) }),
    };
    this.observations.push(interval);
    this.pending.push(interval);
    this.seq += 1;
    this.cursorMs = atMs;
    this.confidenceSum = 0;
    this.confidenceCount = 0;
    this.eventMatches = [];
    this.currentFlags = [];
  }

  finish(atMs: number): AmbientObservation[] {
    if (this.state === 'CLOSED') return this.observations;
    this.closeInterval(Math.max(atMs, this.cursorMs, this.elapsedMs));
    this.state = 'CLOSED';
    this.elapsedMs = Math.max(this.elapsedMs, atMs);
    this.emit();
    return this.observations;
  }

  disconnect(): AmbientObservation[] {
    if (this.state === 'CLOSED') return this.observations;
    this.closeInterval(Math.max(this.cursorMs, this.elapsedMs));
    const at = Math.max(this.cursorMs, this.elapsedMs);
    const lost: AmbientObservation = {
      seq: this.seq,
      startMs: at,
      endMs: at + 32,
      sourceState: 'DISCONNECTED',
      confidence: 0,
      qualityFlags: ['MICROPHONE_ENDED'],
    };
    this.observations.push(lost);
    this.pending.push(lost);
    this.seq += 1;
    this.sensorLossMs += 32;
    this.currentInactiveMs = 0;
    this.state = 'CLOSED';
    this.elapsedMs = at + 32;
    this.emit();
    return this.observations;
  }

  drain(): AmbientObservation[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  private emit(): void {
    this.onTick(this.snapshot);
  }
}
