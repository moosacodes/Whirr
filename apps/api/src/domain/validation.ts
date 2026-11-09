import type { AppContext } from '../context.ts';
import type { TakeRow } from './rows.ts';
import type { ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import { predictFrame } from '../../../../packages/audio/src/classifier.ts';
import { segmentPredictions } from '../../../../packages/audio/src/hysteresis.ts';
import { FRAME_MS } from '../../../../packages/audio/src/spec.ts';
import type { ValidationReport } from '../../../../packages/contracts/src/types.ts';

export interface ValidationTake extends TakeRow {
  role: 'TRAINING' | 'VALIDATION';
}

export function reportForModel(ctx: AppContext, modelId: string): ValidationReport | null {
  const row = ctx.store.get<{ report_json: string }>(
    'SELECT report_json FROM validation_reports WHERE model_id = ? ORDER BY created_at DESC LIMIT 1',
    modelId,
  );
  return row ? (JSON.parse(row.report_json) as ValidationReport) : null;
}

/**
 * Evaluate the frozen model against takes that were deliberately excluded from
 * fitting. This is not a test of a physical object; it is evidence that the
 * model generalises to another sitting of the same object.
 */
export function evaluateValidationTakes(
  artifact: ModelArtifact,
  takes: TakeRow[],
  createdAt: string,
): ValidationReport {
  if (takes.length === 0) {
    return {
      schema: 'whirr.validation.v1',
      status: 'NOT_RUN',
      method: 'VALIDATION_TAKES',
      takeCount: 0,
      activeTakeCount: 0,
      negativeTakeCount: 0,
      billableMs: 0,
      precision: 0,
      recall: 0,
      falseBillableRatio: 0,
      perTake: [],
      notes: ['No takes were reserved for validation. The optional held-out check was not run.'],
      createdAt,
    };
  }

  let billed = 0;
  let trueBilled = 0;
  let falseBilled = 0;
  let activeDuration = 0;
  let nonActiveDuration = 0;
  let activeTakeCount = 0;
  let negativeTakeCount = 0;
  const perTake: ValidationReport['perTake'] = [];

  for (const take of takes) {
    const frames = JSON.parse(take.frames_json) as number[][];
    const frameFlags = JSON.parse(take.frame_flags_json) as string[][];
    const predictions = frames.map((features, index) =>
      predictFrame(
        artifact,
        features,
        (frameFlags[index] ?? []) as never,
        index * FRAME_MS,
        (index + 1) * FRAME_MS,
      ),
    );
    const intervals = segmentPredictions(predictions, artifact.policy);
    const takeBillable = intervals.reduce(
      (total, interval) =>
        interval.state === 'ACTIVE_CONFIDENT' ? total + Math.max(0, interval.endMs - interval.startMs) : total,
      0,
    );
    const expectedActive = take.label === 'active';
    if (expectedActive) {
      activeTakeCount += 1;
      activeDuration += take.duration_ms;
      trueBilled += takeBillable;
    } else {
      negativeTakeCount += 1;
      nonActiveDuration += take.duration_ms;
      falseBilled += takeBillable;
    }
    billed += takeBillable;
    perTake.push({
      takeId: take.id,
      label: take.label,
      durationMs: take.duration_ms,
      billableMs: Math.round(takeBillable),
      expectedActive,
    });
  }

  const precision = billed > 0 ? trueBilled / billed : 0;
  const recall = activeDuration > 0 ? trueBilled / activeDuration : 0;
  const falseBillableRatio = nonActiveDuration > 0 ? falseBilled / nonActiveDuration : 0;
  const status: ValidationReport['status'] =
    precision >= 0.95 && falseBillableRatio <= 0.02
      ? 'HELD_OUT_PASS'
      : precision >= 0.85 && falseBillableRatio <= 0.08
        ? 'HELD_OUT_REVIEW'
        : 'HELD_OUT_FAIL';
  const notes = [
    'These takes were excluded from fitting the model. This checks generalisation across sittings, not field accuracy on another object.',
    'A validation pass is still acoustic evidence only: playback, a similar machine or a changed room remains outside what one microphone can prove.',
  ];
  if (falseBillableRatio > 0.02) {
    notes.push('The held-out false-billable ratio is above the 2% automatic-billing ceiling.');
  }
  if (precision < 0.95) notes.push('Held-out precision is below the 95% automatic-billing ceiling.');

  return {
    schema: 'whirr.validation.v1',
    status,
    method: 'VALIDATION_TAKES',
    takeCount: takes.length,
    activeTakeCount,
    negativeTakeCount,
    billableMs: Math.round(billed),
    precision,
    recall,
    falseBillableRatio,
    perTake,
    notes,
    createdAt,
  };
}
