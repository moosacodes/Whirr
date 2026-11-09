import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertModelArtifact, predictFrame } from '../packages/audio/src/classifier.ts';
import { MeterStream, type MeterInterval } from '../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../packages/audio/src/spec.ts';
import { extractFrames } from '../packages/audio/src/features.ts';
import { parseWav } from '../packages/audio/src/wav.ts';
import { resample } from '../packages/audio/src/resampler.ts';
import { quoteBreakdown } from '../packages/meter/src/pricing.ts';
import { hashCanonical } from '../apps/api/src/lib/hash.ts';
import {
  REFERENCE_EVALUATION_DOC_PATH,
  REFERENCE_EVALUATION_JSON_PATH,
  REFERENCE_FIXTURE_PATH,
  REFERENCE_LABEL,
  REFERENCE_MODEL_PATH,
  ROOT,
} from './reference-config.ts';

interface Evaluation {
  generatedAt: string;
  modelHash: string;
  datasetHash: string;
  status: string;
  precision: number;
  recall: number;
  falseBillableRatio: number;
  frameAccuracy: number;
  baseline: { precision: number; recall: number; falseBillableRatio: number };
  soundprint: {
    status: string;
    gateEnabled: boolean;
    matchThreshold: number;
    activeMedianSimilarity: number;
    activeP10Similarity: number;
    nonActiveP95Similarity: number;
    separation: number;
    activeBlockRatio: number;
    nonActivePassRatio: number;
    activeFrames: number;
    nonActiveFrames: number;
  } | null;
  fixture: {
    durationMs: number;
    expectedActiveMs: number;
    billableMs: number;
    deltaMs: number;
    simulatedMinor: number;
    formula: string;
    intervals: number;
    states: Record<string, number>;
  };
}

