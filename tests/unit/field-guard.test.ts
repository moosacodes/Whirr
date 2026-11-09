import { describe, expect, it } from 'vitest';
import { Store } from '../../apps/api/src/db/index.ts';
import type { AppContext } from '../../apps/api/src/context.ts';
import type { ModelRow } from '../../apps/api/src/domain/rows.ts';
import {
  assertFieldValidationPassed,
  fieldValidationSummary,
} from '../../apps/api/src/domain/field-test.ts';

function fixtureStore(provenance: 'USER_CALIBRATION' | 'SYNTHETIC_REFERENCE'): {
  store: Store;
  ctx: AppContext;
  model: ModelRow;
} {
  const store = new Store(':memory:');
  const now = new Date('2026-11-09T12:00:00.000Z').toISOString();
  store.run('INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)', 'op_test', 'operator', 'Test operator', now);
  store.run(
    `INSERT INTO objects (id, owner_id, name, category, glyph, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    'obj_test',
    'op_test',
    'Test fan',
    'fan',
    'fan',
    '',
    now,
  );
  store.run(
    `INSERT INTO model_versions
      (id, object_id, version, artifact_json, model_hash, status, dataset_hash, metrics_json, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, 'READY', ?, '{}', ?, ?)`,
    'mdl_test',
    'obj_test',
    'v1',
    '{}',
    'a'.repeat(64),
    'b'.repeat(64),
    provenance,
    now,
  );
  store.run('UPDATE objects SET active_model_id = ? WHERE id = ?', 'mdl_test', 'obj_test');
  const model = store.get<ModelRow>('SELECT * FROM model_versions WHERE id = ?', 'mdl_test')!;
  return {
    store,
    ctx: {
      store,
      config: { primaryPublicOrigin: 'http://localhost:5173' },
    } as unknown as AppContext,
    model,
  };
}

describe('field-test publication guard', () => {
  it('blocks a USER_CALIBRATION model with no passing report', () => {
    const { store, ctx, model } = fixtureStore('USER_CALIBRATION');
    expect(() => assertFieldValidationPassed(ctx, model)).toThrow(/Real-World Calibration Lab/);
    expect(fieldValidationSummary(ctx, model).status).toBe('NOT_RUN');
    store.close();
  });

  it('does not treat a failing report as publishable', () => {
    const { store, ctx, model } = fixtureStore('USER_CALIBRATION');
    store.run(
      `INSERT INTO field_test_reports (id, object_id, model_id, status, report_json, evidence_hash, created_at)
       VALUES (?, ?, ?, 'FIELD_FAIL', '{}', ?, ?)`,
      'ftr_fail',
      'obj_test',
      model.id,
      'c'.repeat(64),
      new Date().toISOString(),
    );
    expect(() => assertFieldValidationPassed(ctx, model)).toThrow(/Real-World Calibration Lab/);
    expect(fieldValidationSummary(ctx, model).status).toBe('FIELD_FAIL');
    store.close();
  });

  it('allows publication only after a FIELD_PASS report for the same model', () => {
    const { store, ctx, model } = fixtureStore('USER_CALIBRATION');
    store.run(
      `INSERT INTO field_test_reports (id, object_id, model_id, status, report_json, evidence_hash, created_at)
       VALUES (?, ?, ?, 'FIELD_PASS', '{}', ?, ?)`,
      'ftr_pass',
      'obj_test',
      model.id,
      'd'.repeat(64),
      new Date().toISOString(),
    );
    expect(() => assertFieldValidationPassed(ctx, model)).not.toThrow();
    expect(fieldValidationSummary(ctx, model).status).toBe('FIELD_PASS');
    expect(fieldValidationSummary(ctx, model).reportId).toBe('ftr_pass');
    store.close();
  });

  it('leaves the synthetic reference demo unaffected', () => {
    const { store, ctx, model } = fixtureStore('SYNTHETIC_REFERENCE');
    expect(() => assertFieldValidationPassed(ctx, model)).not.toThrow();
    expect(fieldValidationSummary(ctx, model).status).toBe('NOT_REQUIRED');
    store.close();
  });
});
