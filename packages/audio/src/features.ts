import {
  ANALYSIS_SAMPLE_RATE,
  BAND_EDGES_HZ,
  DISQUALIFYING_FLAGS,
  FEATURE_COUNT,
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  FRAME_MS,
  FRAME_SIZE,
  HOP_SIZE,
  type QualityFlag,
} from './spec.ts';
import { FFT, hannWindow } from './fft.ts';

const EPS = 1e-12;
const fft = new FFT(FRAME_SIZE);
const window = hannWindow(FRAME_SIZE);
const BIN_HZ = ANALYSIS_SAMPLE_RATE / FRAME_SIZE;

export interface FrameAnalysis {
  /** 21 finite features in FEATURE_NAMES order. */
  features: number[];
  flags: QualityFlag[];
  rms: number;
  peak: number;
}

export interface FeatureFrame {
  endMs: number;
  features: number[];
  flags: QualityFlag[];
}

function log10(value: number): number {
  return Math.log(value) / Math.LN10;
}

function percentileRolloff(power: Float64Array, fraction: number): number {
  let total = 0;
  for (let i = 0; i < power.length; i += 1) total += power[i]!;
  if (total <= EPS) return 0;
  const target = total * fraction;
  let acc = 0;
  for (let i = 0; i < power.length; i += 1) {
    acc += power[i]!;
    if (acc >= target) return (i * BIN_HZ) / (ANALYSIS_SAMPLE_RATE / 2);
  }
  return 1;
}

/**
 * Extracts features from one 2048-sample window. `previousMagnitudes` enables
 * spectral flux; pass null for the first frame of a take.
 */
export function analyseWindow(
  samples: Float32Array,
  previousMagnitudes: Float64Array | null,
): { analysis: FrameAnalysis; magnitudes: Float64Array } {
  if (samples.length !== FRAME_SIZE) {
    throw new Error(`Expected ${FRAME_SIZE} samples, received ${samples.length}`);
  }

  let peak = 0;
  let sumSquares = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSquares += v * v;
    if (i > 0 && ((samples[i - 1]! >= 0 && v < 0) || (samples[i - 1]! < 0 && v >= 0))) {
      zeroCrossings += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / samples.length);

  const magnitudes = fft.magnitudes(samples, window);
  const power = new Float64Array(magnitudes.length);
  let powerSum = 0;
  for (let i = 1; i < magnitudes.length; i += 1) {
    const p = magnitudes[i]! * magnitudes[i]!;
    power[i] = p;
    powerSum += p;
  }

  let centroid = 0;
  let spread = 0;
  let dominantBin = 1;
  let dominantPower = 0;
  for (let i = 1; i < power.length; i += 1) {
    const p = power[i]!;
    centroid += i * BIN_HZ * p;
    if (p > dominantPower) {
      dominantPower = p;
      dominantBin = i;
    }
  }
  if (powerSum > EPS) centroid /= powerSum;

  for (let i = 1; i < power.length; i += 1) {
    const diff = i * BIN_HZ - centroid;
    spread += diff * diff * power[i]!;
  }
  if (powerSum > EPS) spread = Math.sqrt(spread / powerSum);

  let logPowerSum = 0;
  let count = 0;
  for (let i = 1; i < power.length; i += 1) {
    logPowerSum += Math.log(power[i]! + EPS);
    count += 1;
  }
  const geometricMean = Math.exp(logPowerSum / Math.max(1, count));
  const arithmeticMean = powerSum / Math.max(1, count);
  const flatness = arithmeticMean > EPS ? Math.min(1, geometricMean / arithmeticMean) : 0;

  let flux = 0;
  if (previousMagnitudes) {
    const n = Math.min(previousMagnitudes.length, magnitudes.length);
    for (let i = 1; i < n; i += 1) {
      const diff = magnitudes[i]! - previousMagnitudes[i]!;
      if (diff > 0) flux += diff * diff;
    }
    flux /= Math.max(1, n);
  }

  const nyquist = ANALYSIS_SAMPLE_RATE / 2;
  const bands: number[] = [];
  let lowEnergy = 0;
  let highEnergy = 0;
  for (let b = 0; b < BAND_EDGES_HZ.length - 1; b += 1) {
    const startHz = BAND_EDGES_HZ[b]!;
    const endHz = BAND_EDGES_HZ[b + 1]!;
    const startBin = Math.max(1, Math.floor(startHz / BIN_HZ));
    const endBin = Math.min(power.length - 1, Math.ceil(endHz / BIN_HZ));
    let energy = 0;
    for (let i = startBin; i <= endBin; i += 1) energy += power[i]!;
    bands.push(log10(energy + EPS));
    if (b < 4) lowEnergy += energy;
    else highEnergy += energy;
  }

  const dominantFrequency = (dominantBin * BIN_HZ) / nyquist;
  let harmonicEnergy = 0;
  let fundamentalEnergy = 0;
  for (const multiple of [2, 3]) {
    const bin = dominantBin * multiple;
    if (bin < magnitudes.length) {
      harmonicEnergy += magnitudes[bin]!;
    }
  }
  fundamentalEnergy = magnitudes[dominantBin]!;
  const harmonicRatio =
    fundamentalEnergy > EPS ? Math.min(1, harmonicEnergy / (fundamentalEnergy * 2)) : 0;

  // Linear regression of log power over normalised frequency.
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let slopeBins = 0;
  const step = 4;
  for (let i = 1; i < power.length; i += step) {
    const x = i / power.length;
    const y = Math.log(power[i]! + EPS);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    slopeBins += 1;
  }
  const denom = slopeBins * sumXX - sumX * sumX;
  const slope = Math.abs(denom) > EPS ? (slopeBins * sumXY - sumX * sumY) / denom : 0;

  const lowHigh =
    highEnergy > EPS ? Math.min(20, Math.log10((lowEnergy + EPS) / (highEnergy + EPS))) : 20;

  const values = [
    log10(rms + EPS),
    zeroCrossings / samples.length,
    centroid / nyquist,
    spread / nyquist,
    percentileRolloff(power, 0.85),
    flatness,
    flux,
    rms > EPS ? Math.min(50, peak / rms) : 0,
    dominantFrequency,
    harmonicRatio,
    ...bands,
    slope / 20,
    peak,
    lowHigh,
  ];

  if (values.length !== FEATURE_COUNT) {
    throw new Error(`Feature count mismatch: ${values.length} vs ${FEATURE_COUNT}`);
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i]!)) values[i] = 0;
  }

  const flags: QualityFlag[] = [];
  if (peak >= 0.98) flags.push('CLIPPED');
  if (rms < 1e-5) flags.push('SILENT');
  else if (rms < 0.0015) flags.push('LOW_LEVEL');

  return {
    analysis: { features: values, flags, rms, peak },
    magnitudes,
  };
}

