import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeWav16 } from '../packages/audio/src/wav.ts';
import { extractFrames } from '../packages/audio/src/features.ts';
import { ANALYSIS_SAMPLE_RATE, FEATURE_SPEC_VERSION } from '../packages/audio/src/spec.ts';
import type { TrainingTake, TakeLabel } from '../packages/audio/src/training.ts';
import { hashCanonical, sha256Hex } from '../apps/api/src/lib/hash.ts';
import {
  REFERENCE_DATASET_SUMMARY_PATH,
  REFERENCE_FIXTURE_GENERATED_PATH,
  REFERENCE_FIXTURE_PATH,
  REFERENCE_FIXTURE_PUBLIC_PATH,
  REFERENCE_LABEL,
  ROOT,
} from './reference-config.ts';

const SR = ANALYSIS_SAMPLE_RATE;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillIdle(out: Float32Array, rng: () => number, gain = 1): void {
  let brown = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    brown = 0.98 * brown + 0.02 * white;
    const hum = Math.sin(2 * Math.PI * 60 * t) * 0.0012 + Math.sin(2 * Math.PI * 180 * t) * 0.0004;
    out[i] = (brown * 0.12 + white * 0.006 + hum) * gain;
  }
}

interface FanOptions {
  gain: number;
  baseHz: number;
  modulationHz: number;
  brightness: number;
}

function fillFan(out: Float32Array, rng: () => number, options: FanOptions): void {
  let brown = 0;
  let broad = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    brown = 0.94 * brown + 0.06 * white;
    broad = 0.72 * broad + 0.28 * white;
    const breath = brown * 0.55 + broad * 0.1;
    const tone =
      Math.sin(2 * Math.PI * options.baseHz * t) * 0.011 +
      Math.sin(2 * Math.PI * options.baseHz * 2 * t) * 0.005 +
      Math.sin(2 * Math.PI * options.baseHz * 3 * t) * 0.0025;
    const modulation =
      1 + 0.12 * Math.sin(2 * Math.PI * options.modulationHz * t) + 0.04 * Math.sin(2 * Math.PI * 0.55 * t);
    out[i] = (breath + tone * options.brightness) * modulation * options.gain;
  }
}

function fillHairDryer(out: Float32Array, rng: () => number): void {
  let previousWhite = 0;
  let high = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    high = 0.14 * (high + white - previousWhite);
    previousWhite = white;
    out[i] =
      high * 0.38 +
      Math.sin(2 * Math.PI * 3140 * t) * 0.014 +
      Math.sin(2 * Math.PI * 6280 * t) * 0.004;
  }
}

function fillMusic(out: Float32Array, rng: () => number): void {
  const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const step = Math.floor(t / 0.45) % notes.length;
    const frequency = notes[step]!;
    const phase = (t % 0.45) / 0.45;
    const envelope = Math.exp(-3.1 * phase);
    const wobble = 1 + 0.003 * (rng() * 2 - 1);
    out[i] =
      (Math.sin(2 * Math.PI * frequency * t) + 0.35 * Math.sin(2 * Math.PI * frequency * 2 * t)) *
      0.05 *
      envelope *
      wobble;
  }
}

function fillSpeechLike(out: Float32Array, rng: () => number): void {
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const f0 = 112 + 9 * Math.sin(2 * Math.PI * 2.7 * t);
    let value = 0;
    for (let harmonic = 1; harmonic <= 9; harmonic += 1) {
      const formant = harmonic <= 3 ? 1 / harmonic : 0.35 / harmonic;
      value += formant * Math.sin(2 * Math.PI * f0 * harmonic * t + harmonic * 0.4);
    }
    const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.4 * t);
    out[i] = value * 0.018 * envelope + (rng() * 2 - 1) * 0.002;
  }
}

function fillKettle(out: Float32Array, rng: () => number): void {
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    out[i] =
      Math.sin(2 * Math.PI * 2480 * t) * 0.026 +
      Math.sin(2 * Math.PI * 4960 * t) * 0.012 +
      (rng() * 2 - 1) * 0.012;
  }
}

