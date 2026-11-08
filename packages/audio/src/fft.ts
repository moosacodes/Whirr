/** Small, dependency-free radix-2 FFT used identically in Node and the browser. */

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export class FFT {
  readonly size: number;
  private readonly reverse: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 8 || (size & (size - 1)) !== 0) {
      throw new Error('FFT size must be a power of two >= 8');
    }
    this.size = size;
    const levels = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i += 1) {
      let r = 0;
      for (let b = 0; b < levels; b += 1) {
        r = (r << 1) | ((i >>> b) & 1);
      }
      this.reverse[i] = r;
    }
    this.cosTable = new Float64Array(size / 2);
    this.sinTable = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  /**
   * Returns the magnitude spectrum of a real signal, length size/2.
   * Magnitudes are normalised by the window sum so a full-scale sine yields
   * roughly 0.5 at its bin, independent of FFT size.
   */
  magnitudes(samples: Float32Array | Float64Array, window: Float64Array | Float32Array): Float64Array {
    const n = this.size;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let windowSum = 0;
    for (let i = 0; i < n; i += 1) {
      const w = i < window.length ? window[i]! : 1;
      const s = i < samples.length ? samples[i]! : 0;
      re[this.reverse[i]!] = s * w;
      windowSum += w;
    }
    if (windowSum === 0) windowSum = 1;

    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j += 1, k += step) {
          const c = this.cosTable[k]!;
          const s = this.sinTable[k]!;
          const tre = re[j + half]! * c + im[j + half]! * s;
          const tim = -re[j + half]! * s + im[j + half]! * c;
          re[j + half] = re[j]! - tre;
          im[j + half] = im[j]! - tim;
          re[j] = re[j]! + tre;
          im[j] = im[j]! + tim;
        }
      }
    }

    const out = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) {
      out[i] = (Math.sqrt(re[i]! * re[i]! + im[i]! * im[i]!) * 2) / windowSum;
    }
    return out;
  }
}

export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

export function padToPowerOfTwo(samples: Float32Array): Float32Array {
  const size = nextPowerOfTwo(samples.length);
  if (size === samples.length) return samples;
  const out = new Float32Array(size);
  out.set(samples);
  return out;
}
