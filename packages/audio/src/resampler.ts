import { ANALYSIS_SAMPLE_RATE } from './spec.ts';

/** Direct-form II transposed biquad low-pass (Butterworth Q). */
class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(sampleRate: number, cutoffHz: number, q: number) {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosw0) / 2) / a0;
    this.b1 = (1 - cosw0) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Streaming linear resampler with a cascaded 4th-order anti-alias low-pass.
 * Handles arbitrary input block sizes and retains phase across blocks.
 */
export class StreamingResampler {
  readonly inputRate: number;
  readonly outputRate: number;
  private readonly filters: Biquad[];
  private position = 0; // fractional read position in the buffered input
  private buffer: number[] = [];
  private consumed = 0;

  constructor(inputRate: number, outputRate: number = ANALYSIS_SAMPLE_RATE) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error('Invalid input sample rate');
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    if (inputRate === outputRate) {
      this.filters = [];
      return;
    }
    const cutoff = Math.min(7200, outputRate * 0.45);
    this.filters = [new Biquad(inputRate, cutoff, 0.7071), new Biquad(inputRate, cutoff, 0.7071)];
  }

  get ratio(): number {
    return this.inputRate / this.outputRate;
  }

  reset(): void {
    for (const filter of this.filters) filter.reset();
    this.position = 0;
    this.buffer = [];
    this.consumed = 0;
  }

  push(block: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) return Float32Array.from(block);

    const filtered = new Float32Array(block.length);
    for (let i = 0; i < block.length; i += 1) {
      let v = block[i]!;
      for (const filter of this.filters) v = filter.process(v);
      filtered[i] = v;
    }

    for (let i = 0; i < filtered.length; i += 1) this.buffer.push(filtered[i]!);
    const ratio = this.ratio;
    const output: number[] = [];

    // Need two samples around the fractional position for interpolation.
    while (this.position + 1 < this.buffer.length) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = this.buffer[index]!;
      const b = this.buffer[index + 1]!;
      output.push(a + (b - a) * frac);
      this.position += ratio;
    }

    const drop = Math.floor(this.position);
    if (drop > 0) {
      this.buffer.splice(0, drop);
      this.position -= drop;
    }
    this.consumed += block.length;
    return Float32Array.from(output);
  }
}

/** One-shot resampling used for imported files and fixture evaluation. */
export function resample(input: Float32Array, inputRate: number, outputRate = ANALYSIS_SAMPLE_RATE): Float32Array {
  if (inputRate === outputRate) return input;
  const stream = new StreamingResampler(inputRate, outputRate);
  const blockSize = Math.max(1, Math.round(inputRate * 0.1));
  const chunks: Float32Array[] = [];
  for (let offset = 0; offset < input.length; offset += blockSize) {
    chunks.push(stream.push(input.subarray(offset, Math.min(input.length, offset + blockSize))));
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
