import type { AppContext } from '../context.ts';
import type { ModelRow, ObjectRow, TakeRow, TermsRow, UserRow } from './rows.ts';
import { parseArtifact, parseTerms } from './rows.ts';
import { newId } from '../lib/ids.ts';
import { hashCanonical, sha256Hex } from '../lib/hash.ts';
import { errors } from '../lib/errors.ts';
import { appendAudit } from '../lib/audit.ts';
import { summariseQuality, type FeatureFrame } from '../../../../packages/audio/src/features.ts';
import {
  trainModelFromTakes,
  type TrainingTake,
} from '../../../../packages/audio/src/training.ts';
import { FRAME_SPEC_VERSION_CHECK, takeContentHash } from './training-utils.ts';
import { evaluateValidationTakes, reportForModel } from './validation.ts';
import { driftForObject } from './drift.ts';
import { calibrationPreviewFor } from './calibration-preview.ts';
import {
  FEATURE_SPEC_VERSION,
  QUALITY_FLAGS,
  type QualityFlag,
} from '../../../../packages/audio/src/spec.ts';
import type {
  CalibrationTakeView,
  OwnerObjectView,
  PriceTerms,
  ServiceObjectView,
  TakeRole,
  TakeLabel,
} from '../../../../packages/contracts/src/types.ts';
import type { ModelArtifact, ModelStatus } from '../../../../packages/audio/src/classifier.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import type { z } from 'zod';
import type { takeUploadSchema, termsPublishSchema, objectCreateSchema } from '../../../../packages/contracts/src/schemas.ts';

type ObjectCreate = z.infer<typeof objectCreateSchema>;
type TakeUpload = z.infer<typeof takeUploadSchema>;
type TermsPublish = z.infer<typeof termsPublishSchema>;

export function getObject(store: AppContext['store'], id: string): ObjectRow | undefined {
  return store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', id);
}

export function requireObject(ctx: AppContext, id: string, ownerId?: string): ObjectRow {
  const object = getObject(ctx.store, id);
  if (!object) throw errors.notFound('Object not found');
  if (ownerId && object.owner_id !== ownerId) throw errors.notFound('Object not found');
  return object;
}

export function getModel(ctx: AppContext, id: string): ModelRow | undefined {
  return ctx.store.get<ModelRow>('SELECT * FROM model_versions WHERE id = ?', id);
}

export function getTerms(ctx: AppContext, id: string): TermsRow | undefined {
  return ctx.store.get<TermsRow>('SELECT * FROM price_terms WHERE id = ?', id);
}

export function activeModel(ctx: AppContext, object: ObjectRow): ModelRow | null {
  return object.active_model_id ? getModel(ctx, object.active_model_id) ?? null : null;
}

export function activeTerms(ctx: AppContext, object: ObjectRow): TermsRow | null {
  return object.active_terms_id ? getTerms(ctx, object.active_terms_id) ?? null : null;
}

export function serviceObjectView(object: ObjectRow, owner: UserRow | null): ServiceObjectView {
  return {
    id: object.id,
    name: object.name,
    category: object.category,
    glyph: object.glyph,
    description: object.description,
    photoDataUrl: object.photo_data_url,
    ownerLabel: owner?.display_name ?? 'Whirr operator',
    status: object.status,
    createdAt: object.created_at,
  };
}

export function modelSummary(row: ModelRow) {
  const artifact = parseArtifact(row);
  return {
    id: row.id,
    version: row.version,
    hash: row.model_hash,
    status: row.status,
    datasetHash: row.dataset_hash,
    createdAt: row.created_at,
    metrics: {
      status: row.status,
      precision: artifact.metrics.precision,
      recall: artifact.metrics.recall,
      falseBillableRatio: artifact.metrics.falseBillableRatio,
      threshold: artifact.policy.activeThreshold,
      takeCount: artifact.training.takeCount,
      frameCount: artifact.training.frameCount,
      trainedAt: artifact.createdAt,
      provenance: artifact.provenance,
      method: artifact.metrics.method,
    },
    limitations: artifact.limitations,
    takeaways: artifact.statusReasons,
    soundprint: artifact.soundprint ?? null,
  };
}

export function termsWithHash(row: TermsRow): PriceTerms & { id: string; hash: string } {
  return { ...parseTerms(row), id: row.id, hash: row.terms_hash };
}