export interface ExtractOptions {
  /** Override for tests / non-16k analysis (must already be resampled). */
  sampleRate?: number;
}

/**
 * Slides the analysis window over a contiguous 16kHz signal.
 * Returns frames with timestamps relative to the start of the take.
 */
export function extractFrames(samples: Float32Array, opts: ExtractOptions = {}): FeatureFrame[] {
  const sampleRate = opts.sampleRate ?? ANALYSIS_SAMPLE_RATE;
  if (sampleRate !== ANALYSIS_SAMPLE_RATE) {
    throw new Error('extractFrames requires 16kHz audio; resample before analysis');
  }
  const frames: FeatureFrame[] = [];
  let previous: Float64Array | null = null;
  for (let offset = 0; offset + FRAME_SIZE <= samples.length; offset += HOP_SIZE) {
    const windowSamples = samples.subarray(offset, offset + FRAME_SIZE);
    const { analysis, magnitudes } = analyseWindow(windowSamples, previous);
    previous = magnitudes;
    frames.push({
      endMs: ((offset + FRAME_SIZE) / ANALYSIS_SAMPLE_RATE) * 1000,
      features: analysis.features,
      flags: analysis.flags,
    });
  }
  return frames;
}

export function summariseQuality(frames: FeatureFrame[]): {
  frameCount: number;
  durationMs: number;
  clippedRatio: number;
  silentRatio: number;
  lowLevelRatio: number;
  usableFrames: number;
} {
  let clipped = 0;
  let silent = 0;
  let low = 0;
  let usable = 0;
  for (const frame of frames) {
    if (frame.flags.includes('CLIPPED')) clipped += 1;
    if (frame.flags.includes('SILENT')) silent += 1;
    if (frame.flags.includes('LOW_LEVEL')) low += 1;
    if (!frame.flags.some((f) => DISQUALIFYING_FLAGS.includes(f))) usable += 1;
  }
  const frameCount = frames.length;
  return {
    frameCount,
    durationMs: frameCount > 0 ? frames[frameCount - 1]!.endMs : 0,
    clippedRatio: frameCount ? clipped / frameCount : 0,
    silentRatio: frameCount ? silent / frameCount : 0,
    lowLevelRatio: frameCount ? low / frameCount : 0,
    usableFrames: usable,
  };
}

export const FEATURE_META = {
  version: FEATURE_SPEC_VERSION,
  names: FEATURE_NAMES,
  frameMs: FRAME_MS,
  windowMs: (FRAME_SIZE / ANALYSIS_SAMPLE_RATE) * 1000,
};

export { FRAME_MS, FRAME_SIZE, HOP_SIZE, ANALYSIS_SAMPLE_RATE };