function fillClatter(out: Float32Array, rng: () => number): void {
  let burst = 0;
  for (let i = 0; i < out.length; i += 1) {
    const phase = i % Math.round(SR * 0.24);
    if (phase === 0) burst = 1;
    if (phase < 500) {
      const decay = Math.exp(-phase / 120) * burst;
      out[i] = (rng() * 2 - 1) * 0.22 * decay;
      burst *= 0.999;
    } else {
      out[i] = (rng() * 2 - 1) * 0.003;
    }
  }
}

function fillVacuum(out: Float32Array, rng: () => number): void {
  let low = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    low = 0.9 * low + 0.1 * white;
    out[i] =
      low * 0.16 +
      Math.sin(2 * Math.PI * 420 * t) * 0.018 +
      Math.sin(2 * Math.PI * 840 * t) * 0.006 +
      white * 0.006;
  }
}

function makeTake(
  id: string,
  label: TakeLabel,
  seconds: number,
  seed: number,
  render: (out: Float32Array, rng: () => number) => void,
): TrainingTake {
  const frameCount = Math.round(seconds * SR);
  const samples = new Float32Array(frameCount);
  render(samples, mulberry32(seed));
  const frames = extractFrames(samples);
  return {
    id,
    label,
    frames: frames.map((frame) => frame.features),
    frameFlags: frames.map((frame) => frame.flags),
    durationMs: Math.round((frameCount / SR) * 1000),
  };
}

export interface ReferenceData {
  takes: TrainingTake[];
  datasetHash: string;
  fixture: Uint8Array;
  fixtureDurationMs: number;
  fixtureLabel: string;
  fixtureSegments: Array<{ name: string; startMs: number; endMs: number; expected: 'idle' | 'active' }>;
  peakAmplitude: number;
}

