import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../apps/api/src/config.ts';
import { Store } from '../apps/api/src/db/index.ts';
import type { UserRow } from '../apps/api/src/domain/rows.ts';
import { hashCanonical } from '../apps/api/src/lib/hash.ts';
import type { ModelArtifact } from '../packages/audio/src/classifier.ts';
import type { PriceTerms } from '../packages/contracts/src/types.ts';
import {
  REFERENCE_CREATED_AT,
  REFERENCE_MODEL_ID,
  REFERENCE_MODEL_PATH,
  REFERENCE_OBJECT_ID,
  REFERENCE_TERMS,
  REFERENCE_TERMS_ID,
} from './reference-config.ts';

export interface SeedResult {
  objectId: string;
  modelId: string;
  termsId: string;
  modelHash: string;
  termsHash: string;
  databasePath: string;
}

export function seedReference(): SeedResult {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  try {
    let operator = store.get<UserRow>(
      "SELECT * FROM users WHERE role = 'operator' ORDER BY created_at LIMIT 1",
    );
    if (!operator) {
      store.run(
        'INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)',
        'usr_operator',
        'operator',
        'Whirr operator',
        REFERENCE_CREATED_AT,
      );
      operator = store.get<UserRow>('SELECT * FROM users WHERE id = ?', 'usr_operator');
    }
    if (!operator) throw new Error('Could not create the operator account');

    let artifact: ModelArtifact;
    try {
      artifact = JSON.parse(readFileSync(REFERENCE_MODEL_PATH, 'utf8')) as ModelArtifact;
    } catch (error) {
      throw new Error(
        `Reference model is missing or unreadable at ${REFERENCE_MODEL_PATH}. Run npm run train:reference first. (${(error as Error).message})`,
      );
    }
    if (artifact.schema !== 'whirr.model.v1') throw new Error('Reference model has an unsupported schema.');
    if (artifact.status !== 'READY') {
      throw new Error(
        `Reference model is ${artifact.status}, not READY. Refusing to seed a demo that cannot bill. Reasons: ${artifact.statusReasons.join(' | ')}`,
      );
    }

    const modelHash = hashCanonical(artifact);
    const terms: PriceTerms = { ...REFERENCE_TERMS, modelStatus: artifact.status };
    const termsHash = hashCanonical(terms);

    store.transaction(() => {
      store.run(
        `INSERT INTO objects
          (id, owner_id, name, category, glyph, description, photo_data_url, status, created_at, revoked_at, active_model_id, active_terms_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'ACTIVE', ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_id = excluded.owner_id,
           name = excluded.name,
           category = excluded.category,
           glyph = excluded.glyph,
           description = excluded.description,
           status = 'ACTIVE',
           revoked_at = NULL,
           active_model_id = excluded.active_model_id,
           active_terms_id = excluded.active_terms_id`,
        REFERENCE_OBJECT_ID,
        operator.id,
        'Reference desk fan',
        'fan',
        'fan',
        'A synthetic reference object used to exercise the complete Whirr metering and settlement loop. Its classifier is trained on generated audio, not on a physical fan.',
        REFERENCE_CREATED_AT,
        REFERENCE_MODEL_ID,
        REFERENCE_TERMS_ID,
      );

      store.run(
        `INSERT INTO model_versions
          (id, object_id, version, artifact_json, model_hash, status, dataset_hash, metrics_json, provenance, created_at, superseded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           artifact_json = excluded.artifact_json,
           model_hash = excluded.model_hash,
           status = excluded.status,
           dataset_hash = excluded.dataset_hash,
           metrics_json = excluded.metrics_json,
           provenance = excluded.provenance,
           created_at = excluded.created_at,
           superseded_at = NULL`,
        REFERENCE_MODEL_ID,
        REFERENCE_OBJECT_ID,
        artifact.version,
        JSON.stringify(artifact),
        modelHash,
        artifact.status,
        artifact.training.datasetHash,
        JSON.stringify(artifact.metrics),
        artifact.provenance,
        REFERENCE_CREATED_AT,
      );
      store.run(
        'UPDATE model_versions SET superseded_at = ? WHERE object_id = ? AND id <> ? AND superseded_at IS NULL',
        REFERENCE_CREATED_AT,
        REFERENCE_OBJECT_ID,
        REFERENCE_MODEL_ID,
      );

      store.run(
        `INSERT INTO price_terms
          (id, object_id, version, terms_json, terms_hash, currency, minor_per_minute, cap_minor,
           rounding, uncertain_policy, billing_policy, model_status, created_at, superseded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           terms_json = excluded.terms_json,
           terms_hash = excluded.terms_hash,
           currency = excluded.currency,
           minor_per_minute = excluded.minor_per_minute,
           cap_minor = excluded.cap_minor,
           rounding = excluded.rounding,
           uncertain_policy = excluded.uncertain_policy,
           billing_policy = excluded.billing_policy,
           model_status = excluded.model_status,
           created_at = excluded.created_at,
           superseded_at = NULL`,
        REFERENCE_TERMS_ID,
        REFERENCE_OBJECT_ID,
        terms.version,
        JSON.stringify(terms),
        termsHash,
        terms.currency,
        terms.minorPerMinute,
        terms.capMinor,
        terms.rounding,
        terms.uncertainPolicy,
        terms.billingPolicy,
        terms.modelStatus,
        REFERENCE_CREATED_AT,
      );
      store.run(
        'UPDATE price_terms SET superseded_at = ? WHERE object_id = ? AND id <> ? AND superseded_at IS NULL',
        REFERENCE_CREATED_AT,
        REFERENCE_OBJECT_ID,
        REFERENCE_TERMS_ID,
      );

      store.run(
        'UPDATE objects SET active_model_id = ?, active_terms_id = ? WHERE id = ?',
        REFERENCE_MODEL_ID,
        REFERENCE_TERMS_ID,
        REFERENCE_OBJECT_ID,
      );
    });

    return {
      objectId: REFERENCE_OBJECT_ID,
      modelId: REFERENCE_MODEL_ID,
      termsId: REFERENCE_TERMS_ID,
      modelHash,
      termsHash,
      databasePath: config.dbPath,
    };
  } finally {
    store.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = seedReference();
    console.log('Reference service seeded.');
    console.log(`  object: ${result.objectId}`);
    console.log(`  model: ${result.modelId} (${result.modelHash.slice(0, 16)}…)`);
    console.log(`  terms: ${result.termsId} (${result.termsHash.slice(0, 16)}…)`);
    console.log(`  share: http://localhost:5173/s/${result.objectId}`);
    console.log(`  database: ${path.relative(process.cwd(), result.databasePath)}`);
  } catch (error) {
    console.error(`Seed failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
