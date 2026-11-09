import { api, ApiError } from './api.ts';
import { MicrophoneEngine } from './audio.ts';
import {
  explainPrediction,
  predictFrame,
  type ModelArtifact,
} from '../../../../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import type { MeterState } from '../../../../packages/meter/src/intervals.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import type { Currency } from '../../../../packages/meter/src/currency.ts';
import type { IntervalExplanation } from '../../../../packages/contracts/src/types.ts';

export type LiveMeterInterval = MeterInterval & { explanation?: IntervalExplanation };

export interface MeterControllerOptions {
  model: ModelArtifact;
  sessionId: string;
  token: string;
  baseMs: number;
  seq: { value: number };
  rateMinorPerMinute: number;
  capMinor: number;
  currency: Currency;
  onState: (state: MeterState) => void;
  onBillable: (billableMs: number) => void;
  onInterval: (interval: LiveMeterInterval) => void;
  onLevel: (rms: number) => void;
  onBands?: (bands: number[]) => void;
  onExplanation?: (explanation: IntervalExplanation) => void;
  onSoundprint?: (score: number | undefined, mismatch: boolean) => void;
  onError: (message: string, fatal: boolean) => void;
  onDeviceLost: () => void;
  onCapReached: (quoteMinor: number) => void;
}

interface BatchResponse {
  accepted: boolean;
  duplicate: boolean;
  lastClientSeq: number;
  billableMs: number;
  meterClockMs: number;
}

const FLUSH_INTERVAL_MS = 2_000;

/**
 * Owns the live sensing loop. React never touches audio buffers; this class
 * runs inference, keeps the hysteresis state and uploads only sealed intervals.
 */
