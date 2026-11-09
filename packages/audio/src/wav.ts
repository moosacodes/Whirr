/** Minimal WAV reader: PCM 16/24/32-bit integer and 32-bit float, mono/stereo. */

export interface ParsedWav {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function parseWav(buffer: ArrayBuffer): ParsedWav {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) throw new Error('Not a WAV file: too short');
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let offset = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (chunkId === 'fmt ') {
      if (body + 16 > buffer.byteLength) throw new Error('Malformed fmt chunk');
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataLength = Math.min(chunkSize, buffer.byteLength - body);
    }
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0) throw new Error('WAV is missing fmt or data chunk');
  if (fmt.channels < 1 || fmt.channels > 2) {
    throw new Error(`Unsupported channel count: ${fmt.channels}. Use mono or stereo.`);
  }
  if (![16, 24, 32].includes(fmt.bitsPerSample)) {
    throw new Error(`Unsupported bit depth: ${fmt.bitsPerSample}. Use 16, 24 or 32-bit.`);
  }
  if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) {
    throw new Error('Only uncompressed PCM or IEEE float WAV files are supported');
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameBytes = bytesPerSample * fmt.channels;
  const frameCount = Math.floor(dataLength / frameBytes);
  const samples = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i += 1) {
    let mono = 0;
    for (let c = 0; c < fmt.channels; c += 1) {
      const p = dataOffset + i * frameBytes + c * bytesPerSample;
      let value: number;
      if (fmt.audioFormat === 3 && fmt.bitsPerSample === 32) {
        value = view.getFloat32(p, true);
      } else if (fmt.bitsPerSample === 16) {
        value = view.getInt16(p, true) / 32768;
      } else if (fmt.bitsPerSample === 24) {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getInt8(p + 2);
        value = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      } else if (fmt.audioFormat === 3) {
        value = view.getFloat32(p, true);
      } else {
        value = view.getInt32(p, true) / 2147483648;
      }
      mono += value;
    }
    samples[i] = mono / fmt.channels;
  }

  return {
    samples,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    durationMs: (samples.length / fmt.sampleRate) * 1000,
  };
}

/** Encodes mono float samples as 16-bit PCM WAV (used by the fixture generator). */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const frameCount = samples.length;
  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frameCount * 2, true);
  for (let i = 0; i < frameCount; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}