export function generateReferenceData(): ReferenceData {
  const takes: TrainingTake[] = [
    makeTake('syn-idle-01', 'idle', 6.5, 101, (out, rng) => fillIdle(out, rng, 1)),
    makeTake('syn-idle-02', 'idle', 7, 102, (out, rng) => fillIdle(out, rng, 0.92)),
    makeTake('syn-idle-03', 'idle', 6, 103, (out, rng) => fillIdle(out, rng, 1.08)),
    makeTake('syn-idle-04', 'idle', 7.5, 104, (out, rng) => fillIdle(out, rng, 0.96)),
    makeTake('syn-idle-05', 'idle', 6.5, 105, (out, rng) => fillIdle(out, rng, 1.03)),
    makeTake('syn-active-01', 'active', 7, 201, (out, rng) =>
      fillFan(out, rng, { gain: 1.35, baseHz: 142, modulationHz: 9.6, brightness: 1 }),
    ),
    makeTake('syn-active-02', 'active', 7.5, 202, (out, rng) =>
      fillFan(out, rng, { gain: 1.55, baseHz: 176, modulationHz: 12.2, brightness: 1.1 }),
    ),
    makeTake('syn-active-03', 'active', 6.5, 203, (out, rng) =>
      fillFan(out, rng, { gain: 1.45, baseHz: 118, modulationHz: 8.1, brightness: 0.9 }),
    ),
    makeTake('syn-active-04', 'active', 8, 204, (out, rng) =>
      fillFan(out, rng, { gain: 1.6, baseHz: 198, modulationHz: 13.5, brightness: 1.2 }),
    ),
    makeTake('syn-active-05', 'active', 7, 205, (out, rng) =>
      fillFan(out, rng, { gain: 1.4, baseHz: 156, modulationHz: 10.4, brightness: 1 }),
    ),
    makeTake('syn-negative-01', 'negative', 7, 301, fillHairDryer),
    makeTake('syn-negative-02', 'negative', 6.5, 302, fillMusic),
    makeTake('syn-negative-03', 'negative', 7, 303, fillSpeechLike),
    makeTake('syn-negative-04', 'negative', 6.5, 304, fillKettle),
    makeTake('syn-negative-05', 'negative', 7, 305, fillClatter),
    makeTake('syn-negative-06', 'negative', 7, 306, fillVacuum),
    // Transition takes are deliberately excluded from the reference dataset: a
    // ramping machine is genuinely ambiguous, and labelling the ramp as
    // non-active would create false billable frames. Hysteresis handles the
    // boundary live; the safety gate must not be weakened to excuse it.
  ];

  const datasetHash = hashCanonical({
    schema: 'whirr.synthetic-dataset.v1',
    featureSpecVersion: FEATURE_SPEC_VERSION,
    takes: takes.map((take) => ({
      id: take.id,
      label: take.label,
      frames: take.frames.length,
      durationMs: take.durationMs,
      framesHash: sha256Hex(JSON.stringify(take.frames)),
    })),
  });

  const segments: ReferenceData['fixtureSegments'] = [
    { name: 'idle', startMs: 0, endMs: 5_000, expected: 'idle' },
    { name: 'running', startMs: 5_000, endMs: 20_000, expected: 'active' },
    { name: 'idle', startMs: 20_000, endMs: 30_000, expected: 'idle' },
    { name: 'running', startMs: 30_000, endMs: 50_000, expected: 'active' },
    { name: 'idle', startMs: 50_000, endMs: 55_000, expected: 'idle' },
  ];
  const totalMs = segments[segments.length - 1]!.endMs;
  const samples = new Float32Array(Math.round((totalMs / 1000) * SR));
  const rng = mulberry32(7_311);
  for (const segment of segments) {
    const start = Math.round((segment.startMs / 1000) * SR);
    const length = Math.round(((segment.endMs - segment.startMs) / 1000) * SR);
    const scratch = new Float32Array(length);
    if (segment.expected === 'idle') fillIdle(scratch, rng, 1.02);
    else fillFan(scratch, rng, { gain: 1.48, baseHz: 168, modulationHz: 11.4, brightness: 1.05 });
    samples.set(scratch, start);
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.92) {
    const scale = 0.9 / peak;
    for (let i = 0; i < samples.length; i += 1) samples[i] = samples[i]! * scale;
  }
  const fixture = encodeWav16(samples, SR);

  return { takes, datasetHash, fixture, fixtureDurationMs: totalMs, fixtureLabel: REFERENCE_LABEL, fixtureSegments: segments, peakAmplitude: peak };
}

export function writeReferenceFixtures(): ReferenceData {
  const data = generateReferenceData();
  for (const target of [REFERENCE_FIXTURE_PATH, REFERENCE_FIXTURE_GENERATED_PATH, REFERENCE_FIXTURE_PUBLIC_PATH]) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data.fixture);
  }
  mkdirSync(path.dirname(REFERENCE_DATASET_SUMMARY_PATH), { recursive: true });
  writeFileSync(
    REFERENCE_DATASET_SUMMARY_PATH,
    `${JSON.stringify(
      {
        schema: 'whirr.synthetic-dataset-summary.v1',
        provenance: 'SYNTHETIC_REFERENCE',
        warning:
          'Procedurally synthesised audio. This dataset demonstrates the pipeline; it is not a field recording of a physical object.',
        createdAt: new Date().toISOString(),
        datasetHash: data.datasetHash,
        fixture: {
          path: 'fixtures/fan-cycle.wav',
          durationMs: data.fixtureDurationMs,
          label: data.fixtureLabel,
          segments: data.fixtureSegments,
        },
        takes: data.takes.map((take) => ({
          id: take.id,
          label: take.label,
          frames: take.frames.length,
          durationMs: take.durationMs,
        })),
      },
      null,
      2,
    )}\n`,
  );
  return data;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const data = writeReferenceFixtures();
  console.log(`Synthetic reference dataset written under ${path.join(ROOT, 'fixtures')}`);
  console.log(`  takes: ${data.takes.length}`);
  console.log(`  fixture: ${data.fixtureDurationMs / 1000}s · ${data.fixtureLabel}`);
  console.log(`  dataset hash: ${data.datasetHash}`);
  console.log('  provenance: SYNTHETIC_REFERENCE (not a field recording)');
}
