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

export type UploadState = 'ONLINE' | 'RETRYING' | 'OFFLINE';

export interface SensorDiagnostics {
  deviceLabel: string | null;
  sampleRate: number | null;
  permission: 'GRANTED' | 'DENIED' | 'UNKNOWN';
  frames: number;
  queueDepth: number;
  uploadFailures: number;
  level: number;
  passportScore: number | null;
  lastFrameAgeMs: number | null;
}

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
  onDiagnostics?: (diagnostics: SensorDiagnostics) => void;
  onUploadState?: (state: UploadState) => void;
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

interface ExplanationBucket {
  frames: number;
  passportSum: number;
  passportCount: number;
  features: Map<string, { valueSum: number; contributionSum: number; count: number }>;
}

const FLUSH_INTERVAL_MS = 2_000;

/**
 * Owns the live sensing loop. React never touches audio buffers; this class
 * runs inference, keeps the hysteresis state and uploads only sealed intervals.
 * Failed uploads stay in the in-memory queue and are retried in order.
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
  private readonly explanations = new Map<number, ExplanationBucket>();
  private frameCount = 0;
  private uploadFailures = 0;
  private latestLevel = 0;
  private latestPassport: number | null = null;
  private lastFrameAt: number | null = null;
  private uploadState: UploadState = 'ONLINE';

  private readonly handleOffline = () => {
    if (navigator.onLine === false) this.setUploadState('OFFLINE');
  };
  private readonly handleOnline = () => {
    if (this.pending.length > 0) {
      this.setUploadState('RETRYING');
      void this.flush().catch(() => undefined);
    } else {
      this.setUploadState('ONLINE');
    }
  };

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
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);

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
        this.addExplanation(this.meter.currentStartMs, this.latestExplanation);
        this.frameTick += 1;
        this.frameCount += 1;
        this.latestPassport =
          typeof prediction.soundprintScore === 'number' ? prediction.soundprintScore : null;
        this.lastFrameAt = Date.now();
        if (this.frameTick % 3 === 0) {
          const bands = frame.features.slice(10, 18).map((value) => Math.max(0, Math.min(1, value)));
          this.options.onBands?.(bands);
          this.options.onExplanation?.(this.latestExplanation);
          this.emitDiagnostics();
        }
        this.options.onSoundprint?.(prediction.soundprintScore, Boolean(prediction.soundprintMismatch));
        const closed = this.meter.push(prediction);
        this.lastEndMs = Math.max(this.lastEndMs, globalEnd);
        for (const closedInterval of closed) {
          const sealed = this.sealExplanation(closedInterval.startMs) ?? this.latestExplanation;
          const interval: LiveMeterInterval = sealed
            ? { ...closedInterval, explanation: sealed }
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
      onLevel: (rms) => {
        this.latestLevel = rms;
        this.options.onLevel(rms);
      },
      onError: (message) => this.options.onError(message, false),
      onEnded: () => {
        if (!this.running || this.stopped) return;
        this.running = false;
        this.stopTimer();
        if (this.meter) {
          const closed = this.meter.disconnect(this.lastEndMs, 'DEVICE_LOST');
          for (const closedInterval of closed) {
            const sealed = this.sealExplanation(closedInterval.startMs) ?? this.latestExplanation;
            const interval: LiveMeterInterval = sealed
              ? { ...closedInterval, explanation: sealed }
              : closedInterval;
            this.billedMs += interval.state === 'ACTIVE_CONFIDENT' ? interval.endMs - interval.startMs : 0;
            this.pending.push(interval);
            this.options.onInterval(interval);
          }
        }
        this.emitDiagnostics();
        void this.flush().catch(() => undefined);
        this.options.onDeviceLost();
      },
    });

    try {
      await this.engine.start(deviceId);
    } catch (error) {
      this.running = false;
      this.removeNetworkListeners();
      this.emitDiagnostics('DENIED');
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
    this.emitDiagnostics();
  }

  /** Stops capture, seals the open interval and uploads every pending interval. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.running = false;
    this.stopTimer();
    this.removeNetworkListeners();
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
    if (this.meter) {
      const closed = this.meter.flush(this.lastEndMs);
      for (const closedInterval of closed) {
        const sealed = this.sealExplanation(closedInterval.startMs) ?? this.latestExplanation;
        const interval: LiveMeterInterval = sealed
          ? { ...closedInterval, explanation: sealed }
          : closedInterval;
        this.billedMs += interval.state === 'ACTIVE_CONFIDENT' ? interval.endMs - interval.startMs : 0;
        this.pending.push(interval);
        this.options.onInterval(interval);
      }
    }
    await this.flush();
    this.options.onState('DISCONNECTED');
    this.emitDiagnostics();
  }

  /**
   * Stops capture and makes one best-effort final upload. Any failed batch is
   * retained by flush; callers must surface the error rather than presenting a
   * successful close.
   */
  async hardStop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.stopTimer();
    this.removeNetworkListeners();
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
    if (this.pending.length > 0) {
      await this.flush().catch(() => undefined);
    }
  }

  private stopTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private removeNetworkListeners(): void {
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('online', this.handleOnline);
  }

  private addExplanation(startMs: number, explanation: IntervalExplanation): void {
    const bucket = this.explanations.get(startMs) ?? {
      frames: 0,
      passportSum: 0,
      passportCount: 0,
      features: new Map(),
    };
    bucket.frames += 1;
    if (typeof explanation.passportScore === 'number') {
      bucket.passportSum += explanation.passportScore;
      bucket.passportCount += 1;
    }
    for (const feature of explanation.topFeatures) {
      const current = bucket.features.get(feature.name) ?? {
        valueSum: 0,
        contributionSum: 0,
        count: 0,
      };
      current.valueSum += feature.value;
      current.contributionSum += feature.contribution;
      current.count += 1;
      bucket.features.set(feature.name, current);
    }
    this.explanations.set(startMs, bucket);
  }

  private sealExplanation(startMs: number): IntervalExplanation | null {
    const bucket = this.explanations.get(startMs);
    if (!bucket) return null;
    this.explanations.delete(startMs);
    const features = [...bucket.features.entries()]
      .map(([name, value]) => ({
        name,
        value: value.valueSum / Math.max(1, value.count),
        contribution: value.contributionSum,
      }))
      .sort((left, right) => right.contribution - left.contribution)
      .slice(0, 6);
    const passportScore =
      bucket.passportCount > 0 ? bucket.passportSum / bucket.passportCount : null;
    const leading = features
      .slice(0, 3)
      .map((feature) => feature.name)
      .join(', ');
    return {
      schema: 'whirr.explanation.v1',
      passportScore,
      topFeatures: features,
      summary: `Aggregated over ${bucket.frames} frames: ${leading || 'no dominant feature'} carried the decision. ${
        passportScore === null
          ? 'No acoustic passport score was available.'
          : `Mean passport similarity ${(passportScore * 100).toFixed(0)}%.`
      }`,
    };
  }

  private emitDiagnostics(permission: 'GRANTED' | 'DENIED' | 'UNKNOWN' = 'GRANTED'): void {
    this.options.onDiagnostics?.({
      deviceLabel: this.engine?.deviceLabel ?? null,
      sampleRate: this.engine?.sampleRate ?? null,
      permission,
      frames: this.frameCount,
      queueDepth: this.pending.length,
      uploadFailures: this.uploadFailures,
      level: this.latestLevel,
      passportScore: this.latestPassport,
      lastFrameAgeMs:
        this.lastFrameAt === null ? null : Math.max(0, Date.now() - this.lastFrameAt),
    });
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    const seq = this.options.seq.value + 1;
    this.emitDiagnostics();
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
        this.uploadFailures = 0;
        this.setUploadState('ONLINE');
        this.emitDiagnostics();
      })
      .catch((error) => {
        this.uploadFailures += 1;
        this.pending.unshift(...batch);
        this.setUploadState(
          typeof navigator !== 'undefined' && navigator.onLine === false ? 'OFFLINE' : 'RETRYING',
        );
        this.emitDiagnostics();
        throw error;
      });
    this.flushInFlight = request.finally(() => {
      this.flushInFlight = null;
    });
    await this.flushInFlight;
  }

  private setUploadState(state: UploadState): void {
    if (this.uploadState === state) return;
    this.uploadState = state;
    this.options.onUploadState?.(state);
  }
}