function takeView(row: TakeRow, role: TakeRole = 'TRAINING'): CalibrationTakeView {
  return {
    id: row.id,
    label: row.label,
    frameCount: row.frame_count,
    durationMs: row.duration_ms,
    source: row.source,
    deviceLabel: row.device_label,
    notes: row.notes,
    createdAt: row.created_at,
    role,
    quality: JSON.parse(row.quality_json) as CalibrationTakeView['quality'],
  };
}

export function datasetHashForTakes(takes: TakeRow[]): string {
  return hashCanonical({
    schema: 'whirr.dataset.v1',
    takes: takes
      .map((take) => ({ id: take.id, hash: take.dataset_hash, label: take.label }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function ownerObjectView(ctx: AppContext, object: ObjectRow): OwnerObjectView {
  const model = activeModel(ctx, object);
  const terms = activeTerms(ctx, object);
  const takes = ctx.store.all<TakeRow>(
    'SELECT * FROM calibration_takes WHERE object_id = ? ORDER BY created_at ASC',
    object.id,
  );
  const takeCounts: Record<TakeLabel, number> = { idle: 0, active: 0, negative: 0, transition: 0 };
  const roles = new Map<string, TakeRole>(
    ctx.store
      .all<{ take_id: string; role: TakeRole }>('SELECT take_id, role FROM take_roles')
      .map((row) => [row.take_id, row.role]),
  );
  let validationTakeCount = 0;
  for (const take of takes) {
    if (roles.get(take.id) === 'VALIDATION') validationTakeCount += 1;
    else takeCounts[take.label] += 1;
  }
  const sessionStats = ctx.store.get<{ count: number; last: string | null; active: number }>(
    `SELECT COUNT(*) AS count, MAX(created_at) AS last,
       SUM(CASE WHEN state IN ('READY','ACTIVE','PAUSED') THEN 1 ELSE 0 END) AS active
     FROM sessions WHERE object_id = ?`,
    object.id,
  );
  const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  return {
    object: serviceObjectView(object, owner ?? null),
    activeModel: model ? modelSummary(model) : null,
    terms: terms ? termsWithHash(terms) : null,
    takes: takes.map((take) => takeView(take, roles.get(take.id) ?? 'TRAINING')),
    takeCounts,
    validationTakeCount,
    sessionCount: sessionStats?.count ?? 0,
    lastSessionAt: sessionStats?.last ?? null,
    calibrationAgeDays: model
      ? Math.max(0, Math.floor((ctx.now().getTime() - Date.parse(model.created_at)) / 86_400_000))
      : null,
    shareUrl: `${ctx.config.primaryPublicOrigin}/s/${object.id}`,
    activeSessions: sessionStats?.active ?? 0,
    validationReport: model ? reportForModel(ctx, model.id) : null,
    calibrationPreview: calibrationPreviewFor(ctx, object.id),
    drift: driftForObject(ctx, object.id, model?.created_at ?? null),
    shelfListed: (ctx.store.get<{ listed: number }>('SELECT listed FROM shelf_listings WHERE object_id = ?', object.id)?.listed ?? 1) === 1,
  };
}

export function listOwnerObjects(ctx: AppContext, ownerId: string): OwnerObjectView[] {
  const objects = ctx.store.all<ObjectRow>(
    'SELECT * FROM objects WHERE owner_id = ? ORDER BY created_at DESC',
    ownerId,
  );
  return objects.map((object) => ownerObjectView(ctx, object));
}

export function createObject(ctx: AppContext, operator: UserRow, input: ObjectCreate): OwnerObjectView {
  const id = newId('obj');
  const now = ctx.now().toISOString();
  ctx.store.run(
    `INSERT INTO objects (id, owner_id, name, category, glyph, description, photo_data_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    id,
    operator.id,
    input.name,
    input.category,
    input.glyph,
    input.description ?? '',
    input.photoDataUrl ?? null,
    now,
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'object.created',
    subjectType: 'object',
    subjectId: id,
    metadata: { name: input.name, category: input.category },
  }, ctx.now());
  return ownerObjectView(ctx, requireObject(ctx, id, operator.id));
}

export function revokeObject(ctx: AppContext, operator: UserRow, objectId: string, revoked: boolean): OwnerObjectView {
  const object = requireObject(ctx, objectId, operator.id);
  const now = ctx.now().toISOString();
  ctx.store.run(
    'UPDATE objects SET status = ?, revoked_at = ? WHERE id = ?',
    revoked ? 'REVOKED' : 'ACTIVE',
    revoked ? now : null,
    objectId,
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: revoked ? 'object.revoked' : 'object.reactivated',
    subjectType: 'object',
    subjectId: object.id,
  }, ctx.now());
  return ownerObjectView(ctx, requireObject(ctx, objectId, operator.id));
}

export function addTake(ctx: AppContext, operator: UserRow, objectId: string, input: TakeUpload): CalibrationTakeView {
  const object = requireObject(ctx, objectId, operator.id);
  if (input.featureSpecVersion !== FEATURE_SPEC_VERSION) {
    throw errors.conflict('FEATURE_SPEC_MISMATCH', 'This recording was produced by an incompatible feature pipeline');
  }
  const existingCount = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM calibration_takes WHERE object_id = ?',
    objectId,
  );
  if ((existingCount?.count ?? 0) >= 24) {
    throw errors.conflict('TOO_MANY_TAKES', 'This object already has 24 calibration takes. Delete unused takes first.');
  }
  const frames = input.frames;
  const flags = input.frameFlags ?? frames.map(() => []);
  const featureFrames: FeatureFrame[] = frames.map((features, index) => ({
    endMs: (index + 1) * 32,
    features,
    flags: (flags[index] ?? []).filter((f): f is QualityFlag =>
      (QUALITY_FLAGS as readonly string[]).includes(f),
    ),
  }));
  const quality = summariseQuality(featureFrames);
  if (frames.length < 30) {
    throw errors.badRequest('Recording is too short. Record at least three seconds of audio.');
  }
  if (quality.silentRatio > 0.5) {
    throw errors.badRequest('Recording is mostly silent. Check the microphone level and try again.');
  }
  const now = ctx.now().toISOString();
  const id = newId('tak');
  const contentHash = takeContentHash({
    label: input.label,
    frames,
    frameFlags: flags,
    durationMs: input.durationMs,
    featureSpecVersion: input.featureSpecVersion,
  });
  ctx.store.run(
    `INSERT INTO calibration_takes
      (id, object_id, label, frames_json, frame_flags_json, frame_count, duration_ms, feature_spec_version,
       source, device_label, notes, dataset_hash, quality_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    object.id,
    input.label,
    JSON.stringify(frames),
    JSON.stringify(flags),
    frames.length,
    input.durationMs,
    input.featureSpecVersion,
    input.source,
    input.deviceLabel ?? null,
    input.notes ?? null,
    contentHash,
    JSON.stringify(quality),
    now,
  );
  ctx.store.run(
    `INSERT INTO take_roles (take_id, role, created_at) VALUES (?, ?, ?)
     ON CONFLICT(take_id) DO UPDATE SET role = excluded.role`,
    id,
    input.role as TakeRole,
    now,
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'calibration.take_added',
    subjectType: 'object',
    subjectId: object.id,
    metadata: { takeId: id, label: input.label, frames: frames.length, durationMs: input.durationMs },
  }, ctx.now());
  const row = ctx.store.get<TakeRow>('SELECT * FROM calibration_takes WHERE id = ?', id)!;
  return takeView(row, input.role as TakeRole);
}

export function deleteTake(ctx: AppContext, operator: UserRow, objectId: string, takeId: string): void {
  const object = requireObject(ctx, objectId, operator.id);
  const result = ctx.store.run(
    'DELETE FROM calibration_takes WHERE id = ? AND object_id = ?',
    takeId,
    object.id,
  );
  if (result.changes === 0) throw errors.notFound('Calibration take not found');
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'calibration.take_deleted',
    subjectType: 'object',
    subjectId: object.id,
    metadata: { takeId },
  }, ctx.now());
}

export function purgeCalibration(ctx: AppContext, operator: UserRow, objectId: string): void {
  const object = requireObject(ctx, objectId, operator.id);
  ctx.store.run('DELETE FROM calibration_takes WHERE object_id = ?', object.id);
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'calibration.purged',
    subjectType: 'object',
    subjectId: object.id,
  }, ctx.now());
}

export function setTakeRole(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  takeId: string,
  role: TakeRole,
): CalibrationTakeView {
  const object = requireObject(ctx, objectId, operator.id);
  const take = ctx.store.get<TakeRow>('SELECT * FROM calibration_takes WHERE id = ? AND object_id = ?', takeId, object.id);
  if (!take) throw errors.notFound('Calibration take not found');
  ctx.store.run(
    `INSERT INTO take_roles (take_id, role, created_at) VALUES (?, ?, ?)
     ON CONFLICT(take_id) DO UPDATE SET role = excluded.role`,
    take.id,
    role,
    ctx.now().toISOString(),
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'calibration.take_role_changed',
    subjectType: 'object',
    subjectId: object.id,
    metadata: { takeId, role },
  }, ctx.now());
  return takeView(take, role);
}

