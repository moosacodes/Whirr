/**
 * Frozen acoustic feature specification.
 *
 * Training (Node) and inference (browser) MUST use this exact spec. Any change
 * requires a new FEATURE_SPEC_VERSION; models are pinned to the spec hash.
 */

export const ANALYSIS_SAMPLE_RATE = 16_000;
export const FRAME_SIZE = 2_048;
export const HOP_SIZE = 512;
export const FRAME_MS = (HOP_SIZE / ANALYSIS_SAMPLE_RATE) * 1000; // 32ms
export const WINDOW_MS = (FRAME_SIZE / ANALYSIS_SAMPLE_RATE) * 1000; // 128ms
export const MIN_FRAMES_PER_TAKE = 60;

export const BAND_EDGES_HZ = [50, 120, 250, 500, 1000, 2000, 4000, 6000, 7800] as const;

export const BAND_NAMES = [
  'band_50_120',
  'band_120_250',
  'band_250_500',
  'band_500_1000',
  'band_1000_2000',
  'band_2000_4000',
  'band_4000_6000',
  'band_6000_7800',
] as const;

export const FEATURE_NAMES = [
  'log_rms',
  'zero_cross_rate',
  'spectral_centroid',
  'spectral_spread',
  'spectral_rolloff',
  'spectral_flatness',
  'spectral_flux',
  'crest_factor',
  'dominant_frequency',
  'harmonic_ratio',
  ...BAND_NAMES,
  'spectral_slope',
  'peak_amplitude',
  'low_high_ratio',
] as const;

export const FEATURE_COUNT = FEATURE_NAMES.length;

export const FEATURE_SPEC_VERSION = 'whirr-features-v1';

export type QualityFlag =
  | 'CLIPPED'
  | 'SILENT'
  | 'LOW_LEVEL'
  | 'GAP'
  | 'DEVICE_LOST'
  | 'TAB_HIDDEN'
  | 'SOUNDPRINT_MISMATCH';

export const QUALITY_FLAGS: readonly QualityFlag[] = [
  'CLIPPED',
  'SILENT',
  'LOW_LEVEL',
  'GAP',
  'DEVICE_LOST',
  'TAB_HIDDEN',
  'SOUNDPRINT_MISMATCH',
];

/** Flags that make a frame unusable as billable evidence. */
export const DISQUALIFYING_FLAGS: readonly QualityFlag[] = [
  'CLIPPED',
  'SILENT',
  'LOW_LEVEL',
  'GAP',
  'DEVICE_LOST',
  'TAB_HIDDEN',
  'SOUNDPRINT_MISMATCH',
];

export interface FeatureSpec {
  version: string;
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  frameMs: number;
  windowMs: number;
  featureNames: readonly string[];
  bandEdgesHz: readonly number[];
  qualityFlags: readonly string[];
}

export const FEATURE_SPEC: FeatureSpec = {
  version: FEATURE_SPEC_VERSION,
  sampleRate: ANALYSIS_SAMPLE_RATE,
  frameSize: FRAME_SIZE,
  hopSize: HOP_SIZE,
  frameMs: FRAME_MS,
  windowMs: WINDOW_MS,
  featureNames: FEATURE_NAMES,
  bandEdgesHz: BAND_EDGES_HZ,
  qualityFlags: QUALITY_FLAGS,
};

export function isQualityFlag(value: unknown): value is QualityFlag {
  return typeof value === 'string' && (QUALITY_FLAGS as readonly string[]).includes(value);
}

export function isFeatureVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === FEATURE_COUNT &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}
