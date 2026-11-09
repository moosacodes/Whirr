import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trainModelFromTakes } from '../packages/audio/src/training.ts';
import { hashCanonical } from '../apps/api/src/lib/hash.ts';
import { generateReferenceData } from './generate-fixtures.ts';
import {
  REFERENCE_CREATED_AT,
  REFERENCE_MODEL_PATH,
  REFERENCE_MODEL_PUBLIC_PATH,
  REFERENCE_MODEL_VERSION,
} from './reference-config.ts';

export interface TrainedReference {
  artifact: ReturnType<typeof trainModelFromTakes>['artifact'];
  modelHash: string;
  datasetHash: string;
  rejected: boolean;
}

export function trainReferenceModel(): TrainedReference {
  const data = generateReferenceData();
  const { artifact, rejected } = trainModelFromTakes(data.takes, {
    version: REFERENCE_MODEL_VERSION,
    createdAt: REFERENCE_CREATED_AT,
    datasetHash: data.datasetHash,
    provenance: 'SYNTHETIC_REFERENCE',
    seed: 0x5eed_2026,
    iterations: 520,
    foldIterations: 170,
    learningRate: 0.16,
    l2: 1e-4,
    notes:
      'Deterministic synthetic reference model. Trained by scripts/train-reference.ts from procedurally generated fixture takes; not calibrated on a physical object.',
  });
  const modelHash = hashCanonical(artifact);
  for (const target of [REFERENCE_MODEL_PATH, REFERENCE_MODEL_PUBLIC_PATH]) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  return { artifact, modelHash, datasetHash: data.datasetHash, rejected };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = trainReferenceModel();
  const metrics = result.artifact.metrics;
  console.log('Reference model trained and written.');
  console.log(`  version: ${result.artifact.version}`);
  console.log(`  status: ${result.artifact.status}`);
  console.log(`  precision: ${(metrics.precision * 100).toFixed(2)}%`);
  console.log(`  recall: ${(metrics.recall * 100).toFixed(2)}%`);
  console.log(`  false billable: ${(metrics.falseBillableRatio * 100).toFixed(3)}%`);
  console.log(`  takes: ${result.artifact.training.takeCount} · frames: ${result.artifact.training.frameCount}`);
  console.log(`  model hash: ${result.modelHash}`);
  console.log('  provenance: SYNTHETIC_REFERENCE — pipeline demonstration only');
}
