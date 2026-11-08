import { BAND_EDGES_HZ, FEATURE_NAMES } from './spec.ts';

/**
 * An acoustic passport is an enrollment-time identity check, not a second
 * classifier. It asks whether the spectral shape of a confidently active
 * frame still resembles the object the operator taught. It can make a bill
 * more conservative; it can never turn a non-active frame into billable time.
 */
export const SOUNDPRINT_SCHEMA = 'whirr.soundprint.v1';
export const SOUNDPRINT_METHOD = 'BAND_PROFILE_COSINE';

const BAND_FEATURE_INDICES = FEATURE_NAMES
  .map((name, index) => (name.startsWith('band_') ? index : -1))
  .filter((index) => index >= 0);

export interface SoundprintBand {
  fromHz: number;
  toHz: number;
  /** Mean normalised energy share for active calibration frames. */
  active: number;
  /** Mean normalised energy share for idle/negative calibration frames. */
  idle: number;
}

export interface Soundprint {
  schema: typeof SOUNDPRINT_SCHEMA;
  method: typeof SOUNDPRINT_METHOD;
  status: 'ENROLLED' | 'WEAK';
  gateEnabled: boolean;
  /** A live active frame below this cosine similarity becomes UNCERTAIN. */
  matchThreshold: number;
  bands: SoundprintBand[];
  activeMedianSimilarity: number;
  activeP10Similarity: number;
  nonActiveP95Similarity: number;
  separation: number;
  activeFrames: number;
  nonActiveFrames: number;
  activeTakeCount: number;
  /** Share of active calibration frames the gate would have blocked. */
  activeBlockRatio: number;
  /** Share of non-active calibration frames the gate would have passed. */
  nonActivePassRatio: number;
  notes: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Converts the eight log-band features into an amplitude-invariant spectral
 * profile. The profile is a shape, so a louder or quieter instance of the same
 * machine lands in roughly the same place.
 */
export function normaliseBandProfile(features: number[]): number[] {
  const energies = BAND_FEATURE_INDICES.map((index) => {
    const logEnergy = Number(features[index] ?? -30);
    if (!Number.isFinite(logEnergy)) return 0;
    return 10 ** clamp(logEnergy, -30, 12);
  });
  const total = energies.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 1e-12) {
    return new Array(BAND_FEATURE_INDICES.length).fill(1 / Math.max(1, BAND_FEATURE_INDICES.length));
  }
  return energies.map((value) => value / total);
}

export function profileSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    const av = Number(a[index] ?? 0);
    const bv = Number(b[index] ?? 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return clamp(dot / Math.sqrt(normA * normB), 0, 1);
}

function meanProfile(rows: number[][]): number[] {
  const count = Math.max(1, rows.length);
  const sums = new Array(BAND_FEATURE_INDICES.length).fill(0);
  for (const row of rows) {
    const profile = normaliseBandProfile(row);
    for (let index = 0; index < sums.length; index += 1) sums[index] += profile[index] ?? 0;
  }
  const mean = sums.map((value) => value / count);
  const total = mean.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-12) return mean.map(() => 1 / Math.max(1, mean.length));
  return mean.map((value) => value / total);
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function round(value: number, digits = 5): number {
  return Number(value.toFixed(digits));
}

export function buildSoundprint(
  activeFrames: number[][],
  nonActiveFrames: number[][],
  activeTakeCount: number,
): Soundprint | null {
  if (activeFrames.length < 30 || nonActiveFrames.length < 30) return null;

  const activeProfile = meanProfile(activeFrames);
  const idleProfile = meanProfile(nonActiveFrames);
  const scoreAgainstActive = (frames: number[][]) =>
    frames.map((frame) => profileSimilarity(normaliseBandProfile(frame), activeProfile));

  const activeScores = scoreAgainstActive(activeFrames).sort((a, b) => a - b);
  const nonActiveScores = scoreAgainstActive(nonActiveFrames).sort((a, b) => a - b);
  const activeMedian = quantile(activeScores, 0.5);
  const activeP10 = quantile(activeScores, 0.1);
  const nonActiveP95 = quantile(nonActiveScores, 0.95);
  const separation = activeP10 - nonActiveP95;

  // Pick a conservative threshold just below the active 10th percentile, but
  // above the non-active ceiling. A gate is only enrolled when it retains
  // active calibration frames *and* rejects most non-active profiles. This
  // uses observed calibration behavior rather than an arbitrary separation
  // number, and still keeps the threshold well below the active median.
  const ceiling = activeP10 - 0.02;
  const candidateThreshold = round(
    Math.min(ceiling, Math.max(0.5, nonActiveP95 + Math.max(0, separation) * 0.45)),
  );
  const activeBlockRatio = activeScores.filter((score) => score < candidateThreshold).length / activeScores.length;
  const nonActivePassRatio =
    nonActiveScores.filter((score) => score >= candidateThreshold).length / nonActiveScores.length;
  const gateEnabled =
    separation >= 0.012 &&
    activeP10 >= 0.58 &&
    activeMedian >= 0.7 &&
    activeBlockRatio <= 0.15 &&
    nonActivePassRatio <= 0.2;
  const threshold = gateEnabled ? candidateThreshold : 0.5;

  const notes = [
    'This is an enrollment-fit consistency guard. It is computed from the calibration takes, not a held-out identity classifier.',
    'It can make active time uncertain; it can never turn idle or ambiguous time into billable time.',
    'A similar or identical machine can share this spectral profile, and recorded playback is not detectable by a microphone.',
  ];
  if (!gateEnabled) {
    notes.unshift(
      'No safe separation was found between active and non-active spectral profiles, so the identity gate is disabled for this model.',
    );
  } else if (separation < 0.035) {
    notes.push(
      'The calibration separation is narrow. The gate is enabled because it retained active frames and rejected most non-active profiles, but it should be rechecked on real sessions and after any room or microphone change.',
    );
  }

  return {
    schema: SOUNDPRINT_SCHEMA,
    method: SOUNDPRINT_METHOD,
    status: gateEnabled ? 'ENROLLED' : 'WEAK',
    gateEnabled,
    matchThreshold: threshold,
    bands: activeProfile.map((active, index) => ({
      fromHz: BAND_EDGES_HZ[index] ?? 0,
      toHz: BAND_EDGES_HZ[index + 1] ?? 0,
      active: round(active),
      idle: round(idleProfile[index] ?? 0),
    })),
    activeMedianSimilarity: round(activeMedian),
    activeP10Similarity: round(activeP10),
    nonActiveP95Similarity: round(nonActiveP95),
    separation: round(separation),
    activeFrames: activeFrames.length,
    nonActiveFrames: nonActiveFrames.length,
    activeTakeCount,
    activeBlockRatio: round(activeBlockRatio, 4),
    nonActivePassRatio: round(nonActivePassRatio, 4),
    notes,
  };
}

export function soundprintScore(soundprint: Soundprint, features: number[]): number {
  return profileSimilarity(
    normaliseBandProfile(features),
    soundprint.bands.map((band) => band.active),
  );
}
