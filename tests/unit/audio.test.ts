import { describe, expect, it } from 'vitest';
import { encodeWav16, parseWav } from '../../packages/audio/src/wav.ts';
import { extractFrames } from '../../packages/audio/src/features.ts';
import { resample } from '../../packages/audio/src/resampler.ts';
import {
  ANALYSIS_SAMPLE_RATE,
  FEATURE_COUNT,
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
} from '../../packages/audio/src/spec.ts';

function sine(seconds: number, frequency: number, sampleRate = ANALYSIS_SAMPLE_RATE, amplitude = 0.4): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
  }
  return out;
}

describe('acoustic pipeline', () => {
  it('roundtrips 16-bit PCM WAV without losing the sample shape', () => {
    const samples = sine(0.25, 440);
    const encoded = encodeWav16(samples, ANALYSIS_SAMPLE_RATE);
    const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
    const parsed = parseWav(buffer);
    expect(parsed.sampleRate).toBe(ANALYSIS_SAMPLE_RATE);
    expect(parsed.channels).toBe(1);
    expect(parsed.samples.length).toBe(samples.length);
    expect(parsed.samples[100]).toBeCloseTo(samples[100]!, 3);
  });

  it('resamples 48k audio to the frozen 16k analysis rate', () => {
    const source = sine(0.5, 300, 48_000);
    const converted = resample(source, 48_000, 16_000);
    expect(Math.abs(converted.length - 8000)).toBeLessThanOrEqual(2);
    const frames = extractFrames(converted);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames[0]!.features).toHaveLength(FEATURE_COUNT);
  });

  it('uses a 21-dimensional, frozen feature spec with finite values', () => {
    const frames = extractFrames(sine(1, 220));
    expect(FEATURE_NAMES).toHaveLength(21);
    expect(FEATURE_COUNT).toBe(21);
    expect(FEATURE_SPEC_VERSION).toBe('whirr-features-v1');
    expect(frames.length).toBe(28);
    for (const value of frames[0]!.features) expect(Number.isFinite(value)).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const a = extractFrames(sine(1, 220));
    const b = extractFrames(sine(1, 220));
    expect(a.map((frame) => frame.features)).toEqual(b.map((frame) => frame.features));
  });
});