export function evaluateReference(): Evaluation {
  const artifact = JSON.parse(readFileSync(REFERENCE_MODEL_PATH, 'utf8')) as unknown;
  assertModelArtifact(artifact);
  const buffer = readFileSync(REFERENCE_FIXTURE_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const wav = parseWav(arrayBuffer);
  const samples = wav.sampleRate === 16_000 ? wav.samples : resample(wav.samples, wav.sampleRate, 16_000);
  const frames = extractFrames(samples);
  const meter = new MeterStream(artifact.policy);
  meter.reset(0);
  const intervals: MeterInterval[] = [];
  let last = 0;
  for (const frame of frames) {
    last = frame.endMs;
    const prediction = predictFrame(artifact, frame.features, frame.flags, Math.max(0, frame.endMs - FRAME_MS), frame.endMs);
    intervals.push(...meter.push(prediction));
  }
  intervals.push(...meter.flush(last));

  const states: Record<string, number> = {};
  let billableMs = 0;
  for (const interval of intervals) {
    const duration = Math.max(0, interval.endMs - interval.startMs);
    states[interval.state] = (states[interval.state] ?? 0) + duration;
    if (interval.state === 'ACTIVE_CONFIDENT') billableMs += duration;
  }
  const quote = quoteBreakdown(20, billableMs, 500, 0, 'USD');

  return {
    generatedAt: new Date().toISOString(),
    modelHash: hashCanonical(artifact),
    datasetHash: artifact.training.datasetHash,
    status: artifact.status,
    precision: artifact.metrics.precision,
    recall: artifact.metrics.recall,
    falseBillableRatio: artifact.metrics.falseBillableRatio,
    frameAccuracy: artifact.metrics.frameAccuracy,
    baseline: {
      precision: artifact.baseline.precision,
      recall: artifact.baseline.recall,
      falseBillableRatio: artifact.baseline.falseBillableRatio,
    },
    soundprint: artifact.soundprint
      ? {
          status: artifact.soundprint.status,
          gateEnabled: artifact.soundprint.gateEnabled,
          matchThreshold: artifact.soundprint.matchThreshold,
          activeMedianSimilarity: artifact.soundprint.activeMedianSimilarity,
          activeP10Similarity: artifact.soundprint.activeP10Similarity,
          nonActiveP95Similarity: artifact.soundprint.nonActiveP95Similarity,
          separation: artifact.soundprint.separation,
          activeBlockRatio: artifact.soundprint.activeBlockRatio,
          nonActivePassRatio: artifact.soundprint.nonActivePassRatio,
          activeFrames: artifact.soundprint.activeFrames,
          nonActiveFrames: artifact.soundprint.nonActiveFrames,
        }
      : null,
    fixture: {
      durationMs: Math.round(wav.durationMs),
      expectedActiveMs: 35_000,
      billableMs,
      deltaMs: billableMs - 35_000,
      simulatedMinor: quote.finalMinor,
      formula: quote.formula,
      intervals: intervals.length,
      states,
    },
  };
}

function percent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function writeDocument(result: Evaluation): void {
  mkdirSync(path.dirname(REFERENCE_EVALUATION_DOC_PATH), { recursive: true });
  const rows = Object.entries(result.fixture.states)
    .map(([state, ms]) => `| ${state} | ${(ms / 1000).toFixed(2)}s |`)
    .join('\n');
  const content = `# Evaluation

> Generated by \`npm run eval:reference\` on ${result.generatedAt}. Every number below is computed from the bundled synthetic fixture and reference model in this repository. They are **not** field measurements of a physical object.

## Reference model (held-out takes)

| Metric | Value |
| --- | ---: |
| Status | ${result.status} |
| Precision | ${percent(result.precision)} |
| Recall | ${percent(result.recall)} |
| False billable time | ${percent(result.falseBillableRatio, 3)} |
| Frame accuracy | ${percent(result.frameAccuracy)} |
| Method | leave-one-take-out, session-level |
| Model hash | \`${result.modelHash}\` |
| Dataset hash | \`${result.datasetHash}\` |

Precision is the fraction of billed active time that was truly active. False billable time is the fraction of all non-active time that the meter would have billed. Both are computed on held-out takes; no frame is scored by a model that trained on its own take.

## Tuned RMS baseline

| Metric | Learned | RMS threshold |
| --- | ---: | ---: |
| Precision | ${percent(result.precision)} | ${percent(result.baseline.precision)} |
| Recall | ${percent(result.recall)} | ${percent(result.baseline.recall)} |
| False billable time | ${percent(result.falseBillableRatio, 3)} | ${percent(result.baseline.falseBillableRatio, 3)} |

The baseline uses the same frames with a tuned log-RMS threshold. It is included so the learned model can lose; if it wins on your data, report that.

## Acoustic passport

| Metric | Value |
| --- | ---: |
| Status | ${result.soundprint?.status ?? 'NOT ENROLLED'} |
| Identity gate | ${result.soundprint?.gateEnabled ? 'ENABLED' : 'DISABLED'} |
| Match threshold | ${result.soundprint ? percent(result.soundprint.matchThreshold) : '—'} |
| Active calibration median | ${result.soundprint ? percent(result.soundprint.activeMedianSimilarity) : '—'} |
| Active 10th percentile | ${result.soundprint ? percent(result.soundprint.activeP10Similarity) : '—'} |
| Non-active 95th percentile | ${result.soundprint ? percent(result.soundprint.nonActiveP95Similarity) : '—'} |
| Active frames blocked at threshold | ${result.soundprint ? percent(result.soundprint.activeBlockRatio) : '—'} |
| Non-active frames passed at threshold | ${result.soundprint ? percent(result.soundprint.nonActivePassRatio) : '—'} |

This is an **enrollment-fit consistency check**, not a held-out identity classifier and not anti-spoofing. It is computed from the calibration takes; a live active frame below the threshold becomes UNCERTAIN and free. Similar machines and recorded playback can still pass. The held-out activity metrics above do not include this gate.

## Fixture replay

The fixture is procedurally synthesised audio labelled **${REFERENCE_LABEL}**. Replay uses the same frozen feature extractor, model artifact and hysteresis code as the browser.

| Item | Value |
| --- | ---: |
| Fixture duration | ${(result.fixture.durationMs / 1000).toFixed(2)}s |
| Expected active time | ${(result.fixture.expectedActiveMs / 1000).toFixed(1)}s |
| Metered billable time | ${(result.fixture.billableMs / 1000).toFixed(2)}s |
| Difference from script | ${(result.fixture.deltaMs / 1000).toFixed(2)}s |
| Intervals | ${result.fixture.intervals} |
| Simulated bill at $0.20/min, $5.00 cap | $${(result.fixture.simulatedMinor / 100).toFixed(2)} |
| Formula | \`${result.fixture.formula}\` |

State breakdown from the actual replay:

| State | Duration |
| --- | ---: |
${rows}

## What this evaluation does not prove

- It does not establish accuracy on a physical fan, hair dryer or any real appliance. The audio is synthetic.
- It does not exercise PayPal. Provider evidence comes only from a real Sandbox run with your own buyer and seller accounts.
- It does not test adversarial playback, a second identical machine, or an unattended venue. Those limits are documented in \`docs/threat-model.md\` and \`docs/safety.md\`.
- It does not prove browser microphone behaviour. The live path must be exercised on the target device.

## Reproduce

\`\`\`bash
npm run fixtures
npm run train:reference
npm run eval:reference
\`\`\`

Then open \`/judge\` and \`/demo/offline\` in the app. Both label the fixture as synthetic and replay.
`;
  writeFileSync(REFERENCE_EVALUATION_DOC_PATH, content);
}

export function writeEvaluation(): Evaluation {
  const result = evaluateReference();
  mkdirSync(path.dirname(REFERENCE_EVALUATION_JSON_PATH), { recursive: true });
  writeFileSync(REFERENCE_EVALUATION_JSON_PATH, `${JSON.stringify(result, null, 2)}\n`);
  writeDocument(result);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = writeEvaluation();
    console.log('Reference evaluation complete (synthetic fixture).');
    console.log(`  status: ${result.status}`);
    console.log(`  held-out precision: ${percent(result.precision)}`);
    console.log(`  held-out recall: ${percent(result.recall)}`);
    console.log(`  false billable: ${percent(result.falseBillableRatio, 3)}`);
    console.log(
      `  acoustic passport: ${result.soundprint?.status ?? 'NOT ENROLLED'}${result.soundprint?.gateEnabled ? ` @ ${percent(result.soundprint.matchThreshold)}` : ''}`,
    );
    console.log(`  fixture billable: ${(result.fixture.billableMs / 1000).toFixed(2)}s of ${(result.fixture.durationMs / 1000).toFixed(1)}s`);
    console.log(`  simulated bill: $${(result.fixture.simulatedMinor / 100).toFixed(2)}`);
    console.log(`  report: ${path.relative(ROOT, REFERENCE_EVALUATION_DOC_PATH)}`);
  } catch (error) {
    console.error(`Evaluation failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
