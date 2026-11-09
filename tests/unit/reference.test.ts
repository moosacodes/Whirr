import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ModelArtifact } from '../../packages/audio/src/classifier.ts';
import { trainModelFromTakes, type TakeLabel } from '../../packages/audio/src/training.ts';
import {
  REFERENCE_FIXTURE_LABEL,
  REFERENCE_FIXTURE_URL,
} from '../../apps/api/src/domain/reference.ts';

const MODEL_PATH = 'models/whirr-reference-fan.json';

describe('reference model and gate', () => {
  it('ships a READY synthetic reference that honestly clears the precision gate', () => {
    expect(existsSync(MODEL_PATH)).toBe(true);
    const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as ModelArtifact;
    expect(model.schema).toBe('whirr.model.v1');
    expect(model.provenance).toBe('SYNTHETIC_REFERENCE');
    expect(model.status).toBe('READY');
    expect(model.metrics.precision).toBeGreaterThanOrEqual(0.95);
    expect(model.metrics.falseBillableRatio).toBeLessThanOrEqual(0.02);
    expect(model.limitations.join(' ')).toMatch(/synthetic|physical appliance/i);
    expect(model.featureNames).toHaveLength(21);
    expect(model.soundprint?.schema).toBe('whirr.soundprint.v1');
    expect(model.soundprint?.bands).toHaveLength(8);
    expect(model.soundprint?.gateEnabled).toBe(true);
    expect(model.soundprint?.notes.join(' ')).toMatch(/calibration|playback/i);
  });

  it('points judge replay at the bundled public fixture and labels its true length', () => {
    expect(REFERENCE_FIXTURE_URL).toBe('/fixtures/fan-cycle.wav');
    expect(existsSync('apps/web/public/fixtures/fan-cycle.wav')).toBe(true);
    expect(REFERENCE_FIXTURE_LABEL).toContain('55-second');
    expect(REFERENCE_FIXTURE_LABEL).not.toContain('45-second');
  });

  it('rejects a dataset with no active examples instead of guessing', () => {
    const frames = Array.from({ length: 120 }, () => new Array(21).fill(0));
    const result = trainModelFromTakes(
      [
        { id: 'idle-a', label: 'idle' as TakeLabel, frames, durationMs: 4000 },
        { id: 'idle-b', label: 'idle' as TakeLabel, frames, durationMs: 4000 },
      ],
      {
        version: 'test-reject',
        createdAt: '2026-01-01T00:00:00.000Z',
        datasetHash: 'test',
        provenance: 'USER_CALIBRATION',
        iterations: 5,
        foldIterations: 2,
      },
    );
    expect(result.rejected).toBe(true);
    expect(result.artifact.status).toBe('REJECTED');
    expect(result.artifact.statusReasons.length).toBeGreaterThan(0);
  });
});
