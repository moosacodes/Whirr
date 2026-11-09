# Performance measurements

Measured locally on 9 November 2026 with `npm run bench`. The machine was a Windows x64 host, Node v24.22.1, Intel Core i5-10400F. These are local microbenchmarks with a warm process and the synthetic reference fixture. They are not field latency, network, mobile-device or cold-start measurements.

| Path | Measurement |
| --- | --- |
| Fixture | 1,715 frames / 54,976 ms of audio |
| Classifier inference | 3.71 ms per full fixture pass; 0.00217 ms/frame; ~14,800× real-time |
| Inference + hysteresis meter | 3.66 ms per full fixture pass; 0.00213 ms/frame; ~15,000× real-time |
| v3 proof verification | 2.79 ms per verification over 50 iterations; 21 checks; valid |

The meter benchmark includes the same local classifier and `MeterStream` path used by the browser. It excludes AudioWorklet capture, microphone device latency, network upload and React rendering.

## Production bundle

| Build | Main JS | Main JS gzip | Warning |
| --- | --- | --- | --- |
| Before route splitting | 592.20 kB | 172.61 kB | Chunk larger than 500 kB |
| 3.0.1 after `React.lazy`/`Suspense` | 290.23 kB | 92.69 kB | None |

The main bundle fell by 50.99% raw and 46.30% gzip. Route-level chunks now load on demand; the authentication, receipt, proof, audio and operator surfaces are no longer in the initial entry chunk. Initial LCP was not instrumented, so no LCP improvement is claimed.

## Reproduce

```bash
npm run bench
npm run build
```

`docs/performance.json` contains the exact machine-readable output. Re-run on the target machine before making hardware-specific claims.