export function setShelfListed(ctx: AppContext, operator: UserRow, objectId: string, listed: boolean): OwnerObjectView {
  const object = requireObject(ctx, objectId, operator.id);
  ctx.store.run(
    `INSERT INTO shelf_listings (object_id, listed, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(object_id) DO UPDATE SET listed = excluded.listed, updated_at = excluded.updated_at`,
    object.id,
    listed ? 1 : 0,
    ctx.now().toISOString(),
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: listed ? 'shelf.listed' : 'shelf.unlisted',
    subjectType: 'object',
    subjectId: object.id,
  }, ctx.now());
  return ownerObjectView(ctx, object);
}

export function nextModelVersion(ctx: AppContext, objectId: string): string {
  const row = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM model_versions WHERE object_id = ?',
    objectId,
  );
  return `v${(row?.count ?? 0) + 1}`;
}

export function trainObject(ctx: AppContext, operator: UserRow, objectId: string): {
  model: ReturnType<typeof modelSummary>;
  activated: boolean;
} {
  const object = requireObject(ctx, objectId, operator.id);
  const takes = ctx.store.all<TakeRow>(
    'SELECT * FROM calibration_takes WHERE object_id = ? ORDER BY created_at ASC',
    objectId,
  );
  const roles = new Map<string, TakeRole>(
    ctx.store
      .all<{ take_id: string; role: TakeRole }>('SELECT take_id, role FROM take_roles')
      .map((row) => [row.take_id, row.role]),
  );
  const validationTakes = takes.filter((take) => roles.get(take.id) === 'VALIDATION');
  const trainingRows = takes.filter((take) => roles.get(take.id) !== 'VALIDATION');
  if (trainingRows.length === 0) {
    throw errors.badRequest('Record idle and active examples before training.');
  }
  const trainingTakes: TrainingTake[] = trainingRows.map((row) => ({
    id: row.id,
    label: row.label,
    frames: JSON.parse(row.frames_json) as number[][],
    frameFlags: JSON.parse(row.frame_flags_json) as string[][],
    durationMs: row.duration_ms,
  }));
  const datasetHash = datasetHashForTakes(trainingRows);
  const version = nextModelVersion(ctx, objectId);
  const createdAt = ctx.now().toISOString();
  let result: ReturnType<typeof trainModelFromTakes>;
  try {
    result = trainModelFromTakes(trainingTakes, {
      version,
      createdAt,
      datasetHash,
      provenance: 'USER_CALIBRATION',
      notes: `Trained locally from ${trainingRows.length} takes recorded in the operator's browser; ${validationTakes.length} take(s) reserved for held-out validation.`,
    });
  } catch (error) {
    throw errors.badRequest(`Training failed: ${(error as Error).message}`);
  }
  const artifact = result.artifact;
  const artifactJson = JSON.stringify(artifact);
  const modelHash = hashCanonical(artifact);
  const modelId = newId('mdl');
  let activated = false;
  const validationReport = validationTakes.length > 0
    ? evaluateValidationTakes(artifact, validationTakes, createdAt)
    : null;
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO model_versions
        (id, object_id, version, artifact_json, model_hash, status, dataset_hash, metrics_json, provenance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      modelId,
      objectId,
      version,
      artifactJson,
      modelHash,
      artifact.status,
      datasetHash,
      JSON.stringify(artifact.metrics),
      artifact.provenance,
      createdAt,
    );
    if (!result.rejected) {
      ctx.store.run('UPDATE model_versions SET superseded_at = ? WHERE object_id = ? AND id <> ?', createdAt, objectId, modelId);
      ctx.store.run('UPDATE objects SET active_model_id = ? WHERE id = ?', modelId, objectId);
      activated = true;
    }
    if (validationReport) {
      ctx.store.run(
        `INSERT INTO validation_reports (id, object_id, model_id, report_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        newId('val'),
        objectId,
        modelId,
        JSON.stringify(validationReport),
        createdAt,
      );
    }
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'model.trained',
    subjectType: 'object',
    subjectId: objectId,
    metadata: {
      modelId,
      version,
      status: artifact.status,
      precision: artifact.metrics.precision,
      falseBillableRatio: artifact.metrics.falseBillableRatio,
      activated,
      validationStatus: validationReport?.status ?? 'NOT_RUN',
    },
  }, ctx.now());
  const row = getModel(ctx, modelId);
  if (!row) throw errors.internal('Model row missing after training');
  return { model: modelSummary(row), activated };
}

export function publishTerms(ctx: AppContext, operator: UserRow, objectId: string, input: TermsPublish): {
  terms: PriceTerms & { id: string; hash: string };
} {
  const object = requireObject(ctx, objectId, operator.id);
  if (object.status === 'REVOKED') {
    throw errors.conflict('OBJECT_REVOKED', 'Reactivate this object before publishing new terms.');
  }
  const model = activeModel(ctx, object);
  if (!model) throw errors.conflict('MODEL_NOT_READY', 'Train and activate a model before publishing price terms.');
  if (model.status === 'REJECTED') {
    throw errors.conflict('MODEL_REJECTED', 'The active model did not pass the billing safety gate.');
  }
  const latest = ctx.store.get<{ version: number }>(
    'SELECT MAX(version) AS version FROM price_terms WHERE object_id = ?',
    objectId,
  );
  const version = (latest?.version ?? 0) + 1;
  const createdAt = ctx.now().toISOString();
  const terms: PriceTerms = {
    version,
    objectId,
    currency: input.currency as PriceTerms['currency'],
    minorPerMinute: input.minorPerMinute,
    capMinor: input.capMinor,
    rounding: 'ROUND_ONCE_AT_END',
    uncertainPolicy: 'EXCLUDE',
    billingPolicy: model.status === 'LIMITED' ? 'OPERATOR_REVIEW' : 'AUTO',
    feesPolicy: 'NO_ADDITIONAL_FEES',
    modelStatus: model.status,
    createdAt,
    fairnessReserveMinor: input.fairnessReserveMinor,
  };
  const termsHash = hashCanonical(terms);
  const termsId = newId('trm');
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO price_terms
        (id, object_id, version, terms_json, terms_hash, currency, minor_per_minute, cap_minor,
         rounding, uncertain_policy, billing_policy, model_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      termsId,
      objectId,
      version,
      JSON.stringify(terms),
      termsHash,
      terms.currency,
      terms.minorPerMinute,
      terms.capMinor,
      terms.rounding,
      terms.uncertainPolicy,
      terms.billingPolicy,
      terms.modelStatus,
      createdAt,
    );
    ctx.store.run('UPDATE price_terms SET superseded_at = ? WHERE object_id = ? AND id <> ?', createdAt, objectId, termsId);
    ctx.store.run('UPDATE objects SET active_terms_id = ? WHERE id = ?', termsId, objectId);
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'terms.published',
    subjectType: 'object',
    subjectId: objectId,
    metadata: {
      termsId,
      version,
      currency: terms.currency,
      minorPerMinute: terms.minorPerMinute,
      capMinor: terms.capMinor,
      billingPolicy: terms.billingPolicy,
      hash: termsHash,
    },
  }, ctx.now());
  const row = getTerms(ctx, termsId);
  if (!row) throw errors.internal('Terms row missing after publishing');
  return { terms: termsWithHash(row) };
}

export function exampleQuotes(terms: PriceTerms): {
  fifteenSecondsMinor: number;
  thirtyFiveSecondsMinor: number;
  fiveMinutesMinor: number;
} {
  const quote = (ms: number) =>
    quoteBreakdown(terms.minorPerMinute, ms, terms.capMinor, 0, terms.currency).finalMinor;
  return {
    fifteenSecondsMinor: quote(15_000),
    thirtyFiveSecondsMinor: quote(35_000),
    fiveMinutesMinor: quote(300_000),
  };
}

export function modelArtifactFor(ctx: AppContext, modelId: string): ModelArtifact | null {
  const row = getModel(ctx, modelId);
  return row ? parseArtifact(row) : null;
}

export function calibrationStatus(ctx: AppContext, objectId: string): {
  takes: number;
  modelStatus: ModelStatus | null;
  datasetHash: string | null;
} {
  const takes = ctx.store.all<TakeRow>('SELECT * FROM calibration_takes WHERE object_id = ?', objectId);
  const model = ctx.store.get<ModelRow>('SELECT * FROM model_versions WHERE object_id = ? ORDER BY created_at DESC LIMIT 1', objectId);
  return {
    takes: takes.length,
    modelStatus: model?.status ?? null,
    datasetHash: takes.length ? datasetHashForTakes(takes) : null,
  };
}

export const TRAINING_UTILS = { FRAME_SPEC_VERSION_CHECK, sha256Hex };