export class MeterController {
  private readonly options: MeterControllerOptions;
  private engine: MicrophoneEngine | null = null;
  private meter: MeterStream | null = null;
  private pending: LiveMeterInterval[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private lastEndMs: number;
  private billedMs = 0;
  private running = false;
  private stopped = false;
  private capNotified = false;
  private frameTick = 0;
  private latestExplanation: IntervalExplanation | null = null;

  constructor(options: MeterControllerOptions) {
    this.options = options;
    this.lastEndMs = options.baseMs;
  }

  get currentState(): MeterState {
    return this.meter?.currentState ?? 'DISCONNECTED';
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(deviceId?: string): Promise<void> {
    if (this.running || this.stopped) return;
    this.meter = new MeterStream(this.options.model.policy);
    this.meter.reset(this.options.baseMs);
    this.running = true;

    this.engine = new MicrophoneEngine({
      onFrame: (frame) => {
        if (!this.running || !this.meter) return;
        const globalEnd = this.options.baseMs + frame.endMs;
        const globalStart = Math.max(this.options.baseMs, globalEnd - FRAME_MS);
        const prediction = predictFrame(
          this.options.model,
          frame.features,
          frame.flags,
          globalStart,
          globalEnd,
        );
        const explanation = explainPrediction(
          this.options.model,
          frame.features,
          prediction.soundprintScore,
        );
        this.latestExplanation = {
          schema: 'whirr.explanation.v1',
          passportScore: explanation.passportScore,
          topFeatures: explanation.topFeatures,
          summary: explanation.summary,
        };
        this.frameTick += 1;
        if (this.frameTick % 3 === 0) {
          const bands = frame.features.slice(10, 18).map((value) => Math.max(0, Math.min(1, value)));
          this.options.onBands?.(bands);
          this.options.onExplanation?.(this.latestExplanation);
        }
        this.options.onSoundprint?.(prediction.soundprintScore, Boolean(prediction.soundprintMismatch));
        const closed = this.meter.push(prediction);
        this.lastEndMs = Math.max(this.lastEndMs, globalEnd);
        for (const closedInterval of closed) {
          const interval: LiveMeterInterval = this.latestExplanation
            ? { ...closedInterval, explanation: this.latestExplanation }
            : closedInterval;
          this.billedMs += interval.state === 'ACTIVE_CONFIDENT' ? interval.endMs - interval.startMs : 0;
          this.pending.push(interval);
          this.options.onInterval(interval);
        }
        const open =
          this.meter.currentState === 'ACTIVE_CONFIDENT'
            ? Math.max(0, globalEnd - this.meter.currentStartMs)
            : 0;
        this.options.onState(this.meter.currentState);
        this.options.onBillable(this.billedMs + open);
        const quote = quoteBreakdown(
          this.options.rateMinorPerMinute,
          this.billedMs + open,
          this.options.capMinor,
          0,
          this.options.currency,
        );
        if (quote.capApplied && !this.capNotified) {
          this.capNotified = true;
          this.options.onCapReached(quote.finalMinor);
        }
      },
      onLevel: (rms) => this.options.onLevel(rms),
      onError: (message) => this.options.onError(message, false),
      onEnded: () => {
        if (!this.running || this.stopped) return;
        this.running = false;
        this.stopTimer();
        if (this.meter) {
      const closed = this.meter.disconnect(this.lastEndMs, 'DEVICE_LOST');
      for (const closedInterval of closed) {
        const interval: LiveMeterInterval = this.latestExplanation
          ? { ...closedInterval, explanation: this.latestExplanation }
          : closedInterval;
            this.billedMs += interval.state === 'ACTIVE_CONFIDENT' ? interval.endMs - interval.startMs : 0;
            this.pending.push(interval);
            this.options.onInterval(interval);
          }
        }
        void this.flush().catch(() => undefined);
        this.options.onDeviceLost();
      },
    });

    try {
      await this.engine.start(deviceId);
    } catch (error) {
      this.running = false;
      if (this.engine) await this.engine.stop();
      this.engine = null;
      throw error;
    }
    this.flushTimer = setInterval(() => {
      void this.flush().catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 409)) {
          this.options.onError(error.message, true);
          void this.hardStop();
        }
      });
    }, FLUSH_INTERVAL_MS);
  }

  /** Stops capture, seals the open interval and uploads every pending interval. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.running = false;
    this.stopTimer();
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
    if (this.meter) {
      const closed = this.meter.flush(this.lastEndMs);
      for (const closedInterval of closed) {
        const interval: LiveMeterInterval = this.latestExplanation
          ? { ...closedInterval, explanation: this.latestExplanation }
          : closedInterval;
        this.billedMs += interval.state === 'ACTIVE_CONFIDENT' ? interval.endMs - interval.startMs : 0;
        this.pending.push(interval);
        this.options.onInterval(interval);
      }
    }
    await this.flush();
    this.options.onState('DISCONNECTED');
  }

  /** Stops without flushing (unmount / fatal auth error). */
  async hardStop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.stopTimer();
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
  }

  private stopTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    const seq = this.options.seq.value + 1;
    const request = api<BatchResponse>(`/api/sessions/${this.options.sessionId}/intervals`, {
      method: 'POST',
      body: {
        token: this.options.token,
        clientSeq: seq,
        intervals: batch.map((interval) => ({
          startMs: Math.round(interval.startMs),
          endMs: Math.round(interval.endMs),
          state: interval.state,
          confidence: Math.max(0, Math.min(1, interval.confidence)),
          qualityFlags: interval.qualityFlags.slice(0, 8),
          modelVersion: this.options.model.version,
          ...(interval.explanation ? { explanation: interval.explanation } : {}),
        })),
      },
    })
      .then((response) => {
        if (response.lastClientSeq > this.options.seq.value) this.options.seq.value = response.lastClientSeq;
        else if (!response.duplicate) this.options.seq.value = seq;
      })
      .catch((error) => {
        this.pending.unshift(...batch);
        throw error;
      });
    this.flushInFlight = request.finally(() => {
      this.flushInFlight = null;
    });
    await this.flushInFlight;
  }
}
