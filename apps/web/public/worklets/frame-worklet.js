/**
 * Whirr frame worklet.
 *
 * Runs on the audio rendering thread. It does not classify audio; it only
 * accumulates mono blocks and transfers them to the main thread, where the
 * frozen feature extractor and classifier run identically to Node training.
 */
class WhirrFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockSize = Math.max(1024, Math.round(sampleRate * 0.1));
    this.buffer = new Float32Array(this.blockSize);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'reset') {
        this.offset = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelCount = input.length;
    const frames = input[0].length;

    for (let i = 0; i < frames; i += 1) {
      let mono = 0;
      for (let c = 0; c < channelCount; c += 1) {
        const channel = input[c];
        mono += channel && channel.length > i ? channel[i] : 0;
      }
      this.buffer[this.offset] = mono / channelCount;
      this.offset += 1;
      if (this.offset >= this.blockSize) {
        const copy = new Float32Array(this.blockSize);
        copy.set(this.buffer);
        this.port.postMessage({ type: 'block', samples: copy, sampleRate }, [copy.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('whirr-frame', WhirrFrameProcessor);
