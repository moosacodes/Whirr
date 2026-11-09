import path from 'node:path';

export const ROOT = process.cwd();

export const REFERENCE_OBJECT_ID = 'obj_reference_fan';
export const REFERENCE_MODEL_ID = 'mdl_reference_fan';
export const REFERENCE_TERMS_ID = 'trm_reference_fan';
export const REFERENCE_MODEL_VERSION = 'ref-fan-v1';
export const REFERENCE_CREATED_AT = '2026-11-01T09:00:00.000Z';

export const REFERENCE_MODEL_PATH = path.join(ROOT, 'models', 'whirr-reference-fan.json');
export const REFERENCE_MODEL_PUBLIC_PATH = path.join(
  ROOT,
  'apps',
  'web',
  'public',
  'models',
  'whirr-reference-fan.json',
);
export const REFERENCE_FIXTURE_PATH = path.join(ROOT, 'fixtures', 'fan-cycle.wav');
export const REFERENCE_FIXTURE_GENERATED_PATH = path.join(ROOT, 'fixtures', 'generated', 'fan-cycle.wav');
export const REFERENCE_FIXTURE_PUBLIC_PATH = path.join(ROOT, 'apps', 'web', 'public', 'fixtures', 'fan-cycle.wav');
export const REFERENCE_DATASET_SUMMARY_PATH = path.join(
  ROOT,
  'fixtures',
  'generated',
  'reference-dataset.json',
);
export const REFERENCE_EVALUATION_JSON_PATH = path.join(ROOT, 'models', 'reference-evaluation.json');
export const REFERENCE_EVALUATION_DOC_PATH = path.join(ROOT, 'docs', 'evaluation.md');

export const REFERENCE_TERMS = {
  version: 1,
  objectId: REFERENCE_OBJECT_ID,
  currency: 'USD' as const,
  minorPerMinute: 20,
  capMinor: 500,
  rounding: 'ROUND_ONCE_AT_END' as const,
  uncertainPolicy: 'EXCLUDE' as const,
  billingPolicy: 'AUTO' as const,
  feesPolicy: 'NO_ADDITIONAL_FEES' as const,
  modelStatus: 'READY' as const,
  createdAt: REFERENCE_CREATED_AT,
};

export const REFERENCE_LABEL = '5s idle · 15s running · 10s idle · 20s running · 5s idle';
