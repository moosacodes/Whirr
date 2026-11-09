import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../apps/api/src/db/index.ts';
import { predictFrame, type ModelArtifact } from '../packages/audio/src/classifier.ts';
import { extractFrames } from '../packages/audio/src/features.ts';
import { MeterStream } from '../packages/audio/src/hysteresis.ts';
import { resample } from '../packages/audio/src/resampler.ts';
import { parseWav } from '../packages/audio/src/wav.ts';
import { verifyDocument } from '../packages/verify/src/index.ts';
import { REFERENCE_FIXTURE_PATH, REFERENCE_MODEL_PATH } from './reference-config.ts';

function elapsedMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function elapsedAsyncMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function loadFrames() {
  const buffer = readFileSync(REFERENCE_FIXTURE_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const wav = parseWav(arrayBuffer);
  const samples = wav.sampleRate === 16_000 ? wav.samples : resample(wav.samples, wav.sampleRate, 16_000);
  return extractFrames(samples);
}

async function main(): Promise<void> {
  const artifact = JSON.parse(readFileSync(REFERENCE_MODEL_PATH, 'utf8')) as ModelArtifact;
  const frames = loadFrames();
  const inferencePasses = 20;
  const meterPasses = 20;
  const proofPasses = 50;

  for (let i = 0; i < 3; i += 1) {
    for (const frame of frames) {
      predictFrame(artifact, frame.features, frame.flags, Math.max(0, frame.endMs - 32), frame.endMs);
    }
  }

  const inferenceMs = elapsedMs(() => {
    for (let pass = 0; pass < inferencePasses; pass += 1) {
      for (const frame of frames) {
        predictFrame(artifact, frame.features, frame.flags, Math.max(0, frame.endMs - 32), frame.endMs);
      }
    }
  }) / inferencePasses;

  const meterMs = elapsedMs(() => {
    for (let pass = 0; pass < meterPasses; pass += 1) {
      const meter = new MeterStream(artifact.policy);
      meter.reset(0);
      for (const frame of frames) {
        meter.push(predictFrame(artifact, frame.features, frame.flags, Math.max(0, frame.endMs - 32), frame.endMs));
      }
      meter.flush(frames.at(-1)?.endMs ?? 0);
    }
  }) / meterPasses;

  let proof: { iterations: number; msPerVerification: number; checks: number; valid: boolean } | null = null;
  try {
    const store = new Store(path.resolve('data/whirr.db'));
    const row = store.get<{ document_json: string }>(
      'SELECT document_json FROM proof_bundles ORDER BY created_at DESC LIMIT 1',
    );
    store.close();
    if (row) {
      const bundle = JSON.parse(row.document_json) as unknown;
      for (let i = 0; i < 3; i += 1) await verifyDocument(bundle);
      const total = await elapsedAsyncMs(async () => {
        for (let i = 0; i < proofPasses; i += 1) await verifyDocument(bundle);
      });
      const last = await verifyDocument(bundle);
      proof = {
        iterations: proofPasses,
        msPerVerification: total / proofPasses,
        checks: last.checks.length,
        valid: last.valid,
      };
    }
  } catch {
    proof = null;
  }

  const durationMs = frames.at(-1)?.endMs ?? 0;
  const result = {
    schema: 'whirr.performance.v1',
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
    },
    fixture: { frames: frames.length, durationMs },
    classifier: {
      passes: inferencePasses,
      inferenceMs,
      msPerFrame: inferenceMs / frames.length,
      realtimeFactor: inferenceMs > 0 ? durationMs / inferenceMs : null,
    },
    meter: {
      passes: meterPasses,
      inferenceAndHysteresisMs: meterMs,
      msPerFrame: meterMs / frames.length,
      realtimeFactor: meterMs > 0 ? durationMs / meterMs : null,
    },
    proofVerification: proof,
  };
  const output = path.resolve('docs/performance.json');
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), output)}`);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(`Benchmark failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
