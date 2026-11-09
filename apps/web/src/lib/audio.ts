import {
  ANALYSIS_SAMPLE_RATE,
  FRAME_MS,
  FRAME_SIZE,
  HOP_SIZE,
  type QualityFlag,
} from '../../../../packages/audio/src/spec.ts';
import { analyseWindow, extractFrames, type FeatureFrame } from '../../../../packages/audio/src/features.ts';
import { StreamingResampler, resample } from '../../../../packages/audio/src/resampler.ts';
import { parseWav } from '../../../../packages/audio/src/wav.ts';

export interface CapturedFrame {
  /** Milliseconds from the start of this capture stream. */
  endMs: number;
  features: number[];
  flags: QualityFlag[];
}

export interface MicrophoneOptions {
  onFrame?: (frame: CapturedFrame) => void;
  onLevel?: (rms: number) => void;
  onError?: (message: string) => void;
  onEnded?: () => void;
}

const WORKLET_URL = '/worklets/frame-worklet.js';

export class MicrophoneEngine {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private resampler: StreamingResampler | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private bufferStart = 0;
  private previousMagnitudes: Float64Array | null = null;
  private running = false;
  private readonly options: MicrophoneOptions;
  private readonly silentSink = new Float32Array(128);

  constructor(options: MicrophoneOptions) {
    this.options = options;
  }

  get active(): boolean {
    return this.running;
  }

  async start(deviceId?: string, signal?: AbortSignal): Promise<void> {
    if (this.running) return;
    if (signal?.aborted) throw new DOMException('Microphone start was cancelled.', 'AbortError');
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not expose microphone capture. Use a recent Chrome, Edge or Firefox.');
    }
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (signal?.aborted) {
      for (const pending of this.stream.getTracks()) pending.stop();
      this.stream = null;
      throw new DOMException('Microphone start was cancelled.', 'AbortError');
    }

    const track = this.stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => {
      if (this.running) {
        this.running = false;
        this.options.onEnded?.();
      }
    });

    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    if (context.state === 'suspended') await context.resume();
    this.source = context.createMediaStreamSource(this.stream);
    this.silentGain = context.createGain();
    this.silentGain.gain.value = 0;
    this.silentGain.connect(context.destination);
    this.resampler = new StreamingResampler(context.sampleRate, ANALYSIS_SAMPLE_RATE);
    this.buffer = new Float32Array(0);
    this.bufferStart = 0;
    this.previousMagnitudes = null;
    this.running = true;

    try {
      await context.audioWorklet.addModule(WORKLET_URL);
      const worklet = new AudioWorkletNode(context, 'whirr-frame', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; samples?: Float32Array; sampleRate?: number };
        if (data.type === 'block' && data.samples && data.sampleRate) {
          this.handleBlock(data.samples, data.sampleRate);
        }
      };
      this.source.connect(worklet);
      worklet.connect(this.silentGain);
      this.worklet = worklet;
    } catch (error) {
      // ScriptProcessor is a documented fallback for browsers without AudioWorklet.
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        this.handleBlock(new Float32Array(channel), context.sampleRate);
      };
      this.source.connect(processor);
      processor.connect(this.silentGain);
      this.processor = processor;
      this.options.onError?.(
        `AudioWorklet unavailable; using a compatibility capture path. (${(error as Error).message})`,
      );
    }
  }

  private handleBlock(input: Float32Array, sampleRate: number): void {
    if (!this.running) return;
    if (!this.resampler || this.resampler.inputRate !== sampleRate) {
      this.resampler = new StreamingResampler(sampleRate, ANALYSIS_SAMPLE_RATE);
    }
    const resampled = this.resampler.push(input);
    if (resampled.length === 0) return;

    let sum = 0;
    for (let i = 0; i < resampled.length; i += 1) sum += resampled[i]! * resampled[i]!;
    this.options.onLevel?.(Math.sqrt(sum / resampled.length));

    const merged = new Float32Array(this.buffer.length + resampled.length);
    merged.set(this.buffer);
    merged.set(resampled, this.buffer.length);
    this.buffer = merged;

    while (this.buffer.length >= FRAME_SIZE) {
      const frame = this.buffer.slice(0, FRAME_SIZE);
      const { analysis, magnitudes } = analyseWindow(frame, this.previousMagnitudes);
      this.previousMagnitudes = magnitudes;
      const endMs = ((this.bufferStart + FRAME_SIZE) / ANALYSIS_SAMPLE_RATE) * 1000;
      this.options.onFrame?.({ endMs, features: analysis.features, flags: analysis.flags });
      this.buffer = this.buffer.slice(HOP_SIZE);
      this.bufferStart += HOP_SIZE;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      this.worklet?.port.postMessage({ type: 'reset' });
      this.worklet?.disconnect();
      this.processor?.disconnect();
      this.source?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      // Graph may already be torn down.
    }
    this.worklet = null;
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
    }
    this.context = null;
    this.resampler = null;
    this.buffer = new Float32Array(0);
    this.previousMagnitudes = null;
    void this.silentSink;
  }
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}

export interface AnalyzedRecording {
  frames: FeatureFrame[];
  durationMs: number;
  sourceSampleRate: number;
  analysisSampleRate: number;
}

/** Parses and resamples a WAV file with the same pipeline as live capture. */
export async function analyzeWavBuffer(buffer: ArrayBuffer): Promise<AnalyzedRecording> {
  if (buffer.byteLength > 64 * 1024 * 1024) {
    throw new Error('WAV file is too large (maximum 64 MB).');
  }
  const wav = parseWav(buffer);
  if (!wav.samples.length) throw new Error('The WAV file contains no audio samples.');
  if (wav.sampleRate < 8_000) throw new Error('Sample rate is too low; use 16kHz or higher.');
  const samples =
    wav.sampleRate === ANALYSIS_SAMPLE_RATE
      ? wav.samples
      : resample(wav.samples, wav.sampleRate, ANALYSIS_SAMPLE_RATE);
  const frames = extractFrames(samples);
  if (frames.length === 0) throw new Error('Recording is too short to analyse.');
  return {
    frames,
    durationMs: (samples.length / ANALYSIS_SAMPLE_RATE) * 1000,
    sourceSampleRate: wav.sampleRate,
    analysisSampleRate: ANALYSIS_SAMPLE_RATE,
  };
}

export async function fetchWav(url: string): Promise<AnalyzedRecording> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load replay fixture (${response.status})`);
  const buffer = await response.arrayBuffer();
  return analyzeWavBuffer(buffer);
}

export const FRAME_MILLISECONDS = FRAME_MS;
