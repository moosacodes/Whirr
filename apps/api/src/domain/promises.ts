import type { Actor, AppContext } from '../context.ts';
import type {
  EventDemonstrationRow,
  EventModelRow,
  ObjectRow,
  PromiseAgreementRow,
  PromiseExecutionRow,
  PromiseObservationRow,
  PromisePaymentOperationRow,
  PromiseProofRow,
  UserRow,
} from './rows.ts';
import { newId, providerRequestId } from '../lib/ids.ts';
import { appendAudit } from '../lib/audit.ts';
import { errors, AppError } from '../lib/errors.ts';
import { hashCanonical, shortRef } from '../lib/hash.ts';
import { formatMinor, decimalStringToMinor, type Currency } from '../../../../packages/meter/src/currency.ts';
import {
  compilePhysicalAgreement,
  evaluatePromise,
  hashAgreementTerms,
  validateTermsShape,
  type CompiledAgreement,
  type PromiseAgreementTerms,
  type PromiseEvaluation,
  type PromiseObservation,
} from '../../../../packages/promise/src/index.ts';
import { trainEventModel, type EventModelArtifact } from '../../../../packages/audio/src/event-model.ts';
import { FEATURE_SPEC_VERSION } from '../../../../packages/audio/src/spec.ts';
import {
  PayPalApiError,
  extractAuthorization,
  type PayPalAuthorization,
  type PayPalCapture,
} from '../../../../packages/paypal/src/client.ts';
import type {
  AgreementView,
  EventDemonstrationView,
  EventModelDetailView,
  EventModelSummaryView,
  PromiseCatalogView,
  PromiseExecutionListItem,
  PromiseExecutionView,
  PromiseJudgeView,
  PromiseLabView,
  PromiseObjectView,
  PromiseProofView,
} from '../../../../packages/contracts/src/types.ts';
import type { PhysicalProofPayload, PhysicalProofPayment } from '../../../../packages/protocol/src/physical-proof.ts';
import { verifyPhysicalProofDocument } from '../../../../packages/verify/src/physical.ts';

function requirePromiseObject(ctx: AppContext, objectId: string, ownerId?: string): ObjectRow {
  const row = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', objectId);
  if (!row) throw errors.notFound('Object not found.');
  if (ownerId && row.owner_id !== ownerId) throw errors.notFound('Object not found.');
  if (row.status !== 'ACTIVE') throw errors.conflict('OBJECT_REVOKED', 'This object is no longer active.');
  return row;
}

function objectView(ctx: AppContext, object: ObjectRow): PromiseObjectView {
  const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  return {
    id: object.id,
    name: object.name,
    glyph: object.glyph,
    description: object.description,
    ownerLabel: owner?.display_name ?? 'Whirr operator',
  };
}

function eventModelSummary(row: EventModelRow): EventModelSummaryView {
  const artifact = JSON.parse(row.artifact_json) as EventModelArtifact;
  return {
    id: row.id,
    version: row.version,
    hash: row.model_hash,
    status: row.status,
    provenance: row.provenance,
    createdAt: row.created_at,
    datasetHash: row.dataset_hash,
    takeCount: artifact.training.takeCount,
    frameCount: artifact.training.frameCount,
    groupCount: artifact.training.groupCount,
    metrics: {
      frameAccuracy: artifact.metrics.frameAccuracy,
      macroRecall: artifact.metrics.macroRecall,
      unknownRate: artifact.metrics.unknownRate,
      perClass: artifact.metrics.perClass,
      confusion: artifact.metrics.confusion,
      confusionLabels: artifact.metrics.confusionLabels,
    },
    statusReasons: artifact.statusReasons,
    limitations: artifact.limitations,
  };
}

function demoView(row: EventDemonstrationRow): EventDemonstrationView {
  return {
    id: row.id,
    objectId: row.object_id,
    label: row.label,
    frameCount: row.frame_count,
    durationMs: row.duration_ms,
    source: row.source,
    provenance: row.provenance,
    sessionGroup: row.session_group,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
  };
}

function latestEventModelRow(ctx: AppContext, objectId: string): EventModelRow | null {
  return (
    ctx.store.get<EventModelRow>(
      'SELECT * FROM event_models WHERE object_id = ? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1',
      objectId,
    ) ?? null
  );
}

function agreementRow(ctx: AppContext, id: string): PromiseAgreementRow {
  const row = ctx.store.get<PromiseAgreementRow>('SELECT * FROM promise_agreements WHERE id = ?', id);
  if (!row) throw errors.notFound('Physical promise not found.');
  return row;
}

function agreementObject(ctx: AppContext, row: PromiseAgreementRow): ObjectRow {
  return requirePromiseObject(ctx, row.object_id);
}

export function agreementView(ctx: AppContext, row: PromiseAgreementRow): AgreementView {
  const terms = JSON.parse(row.terms_json) as PromiseAgreementTerms;
  if (!validateTermsShape(terms)) throw errors.internal('Stored agreement terms are malformed.');
  const object = agreementObject(ctx, row);
  const model = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', row.event_model_id);
  if (!model) throw errors.internal('Agreement event model is missing.');
  return {
    id: row.id,
    object: objectView(ctx, object),
    serviceName: row.service_name,
    proposalText: row.proposal_text,
    terms,
    termsHash: row.terms_hash,
    summary: agreementSummarySafe(terms),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    eventModel: eventModelSummary(model),
    publicUrl: `/promise/${row.id}`,
  };
}

function agreementSummarySafe(terms: PromiseAgreementTerms): AgreementView['summary'] {
  return [
    { id: 'sequence', label: 'Required sequence', value: terms.requiredSequence.join(' → ') },
    {
      id: 'duration',
      label: 'Qualified run',
      value: `${(terms.constraints.minRunMs / 1000).toFixed(1)}s to ${(terms.constraints.maxRunMs / 1000).toFixed(1)}s`,
    },
    { id: 'price', label: 'Fixed price', value: formatMinor(terms.financial.fixedPriceMinor, terms.financial.currency) },
    { id: 'uncertain', label: 'Uncertain evidence', value: 'No capture' },
    { id: 'sensor', label: 'Sensor loss', value: 'No capture' },
    { id: 'stop', label: 'Completion', value: 'Temporal return to idle, not a separate sound class' },
    { id: 'model', label: 'Event model', value: `${terms.eventModel.version} (${terms.eventModel.hash.slice(0, 12)}…)` },
  ];
}

export function promiseCatalog(ctx: AppContext): PromiseCatalogView {
  const rows = ctx.store.all<PromiseAgreementRow>(
    `SELECT a.* FROM promise_agreements a
     JOIN objects o ON o.id = a.object_id
     WHERE a.status = 'OWNER_APPROVED' AND o.status = 'ACTIVE'
     ORDER BY a.created_at DESC`,
  );
  const items = rows.map((row) => {
    const counts = ctx.store.get<{ total: number; qualified: number; captured: number; last_at: string | null }>(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN outcome = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN captured_minor IS NOT NULL THEN 1 ELSE 0 END) AS captured,
         MAX(created_at) AS last_at
       FROM promise_executions WHERE agreement_id = ?`,
      row.id,
    );
    const latest = ctx.store.get<{ demo: number }>(
      'SELECT demo FROM promise_executions WHERE agreement_id = ? ORDER BY created_at DESC LIMIT 1',
      row.id,
    );
    return {
      agreement: agreementView(ctx, row),
      executionCount: counts?.total ?? 0,
      qualifiedCount: counts?.qualified ?? 0,
      capturedCount: counts?.captured ?? 0,
      lastExecutionAt: counts?.last_at ?? null,
      latestDemo: latest ? Boolean(latest.demo) : null,
    };
  });
  return {
    generatedAt: ctx.now().toISOString(),
    items,
    sandbox: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
    limitations: [
      'Whirr observes acoustic states. It does not prove that a machine produced a correct physical result, nor that a microphone or its operator was honest.',
      'Synthetic reference models and demonstrations are labelled. They are not field recordings of a physical appliance.',
      'PayPal Sandbox only. No real money can move.',
    ],
  };
}

export function publicAgreement(ctx: AppContext, id: string): AgreementView {
  const row = agreementRow(ctx, id);
  if (row.status !== 'OWNER_APPROVED') throw errors.notFound('This physical promise is not published.');
  return agreementView(ctx, row);
}

export function publicAgreementModel(ctx: AppContext, id: string): EventModelDetailView {
  const agreement = agreementRow(ctx, id);
  if (agreement.status !== 'OWNER_APPROVED') throw errors.notFound('This physical promise is not published.');
  const row = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', agreement.event_model_id);
  if (!row) throw errors.notFound('Event model not found.');
  const summary = eventModelSummary(row);
  return { ...summary, artifact: JSON.parse(row.artifact_json) as EventModelArtifact };
}

export function operatorEventModelDetail(
  ctx: AppContext,
  operatorId: string,
  modelId: string,
): EventModelDetailView {
  const row = ctx.store.get<EventModelRow>(
    `SELECT m.* FROM event_models m
     JOIN objects o ON o.id = m.object_id
     WHERE m.id = ? AND o.owner_id = ?`,
    modelId,
    operatorId,
  );
  if (!row) throw errors.notFound('Event model not found.');
  return { ...eventModelSummary(row), artifact: JSON.parse(row.artifact_json) as EventModelArtifact };
}

export function promiseLab(ctx: AppContext, operatorId: string, objectId?: string): PromiseLabView {
  const objects = ctx.store.all<ObjectRow>(
    "SELECT * FROM objects WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC",
    operatorId,
  );
  const selectedObject = objectId ? requirePromiseObject(ctx, objectId, operatorId) : objects[0] ?? null;
  let selected: PromiseLabView['selected'] = null;
  if (selectedObject) {
    const demos = ctx.store.all<EventDemonstrationRow>(
      'SELECT * FROM event_demonstrations WHERE object_id = ? ORDER BY captured_at DESC',
      selectedObject.id,
    );
    const model = latestEventModelRow(ctx, selectedObject.id);
    const agreements = ctx.store.all<PromiseAgreementRow>(
      'SELECT * FROM promise_agreements WHERE object_id = ? ORDER BY created_at DESC',
      selectedObject.id,
    );
    selected = {
      object: objectView(ctx, selectedObject),
      demonstrations: demos.map(demoView),
      eventModel: model ? eventModelSummary(model) : null,
      agreements: agreements.map((row) => agreementView(ctx, row)),
    };
  }
  return {
    objects: objects.map((object) => objectView(ctx, object)),
    selected,
    sandbox: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
    demoMode: ctx.config.demoMode,
    detectionPreset: {
      idleLabel: 'IDLE',
      runLabel: 'RUNNING',
      backgroundLabel: 'BACKGROUND',
      interruptedLabel: 'INTERRUPTED',
      temporalCompletion: 'IDLE → START → RUNNING → EXPECTED_STOP',
    },
  };
}

export function saveEventDemonstration(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  input: {
    label: 'idle' | 'active' | 'negative' | 'transition';
    frames: number[][];
    frameFlags?: string[][];
    durationMs: number;
    featureSpecVersion: string;
    source: 'live' | 'import';
    deviceLabel?: string | null;
    notes?: string | null;
    sessionGroup: string;
  },
): EventDemonstrationView {
  const object = requirePromiseObject(ctx, objectId, operator.id);
  if (input.frames.length === 0) throw errors.badRequest('A demonstration needs at least one feature frame.');
  if (input.frameFlags && input.frameFlags.length !== input.frames.length) {
    throw errors.badRequest('Frame flags must match the feature frame count.');
  }
  if (input.featureSpecVersion !== FEATURE_SPEC_VERSION) {
    throw errors.badRequest('This demonstration uses an unsupported feature specification.');
  }
  const now = ctx.now().toISOString();
  const datasetHash = hashCanonical({
    schema: 'whirr.event-demonstration.v1',
    objectId,
    label: input.label,
    frameCount: input.frames.length,
    durationMs: input.durationMs,
    sessionGroup: input.sessionGroup,
    featureSpecVersion: input.featureSpecVersion,
  });
  const id = newId('evd');
  ctx.store.run(
    `INSERT INTO event_demonstrations
      (id, object_id, label, frames_json, frame_flags_json, frame_count, duration_ms, feature_spec_version,
       source, provenance, session_group, device_label, notes, dataset_hash, captured_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER_CALIBRATION', ?, ?, ?, ?, ?, ?)`,
    id,
    object.id,
    input.label,
    JSON.stringify(input.frames),
    JSON.stringify(input.frameFlags ?? input.frames.map(() => [])),
    input.frames.length,
    input.durationMs,
    input.featureSpecVersion,
    input.source,
    input.sessionGroup,
    input.deviceLabel ?? null,
    input.notes ?? null,
    datasetHash,
    now,
    now,
  );
  ctx.store.run(
    'UPDATE event_models SET superseded_at = ? WHERE object_id = ? AND superseded_at IS NULL',
    now,
    object.id,
  );
  appendAudit(
    ctx.store,
    {
      actorType: 'operator',
      actorId: operator.id,
      action: 'promise.demonstration_recorded',
      subjectType: 'event_demonstration',
      subjectId: id,
      metadata: { objectId, label: input.label, frameCount: input.frames.length, source: input.source },
    },
    ctx.now(),
  );
  return demoView(ctx.store.get<EventDemonstrationRow>('SELECT * FROM event_demonstrations WHERE id = ?', id)!);
}

export function trainPromiseEventModel(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  version?: string,
): EventModelDetailView {
  const object = requirePromiseObject(ctx, objectId, operator.id);
  const rows = ctx.store.all<EventDemonstrationRow>(
    'SELECT * FROM event_demonstrations WHERE object_id = ? ORDER BY captured_at',
    object.id,
  );
  if (rows.length === 0) throw errors.conflict('NO_DEMONSTRATIONS', 'Record or import demonstrations before training.');
  const takes = rows.map((row) => ({
    id: row.id,
    objectId: row.object_id,
    label: row.label,
    frames: JSON.parse(row.frames_json) as number[][],
    frameFlags: JSON.parse(row.frame_flags_json) as string[][],
    durationMs: row.duration_ms,
    featureSpecVersion: row.feature_spec_version,
    source: row.source,
    provenance: row.provenance,
    sessionGroup: row.session_group,
    deviceLabel: row.device_label ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.captured_at,
  }));
  const createdAt = ctx.now().toISOString();
  const nextVersion = version?.trim() || `promise-${new Date(createdAt).toISOString().slice(0, 16).replace(/[^0-9]/g, '').slice(0, 12)}`;
  const provenance = rows.some((row) => row.provenance === 'SYNTHETIC_REFERENCE')
    ? 'SYNTHETIC_REFERENCE'
    : 'USER_CALIBRATION';
  const trained = trainEventModel({
    takes,
    version: nextVersion,
    createdAt,
    featureSpecVersion: FEATURE_SPEC_VERSION,
    provenance,
  });
  const id = newId('evm');
  const modelHash = hashCanonical(trained.artifact);
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO event_models
        (id, object_id, version, artifact_json, model_hash, status, dataset_hash, metrics_json, provenance, created_at, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      id,
      object.id,
      trained.artifact.version,
      JSON.stringify(trained.artifact),
      modelHash,
      trained.artifact.status,
      trained.artifact.training.datasetHash,
      JSON.stringify(trained.artifact.metrics),
      trained.artifact.training.provenance,
      createdAt,
    );
    ctx.store.run(
      'UPDATE event_models SET superseded_at = ? WHERE object_id = ? AND id <> ? AND superseded_at IS NULL',
      createdAt,
      object.id,
      id,
    );
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'operator',
      actorId: operator.id,
      action: 'promise.event_model_trained',
      subjectType: 'event_model',
      subjectId: id,
      metadata: {
        objectId,
        status: trained.artifact.status,
        macroRecall: trained.artifact.metrics.macroRecall,
        modelHash,
        provenance,
      },
    },
    ctx.now(),
  );
  const row = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', id)!;
  return { ...eventModelSummary(row), artifact: trained.artifact };
}

export function compilePromise(
  ctx: AppContext,
  operator: UserRow,
  input: { objectId: string; eventModelId: string; serviceName: string; text: string },
  now = ctx.now().toISOString(),
  expiresInMinutes?: number,
): CompiledAgreement {
  const object = requirePromiseObject(ctx, input.objectId, operator.id);
  const model = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ? AND object_id = ?', input.eventModelId, object.id);
  if (!model) throw errors.notFound('Event model not found for this object.');
  const latest = latestEventModelRow(ctx, object.id);
  if (!latest || latest.id !== model.id) {
    throw errors.conflict('MODEL_SUPERSEDED', 'This event model is no longer the active model. Retrain or choose the active model.');
  }
  return compilePhysicalAgreement({
    text: input.text,
    serviceName: input.serviceName,
    objectId: object.id,
    objectName: object.name,
    currency: 'USD',
    eventModel: {
      id: model.id,
      version: model.version,
      hash: model.model_hash,
      status: model.status === 'READY' ? 'READY' : 'LIMITED',
      datasetHash: model.dataset_hash,
      provenance: model.provenance,
    },
    now,
    ...(expiresInMinutes === undefined ? {} : { expiresInMinutes }),
  });
}

export function publishPromise(
  ctx: AppContext,
  operator: UserRow,
  input: {
    objectId: string;
    eventModelId: string;
    serviceName: string;
    text: string;
    termsHash: string;
    terms?: unknown;
  },
): AgreementView {
  let compiled: CompiledAgreement;
  if (input.terms !== undefined) {
    if (!validateTermsShape(input.terms)) {
      throw errors.badRequest('The reviewed agreement snapshot is malformed.');
    }
    compiled = compilePromise(
      ctx,
      operator,
      input,
      input.terms.createdAt,
      input.terms.financial.authorizationExpiryMinutes,
    );
    if (compiled.hash !== input.termsHash || hashAgreementTerms(input.terms) !== input.termsHash) {
      throw errors.conflict('TERMS_CHANGED', 'The reviewed terms do not match a fresh compilation. Review the exact terms and approve them again.');
    }
  } else {
    compiled = compilePromise(ctx, operator, input);
  }
  if (!compiled.executable) {
    throw errors.conflict(
      'AGREEMENT_NOT_EXECUTABLE',
      compiled.issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.message).join(' ') ||
        'The agreement could not be compiled.',
    );
  }
  if (compiled.hash !== input.termsHash) {
    throw errors.conflict('TERMS_CHANGED', 'The compiled agreement changed. Review the exact terms and approve them again.');
  }
  const existing = ctx.store.get<PromiseAgreementRow>(
    'SELECT * FROM promise_agreements WHERE object_id = ? AND terms_hash = ?',
    input.objectId,
    compiled.hash,
  );
  if (existing) return agreementView(ctx, existing);
  const id = newId('prm');
  ctx.store.run(
    `INSERT INTO promise_agreements
      (id, object_id, owner_id, event_model_id, event_model_hash, service_name, proposal_text, terms_json, terms_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWNER_APPROVED', ?, ?)`,
    id,
    input.objectId,
    operator.id,
    input.eventModelId,
    compiled.terms.eventModel.hash,
    compiled.terms.serviceName,
    input.text,
    JSON.stringify(compiled.terms),
    compiled.hash,
    compiled.terms.createdAt,
    compiled.terms.expiresAt,
  );
  appendAudit(
    ctx.store,
    {
      actorType: 'operator',
      actorId: operator.id,
      action: 'promise.agreement_published',
      subjectType: 'promise_agreement',
      subjectId: id,
      metadata: {
        objectId: input.objectId,
        modelHash: compiled.terms.eventModel.hash,
        termsHash: compiled.hash,
        fixedPriceMinor: compiled.terms.financial.fixedPriceMinor,
      },
    },
    ctx.now(),
  );
  return agreementView(ctx, agreementRow(ctx, id));
}

function requireExecution(ctx: AppContext, id: string): PromiseExecutionRow {
  const row = ctx.store.get<PromiseExecutionRow>('SELECT * FROM promise_executions WHERE id = ?', id);
  if (!row) throw errors.notFound('Promise execution not found.');
  return row;
}

function executionTerms(row: PromiseExecutionRow): PromiseAgreementTerms {
  const terms = JSON.parse(row.terms_snapshot_json) as PromiseAgreementTerms;
  if (!validateTermsShape(terms)) throw errors.internal('Execution terms are malformed.');
  return terms;
}

function executionAgreement(ctx: AppContext, row: PromiseExecutionRow): PromiseAgreementRow {
  const agreement = ctx.store.get<PromiseAgreementRow>('SELECT * FROM promise_agreements WHERE id = ?', row.agreement_id);
  if (!agreement) throw errors.internal('Execution agreement is missing.');
  return agreement;
}

function observationRows(ctx: AppContext, executionId: string): PromiseObservationRow[] {
  return ctx.store.all<PromiseObservationRow>(
    'SELECT * FROM promise_observations WHERE execution_id = ? ORDER BY seq',
    executionId,
  );
}

function observationFromRow(row: PromiseObservationRow): PromiseObservation {
  return {
    seq: row.seq,
    startMs: row.start_ms,
    endMs: row.end_ms,
    state: row.state,
    confidence: row.confidence,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
    ...(row.event_match === null ? {} : { eventMatch: row.event_match }),
  };
}

function requireExecutionForActor(ctx: AppContext, id: string, actor: Actor): PromiseExecutionRow {
  const row = requireExecution(ctx, id);
  if (actor.type === 'operator' && row.owner_id === actor.id) return row;
  if (actor.type === 'renter' && row.renter_id === actor.id) return row;
  throw errors.notFound('Promise execution not found.');
}

function paymentOperation(
  ctx: AppContext,
  executionId: string,
  type: PromisePaymentOperationRow['operation_type'],
): PromisePaymentOperationRow | undefined {
  return ctx.store.get<PromisePaymentOperationRow>(
    'SELECT * FROM promise_payment_operations WHERE execution_id = ? AND operation_type = ?',
    executionId,
    type,
  );
}

function ensurePaymentOperation(
  ctx: AppContext,
  executionId: string,
  type: PromisePaymentOperationRow['operation_type'],
  input: { requestId: string; amountMinor: number; currency: Currency; state: string },
): PromisePaymentOperationRow {
  const existing = paymentOperation(ctx, executionId, type);
  const now = ctx.now().toISOString();
  if (existing) {
    if (existing.request_id !== input.requestId) {
      throw errors.conflict(
        'PAYMENT_OPERATION_CONFLICT',
        `A ${type.toLowerCase().replaceAll('_', ' ')} already exists with a different provider request. Reconcile it instead of starting another operation.`,
      );
    }
    ctx.store.run(
      'UPDATE promise_payment_operations SET state = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?',
      input.state,
      now,
      existing.id,
    );
    return paymentOperation(ctx, executionId, type)!;
  }
  const id = newId('ppo');
  ctx.store.run(
    `INSERT INTO promise_payment_operations
      (id, execution_id, operation_type, request_id, state, amount_minor, currency, request_hash, provider_ref, response_json, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
    id,
    executionId,
    type,
    input.requestId,
    input.state,
    input.amountMinor,
    input.currency,
    providerRequestId([type, executionId, input.requestId]),
    now,
    now,
  );
  return paymentOperation(ctx, executionId, type)!;
}

function finishPaymentOperation(
  ctx: AppContext,
  operation: PromisePaymentOperationRow,
  input: { state: string; providerRef?: string | null; response?: unknown },
): void {
  ctx.store.run(
    'UPDATE promise_payment_operations SET state = ?, provider_ref = COALESCE(?, provider_ref), response_json = ?, updated_at = ? WHERE id = ?',
    input.state,
    input.providerRef ?? null,
    input.response === undefined ? null : JSON.stringify(input.response).slice(0, 200_000),
    ctx.now().toISOString(),
    operation.id,
  );
}

function setExecution(
  ctx: AppContext,
  id: string,
  input: Partial<{
    state: PromiseExecutionRow['state'];
    paymentState: string;
    orderId: string | null;
    approveUrl: string | null;
    authorizationId: string | null;
    captureId: string | null;
    voidId: string | null;
    providerStatus: string | null;
    authorizationExpiresAt: string | null;
    capturedMinor: number | null;
    failureReason: string | null;
    observationStartedAt: string | null;
    observationStoppedAt: string | null;
    completedAt: string | null;
    authorizedAt: string | null;
    outcome: PromiseExecutionRow['outcome'];
    observedMs: number;
    runMs: number;
    idleMs: number;
    uncertainMs: number;
    sensorLossMs: number;
    eligibleForCapture: boolean;
    evaluationJson: string | null;
    evaluationHash: string | null;
    evidenceRoot: string | null;
  }>,
): void {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (input.state !== undefined) set('state', input.state);
  if (input.paymentState !== undefined) set('payment_state', input.paymentState);
  if (input.orderId !== undefined) set('paypal_order_id', input.orderId);
  if (input.approveUrl !== undefined) set('paypal_approve_url', input.approveUrl);
  if (input.authorizationId !== undefined) set('paypal_authorization_id', input.authorizationId);
  if (input.captureId !== undefined) set('paypal_capture_id', input.captureId);
  if (input.voidId !== undefined) set('paypal_void_id', input.voidId);
  if (input.providerStatus !== undefined) set('provider_status', input.providerStatus);
  if (input.authorizationExpiresAt !== undefined) set('authorization_expires_at', input.authorizationExpiresAt);
  if (input.capturedMinor !== undefined) set('captured_minor', input.capturedMinor);
  if (input.failureReason !== undefined) set('failure_reason', input.failureReason);
  if (input.observationStartedAt !== undefined) set('observation_started_at', input.observationStartedAt);
  if (input.observationStoppedAt !== undefined) set('observation_stopped_at', input.observationStoppedAt);
  if (input.completedAt !== undefined) set('completed_at', input.completedAt);
  if (input.authorizedAt !== undefined) set('authorized_at', input.authorizedAt);
  if (input.outcome !== undefined) set('outcome', input.outcome);
  if (input.observedMs !== undefined) set('observed_ms', input.observedMs);
  if (input.runMs !== undefined) set('run_ms', input.runMs);
  if (input.idleMs !== undefined) set('idle_ms', input.idleMs);
  if (input.uncertainMs !== undefined) set('uncertain_ms', input.uncertainMs);
  if (input.sensorLossMs !== undefined) set('sensor_loss_ms', input.sensorLossMs);
  if (input.eligibleForCapture !== undefined) set('eligible_for_capture', input.eligibleForCapture ? 1 : 0);
  if (input.evaluationJson !== undefined) set('evaluation_json', input.evaluationJson);
  if (input.evaluationHash !== undefined) set('evaluation_hash', input.evaluationHash);
  if (input.evidenceRoot !== undefined) set('evidence_root', input.evidenceRoot);
  if (fields.length === 0) return;
  values.push(id);
  ctx.store.run(`UPDATE promise_executions SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

export function createPromiseExecution(
  ctx: AppContext,
  renter: UserRow,
  agreementId: string,
  input: { termsHash: string; accepted: true; demo: boolean; observationMode: 'LIVE' | 'REPLAY' },
): PromiseExecutionView {
  const agreement = agreementRow(ctx, agreementId);
  if (agreement.status !== 'OWNER_APPROVED') throw errors.conflict('AGREEMENT_PAUSED', 'This promise is not available.');
  if (agreement.terms_hash !== input.termsHash) {
    throw errors.conflict('TERMS_CHANGED', 'The agreement changed after you loaded it. Review the exact terms again.');
  }
  if (Date.parse(agreement.expires_at) <= ctx.now().getTime()) {
    throw errors.conflict('AGREEMENT_EXPIRED', 'This agreement has expired. Ask the owner to publish a new one.');
  }
  const object = requirePromiseObject(ctx, agreement.object_id);
  const terms = JSON.parse(agreement.terms_json) as PromiseAgreementTerms;
  const demo = input.demo || !ctx.config.paypal.configured;
  const now = ctx.now().toISOString();
  const id = newId('pex');
  ctx.store.run(
    `INSERT INTO promise_executions
      (id, agreement_id, agreement_hash, object_id, owner_id, renter_id, state, payment_state, demo, observation_mode,
       terms_snapshot_json, created_at, consented_at, authorization_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    agreement.id,
    agreement.terms_hash,
    object.id,
    object.owner_id,
    renter.id,
    demo ? 'AUTHORIZED' : 'PAYMENT_AUTHORIZATION_PENDING',
    demo ? 'DEMO_MODE' : 'NONE',
    demo ? 1 : 0,
    input.observationMode,
    agreement.terms_json,
    now,
    now,
    demo ? null : agreement.expires_at,
  );
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: 'promise.execution_created',
      subjectType: 'promise_execution',
      subjectId: id,
      metadata: {
        agreementId: agreement.id,
        termsHash: agreement.terms_hash,
        demo,
        observationMode: input.observationMode,
        priceMinor: terms.financial.fixedPriceMinor,
      },
    },
    ctx.now(),
  );
  return executionView(ctx, id, { type: 'renter', id: renter.id });
}

export function executionView(ctx: AppContext, id: string, actor?: Actor): PromiseExecutionView {
  const row = actor ? requireExecutionForActor(ctx, id, actor) : requireExecution(ctx, id);
  const agreement = executionAgreement(ctx, row);
  const object = requirePromiseObject(ctx, row.object_id);
  const terms = executionTerms(row);
  const modelRow = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', agreement.event_model_id);
  if (!modelRow) throw errors.internal('Execution model is missing.');
  const model = eventModelSummary(modelRow);
  const authorizationExpired =
    row.authorization_expires_at !== null && Date.parse(row.authorization_expires_at) <= ctx.now().getTime();
  const evaluation = row.evaluation_json ? (JSON.parse(row.evaluation_json) as PromiseEvaluation) : null;
  const proof = ctx.store.get<PromiseProofRow>('SELECT * FROM promise_proofs WHERE execution_id = ?', row.id);
  const canStart =
    row.state === 'AUTHORIZED' &&
    !authorizationExpired &&
    (Boolean(row.demo) || row.payment_state === 'AUTHORIZED');
  return {
    id: row.id,
    agreementId: row.agreement_id,
    agreementHash: row.agreement_hash,
    object: objectView(ctx, object),
    serviceName: agreement.service_name,
    state: row.state,
    paymentState: row.payment_state,
    demo: Boolean(row.demo),
    observationMode: row.observation_mode,
    terms,
    model,
    quote: {
      fixedPriceMinor: terms.financial.fixedPriceMinor,
      maximumChargeMinor: terms.financial.maximumChargeMinor,
      currency: terms.financial.currency,
      displayPrice: formatMinor(terms.financial.fixedPriceMinor, terms.financial.currency),
      displayMaximum: formatMinor(terms.financial.maximumChargeMinor, terms.financial.currency),
    },
    createdAt: row.created_at,
    consentedAt: row.consented_at,
    authorizedAt: row.authorized_at,
    observationStartedAt: row.observation_started_at,
    observationStoppedAt: row.observation_stopped_at,
    completedAt: row.completed_at,
    authorizationExpiresAt: row.authorization_expires_at,
    authorizationExpired,
    meterClockMs: row.last_observed_ms,
    observedMs: row.observed_ms,
    runMs: row.run_ms,
    idleMs: row.idle_ms,
    uncertainMs: row.uncertain_ms,
    sensorLossMs: row.sensor_loss_ms,
    outcome: row.outcome,
    eligibleForCapture: Boolean(row.eligible_for_capture),
    evaluation,
    events: evaluation?.events ?? [],
    checks: evaluation?.checks ?? [],
    paypal: {
      orderId: row.paypal_order_id,
      approveUrl: row.paypal_approve_url,
      authorizationId: row.paypal_authorization_id,
      captureId: row.paypal_capture_id,
      voidId: row.paypal_void_id,
      providerStatus: row.provider_status,
      capturedMinor: row.captured_minor,
    },
    proofId: proof?.id ?? null,
    proofHash: proof?.payload_hash ?? null,
    ownership: {
      owner: actor?.type === 'operator' && actor.id === row.owner_id,
      renter: actor?.type === 'renter' && actor.id === row.renter_id,
    },
    flags: {
      canConsent: false,
      canCreateOrder: !row.demo && row.payment_state === 'NONE' && row.state === 'PAYMENT_AUTHORIZATION_PENDING',
      canAuthorize: !row.demo && Boolean(row.paypal_order_id) && row.payment_state === 'ORDER_CREATED',
      canStart,
      canSubmitObservations: row.state === 'OBSERVING',
      canStop: row.state === 'OBSERVING',
      canCapture:
        !row.demo &&
        row.state === 'ELIGIBLE_FOR_CAPTURE' &&
        row.payment_state === 'AUTHORIZED' &&
        !authorizationExpired &&
        row.captured_minor === null,
      canVoid:
        !row.demo &&
        !row.paypal_capture_id &&
        Boolean(row.paypal_authorization_id) &&
        !['VOID_CONFIRMED', 'CAPTURE_CONFIRMED'].includes(row.state),
      canProof: Boolean(row.observation_stopped_at),
      awaitingBuyer: !row.demo && row.payment_state === 'ORDER_CREATED',
      awaitingProvider: row.payment_state === 'CAPTURE_REQUESTED' || row.state === 'RECONCILIATION_REQUIRED',
    },
    limitations: model.limitations,
    sandboxNotice: row.demo
      ? 'Demo observation. No PayPal order, authorization or capture is created and no money can move.'
      : 'PayPal Sandbox only. The buyer must approve the authorization in PayPal before observation. Capture is attempted only after a qualified contract result.',
  };
}

function requirePayPal(ctx: AppContext) {
  if (!ctx.paypal) throw errors.unavailable('PayPal Sandbox is not configured. Use a demo observation instead.');
  return ctx.paypal;
}

function providerFailure(error: unknown): AppError {
  if (error instanceof PayPalApiError) {
    return new AppError(502, error.issue ?? 'PAYPAL_ERROR', `PayPal Sandbox: ${error.message}`, {
      issue: error.issue,
      debugId: error.debugId,
      providerStatus: error.status,
    });
  }
  return errors.provider(`PayPal Sandbox request failed: ${(error as Error).message}`);
}

function amountMatches(amount: { currency_code: string; value: string } | undefined, expectedMinor: number, currency: Currency): boolean {
  if (!amount || amount.currency_code !== currency) return false;
  return decimalStringToMinor(String(amount.value), currency) === expectedMinor;
}

function clientOrigin(ctx: AppContext, origin: string): string {
  const normalised = origin.replace(/\/$/, '');
  if (!ctx.config.publicOrigins.includes(normalised)) throw errors.badRequest('Unrecognised application origin.');
  return normalised;
}

export async function createPromiseOrder(
  ctx: AppContext,
  renter: UserRow,
  executionId: string,
  origin: string,
): Promise<{ orderId: string; approveUrl: string | null }> {
  const paypal = requirePayPal(ctx);
  const row = requireExecutionForActor(ctx, executionId, { type: 'renter', id: renter.id });
  if (row.demo) throw errors.conflict('DEMO_EXECUTION', 'This is a demo observation and does not create a PayPal order.');
  if (row.payment_state === 'ORDER_CREATED' && row.paypal_order_id && row.paypal_approve_url) {
    return { orderId: row.paypal_order_id, approveUrl: row.paypal_approve_url };
  }
  if (row.payment_state === 'AUTHORIZED' || row.payment_state === 'CAPTURE_COMPLETED') {
    throw errors.conflict('PAYMENT_STATE', `Payment is already ${row.payment_state}.`);
  }
  if (row.state !== 'PAYMENT_AUTHORIZATION_PENDING') {
    throw errors.conflict('INVALID_STATE', `Cannot create an order from state ${row.state}.`);
  }
  const terms = executionTerms(row);
  const requestId = providerRequestId([
    'promise-order',
    row.id,
    row.agreement_hash,
    terms.financial.maximumChargeMinor,
    row.paypal_order_id ?? 'primary',
  ]);
  const operation = ensurePaymentOperation(ctx, row.id, 'CREATE_ORDER', {
    requestId,
    amountMinor: terms.financial.maximumChargeMinor,
    currency: terms.financial.currency,
    state: 'PENDING',
  });
  try {
    const publicOrigin = clientOrigin(ctx, origin);
    const object = requirePromiseObject(ctx, row.object_id);
    const { order, approveUrl } = await paypal.createOrder({
      capMinor: terms.financial.maximumChargeMinor,
      currency: terms.financial.currency,
      sessionId: row.id,
      description: `Whirr physical promise - ${object.name}`,
      returnUrl: `${publicOrigin}/promise/run/${row.id}?paypal=return`,
      cancelUrl: `${publicOrigin}/promise/run/${row.id}?paypal=cancel`,
      requestId,
    });
    if (!order.id || !approveUrl) throw errors.provider('PayPal Sandbox did not return an approval link.');
    setExecution(ctx, row.id, {
      orderId: order.id,
      approveUrl,
      paymentState: 'ORDER_CREATED',
      providerStatus: order.status ?? 'CREATED',
    });
    finishPaymentOperation(ctx, operation, { state: 'COMPLETED', providerRef: order.id, response: order });
    return { orderId: order.id, approveUrl };
  } catch (error) {
    finishPaymentOperation(ctx, operation, { state: 'FAILED' });
    throw providerFailure(error);
  }
}

export async function authorizePromiseExecution(
  ctx: AppContext,
  renter: UserRow,
  executionId: string,
): Promise<PromiseExecutionView> {
  const paypal = requirePayPal(ctx);
  const row = requireExecutionForActor(ctx, executionId, { type: 'renter', id: renter.id });
  if (row.payment_state === 'AUTHORIZED' && row.paypal_authorization_id) {
    return executionView(ctx, row.id, { type: 'renter', id: renter.id });
  }
  if (row.demo) throw errors.conflict('DEMO_EXECUTION', 'Demo observations do not create authorizations.');
  if (!row.paypal_order_id) throw errors.conflict('NO_ORDER', 'Create a PayPal order first.');
  if (row.payment_state !== 'ORDER_CREATED' && row.payment_state !== 'BUYER_APPROVED') {
    throw errors.conflict('PAYMENT_STATE', `Cannot authorize while payment is ${row.payment_state}.`);
  }
  const terms = executionTerms(row);
  const requestId = providerRequestId(['promise-authorize', row.id, row.paypal_order_id, row.agreement_hash]);
  const operation = ensurePaymentOperation(ctx, row.id, 'AUTHORIZE', {
    requestId,
    amountMinor: terms.financial.maximumChargeMinor,
    currency: terms.financial.currency,
    state: 'PENDING',
  });
  try {
    let order = await paypal.getOrder(row.paypal_order_id);
    if (order.status === 'CREATED' || order.status === 'PAYER_ACTION_REQUIRED') {
      setExecution(ctx, row.id, { providerStatus: order.status, paymentState: 'ORDER_CREATED' });
      finishPaymentOperation(ctx, operation, { state: 'WAITING_FOR_BUYER', response: order });
      throw errors.conflict('BUYER_NOT_APPROVED', 'The buyer has not approved the PayPal Sandbox order yet.');
    }
    if (order.status === 'APPROVED') {
      try {
        order = await paypal.authorizeOrder(row.paypal_order_id, requestId);
      } catch (error) {
        if (error instanceof PayPalApiError && (error.issue === 'ORDER_ALREADY_AUTHORIZED' || error.status === 422)) {
          order = await paypal.getOrder(row.paypal_order_id);
        } else {
          throw error;
        }
      }
    }
    if (order.status === 'VOIDED' || order.status === 'EXPIRED') {
      setExecution(ctx, row.id, { paymentState: 'UNRESOLVED', state: 'INELIGIBLE', providerStatus: order.status });
      finishPaymentOperation(ctx, operation, { state: 'FAILED', response: order });
      throw errors.conflict('ORDER_NOT_AUTHORIZABLE', `The PayPal order is ${order.status}.`);
    }
    let authorization = extractAuthorization(order);
    if (!authorization) {
      order = await paypal.getOrder(row.paypal_order_id);
      authorization = extractAuthorization(order);
    }
    if (!authorization) throw errors.provider('PayPal did not return an authorization for this approved order.');
    const authoritative: PayPalAuthorization = await paypal.getAuthorization(authorization.id);
    if (authoritative.status !== 'CREATED') {
      setExecution(ctx, row.id, {
        paymentState: 'UNRESOLVED',
        state: 'RECONCILIATION_REQUIRED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishPaymentOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict('AUTHORIZATION_NOT_CAPTURABLE', `PayPal authorization status is ${authoritative.status}.`);
    }
    if (!amountMatches(authoritative.amount, terms.financial.maximumChargeMinor, terms.financial.currency)) {
      setExecution(ctx, row.id, {
        paymentState: 'UNRESOLVED',
        state: 'RECONCILIATION_REQUIRED',
        authorizationId: authoritative.id,
        providerStatus: authoritative.status,
      });
      finishPaymentOperation(ctx, operation, { state: 'UNRESOLVED', providerRef: authoritative.id, response: authoritative });
      throw errors.conflict('AUTHORIZED_AMOUNT_MISMATCH', 'PayPal authorized a different amount or currency than the approved ceiling.');
    }
    setExecution(ctx, row.id, {
      paymentState: 'AUTHORIZED',
      state: 'AUTHORIZED',
      authorizationId: authoritative.id,
      authorizedAt: ctx.now().toISOString(),
      providerStatus: authoritative.status,
      authorizationExpiresAt: authoritative.expiration_time ?? row.authorization_expires_at,
      failureReason: null,
    });
    finishPaymentOperation(ctx, operation, { state: 'COMPLETED', providerRef: authoritative.id, response: authoritative });
    return executionView(ctx, row.id, { type: 'renter', id: renter.id });
  } catch (error) {
    if (error instanceof AppError) throw error;
    finishPaymentOperation(ctx, operation, { state: 'UNKNOWN' });
    setExecution(ctx, row.id, { providerStatus: 'AUTHORIZE_OUTCOME_UNKNOWN' });
    throw providerFailure(error);
  }
}

export function startPromiseObservation(
  ctx: AppContext,
  renter: UserRow,
  executionId: string,
): PromiseExecutionView {
  let row = requireExecutionForActor(ctx, executionId, { type: 'renter', id: renter.id });
  if (row.state === 'OBSERVING') return executionView(ctx, row.id, { type: 'renter', id: renter.id });
  if (row.state !== 'AUTHORIZED') throw errors.conflict('INVALID_STATE', 'The agreement is not authorized for observation.');
  if (!row.demo && row.payment_state !== 'AUTHORIZED') {
    throw errors.conflict('NOT_AUTHORIZED', 'PayPal has not authorized the approved ceiling.');
  }
  if (row.authorization_expires_at && Date.parse(row.authorization_expires_at) <= ctx.now().getTime()) {
    setExecution(ctx, row.id, { state: 'EXPIRED', failureReason: 'Authorization expired before observation started.' });
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The authorization expired before observation started. No charge was made.');
  }
  if (row.last_observed_ms > 0) throw errors.conflict('OBSERVATION_ALREADY_STARTED', 'This execution has already recorded observations.');
  setExecution(ctx, row.id, {
    state: 'OBSERVING',
    observationStartedAt: ctx.now().toISOString(),
    failureReason: null,
  });
  row = requireExecution(ctx, row.id);
  return executionView(ctx, row.id, { type: 'renter', id: renter.id });
}

export function appendPromiseObservations(
  ctx: AppContext,
  renter: UserRow,
  executionId: string,
  input: { clientSeq: number; intervals: PromiseObservation[] },
): PromiseExecutionView {
  const row = requireExecutionForActor(ctx, executionId, { type: 'renter', id: renter.id });
  if (row.state !== 'OBSERVING') throw errors.conflict('NOT_OBSERVING', 'The observation session is not open.');
  let lastSeq = row.last_client_seq;
  let lastMs = row.last_observed_ms;
  const now = ctx.now().toISOString();
  const terms = executionTerms(row);
  ctx.store.transaction(() => {
    for (const interval of input.intervals) {
      if (interval.seq <= lastSeq) throw errors.conflict('STALE_OBSERVATION', 'Observation sequence numbers must increase.');
      if (interval.startMs < lastMs) throw errors.conflict('OVERLAPPING_OBSERVATION', 'Observation intervals must not overlap or move backwards.');
      if (interval.endMs - interval.startMs > 120_000) throw errors.badRequest('A single interval is too long.');
      const gap = interval.startMs - lastMs;
      if (gap > terms.constraints.maxObservationGapMs) {
        throw errors.conflict('OBSERVATION_GAP', `An observation gap of ${gap}ms exceeds the approved ${terms.constraints.maxObservationGapMs}ms limit.`);
      }
      if (interval.endMs > 15 * 60_000) throw errors.badRequest('The observation session exceeds the 15 minute limit.');
      ctx.store.run(
        `INSERT INTO promise_observations
          (id, execution_id, seq, start_ms, end_ms, state, confidence, event_match, quality_flags_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('pob'),
        row.id,
        interval.seq,
        interval.startMs,
        interval.endMs,
        interval.state,
        interval.confidence,
        interval.eventMatch ?? null,
        JSON.stringify(interval.qualityFlags ?? []),
        now,
      );
      lastSeq = interval.seq;
      lastMs = interval.endMs;
    }
    ctx.store.run(
      'UPDATE promise_executions SET last_client_seq = ?, last_observed_ms = ? WHERE id = ?',
      lastSeq,
      lastMs,
      row.id,
    );
  });
  return executionView(ctx, row.id, { type: 'renter', id: renter.id });
}

export async function stopPromiseObservation(
  ctx: AppContext,
  renter: UserRow,
  executionId: string,
): Promise<PromiseExecutionView> {
  const row = requireExecutionForActor(ctx, executionId, { type: 'renter', id: renter.id });
  if (['OBSERVATION_COMPLETE', 'ELIGIBLE_FOR_CAPTURE', 'INELIGIBLE', 'NEEDS_REVIEW', 'CAPTURE_CONFIRMED', 'VOID_CONFIRMED'].includes(row.state)) {
    return executionView(ctx, row.id, { type: 'renter', id: renter.id });
  }
  if (row.state !== 'OBSERVING') throw errors.conflict('NOT_OBSERVING', 'The observation session is not open.');
  const agreement = executionAgreement(ctx, row);
  const terms = executionTerms(row);
  const observations = observationRows(ctx, row.id).map(observationFromRow);
  const currentModel = latestEventModelRow(ctx, row.object_id);
  const evaluation = await evaluatePromise({
    terms,
    agreementHash: row.agreement_hash,
    observations,
    currentModelHash: currentModel?.model_hash,
    now: ctx.now().toISOString(),
  });
  const now = ctx.now().toISOString();
  const nextState =
    evaluation.outcome === 'QUALIFIED'
      ? 'ELIGIBLE_FOR_CAPTURE'
      : evaluation.outcome === 'UNCERTAIN' || evaluation.outcome === 'SENSOR_LOST'
        ? 'NEEDS_REVIEW'
        : 'INELIGIBLE';
  setExecution(ctx, row.id, {
    state: nextState,
    paymentState: row.demo ? 'DEMO_MODE' : row.payment_state,
    observationStoppedAt: now,
    completedAt: now,
    observedMs: evaluation.observedMs,
    runMs: evaluation.runMs,
    idleMs: evaluation.idleMs,
    uncertainMs: evaluation.uncertainMs,
    sensorLossMs: evaluation.sensorLossMs,
    outcome: evaluation.outcome,
    eligibleForCapture: evaluation.eligibleForCapture,
    evaluationJson: JSON.stringify(evaluation),
    evaluationHash: hashCanonical(evaluation),
    evidenceRoot: evaluation.evidenceRoot,
    failureReason: evaluation.eligibleForCapture ? null : evaluation.reason,
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: evaluation.eligibleForCapture ? 'promise.qualified' : 'promise.not_qualified',
      subjectType: 'promise_execution',
      subjectId: row.id,
      metadata: {
        agreementId: agreement.id,
        outcome: evaluation.outcome,
        runMs: evaluation.runMs,
        priceMinor: terms.financial.fixedPriceMinor,
        evidenceRoot: evaluation.evidenceRoot,
      },
    },
    ctx.now(),
  );
  return executionView(ctx, row.id, { type: 'renter', id: renter.id });
}

async function revalidateBeforeCapture(ctx: AppContext, row: PromiseExecutionRow): Promise<PromiseEvaluation> {
  const terms = executionTerms(row);
  const observations = observationRows(ctx, row.id).map(observationFromRow);
  const currentModel = latestEventModelRow(ctx, row.object_id);
  const evaluation = await evaluatePromise({
    terms,
    agreementHash: row.agreement_hash,
    observations,
    currentModelHash: currentModel?.model_hash,
    now: ctx.now().toISOString(),
  });
  if (!evaluation.eligibleForCapture || evaluation.outcome !== 'QUALIFIED') {
    setExecution(ctx, row.id, {
      state: evaluation.outcome === 'UNCERTAIN' || evaluation.outcome === 'SENSOR_LOST' ? 'NEEDS_REVIEW' : 'INELIGIBLE',
      eligibleForCapture: false,
      outcome: evaluation.outcome,
      evaluationJson: JSON.stringify(evaluation),
      evaluationHash: hashCanonical(evaluation),
      failureReason: evaluation.reason,
    });
    throw errors.conflict('EVIDENCE_NO_LONGER_QUALIFIES', evaluation.reason);
  }
  return evaluation;
}

export async function capturePromiseExecution(
  ctx: AppContext,
  actor: Actor,
  executionId: string,
): Promise<PromiseExecutionView> {
  let row = requireExecutionForActor(ctx, executionId, actor);
  if (row.demo) throw errors.conflict('DEMO_EXECUTION', 'Demo observations never capture a payment.');
  const paypal = requirePayPal(ctx);
  if (row.captured_minor !== null || row.state === 'CAPTURE_CONFIRMED') {
    return executionView(ctx, row.id, actor);
  }
  if (row.state !== 'ELIGIBLE_FOR_CAPTURE') throw errors.conflict('NOT_ELIGIBLE', 'This observation is not eligible for capture.');
  if (row.payment_state !== 'AUTHORIZED') throw errors.conflict('PAYMENT_STATE', `Payment is ${row.payment_state}.`);
  if (!row.paypal_authorization_id) throw errors.conflict('NO_AUTHORIZATION', 'No PayPal authorization exists.');
  if (row.authorization_expires_at && Date.parse(row.authorization_expires_at) <= ctx.now().getTime()) {
    setExecution(ctx, row.id, { state: 'EXPIRED', failureReason: 'Authorization expired before capture.' });
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The authorization expired. No charge was made.');
  }
  const evaluation = await revalidateBeforeCapture(ctx, row);
  const terms = executionTerms(row);
  if (evaluation.priceMinor > terms.financial.maximumChargeMinor) {
    throw errors.conflict('CHARGE_CEILING', 'The capture amount exceeds the approved ceiling.');
  }
  const requestId = providerRequestId([
    'promise-capture',
    row.id,
    row.agreement_hash,
    row.paypal_authorization_id,
    evaluation.priceMinor,
  ]);
  const operation = ensurePaymentOperation(ctx, row.id, 'CAPTURE', {
    requestId,
    amountMinor: evaluation.priceMinor,
    currency: evaluation.currency,
    state: 'REQUESTED',
  });
  setExecution(ctx, row.id, {
    state: 'CAPTURE_REQUESTED',
    paymentState: 'CAPTURE_REQUESTED',
    failureReason: null,
  });
  try {
    const capture: PayPalCapture = await paypal.captureAuthorization({
      authorizationId: row.paypal_authorization_id,
      amountMinor: evaluation.priceMinor,
      currency: evaluation.currency,
      requestId,
      invoiceId: row.id,
      noteToPayer: `Whirr physical promise ${row.id.slice(-8)} - ${(evaluation.runMs / 1000).toFixed(1)}s qualified run`,
    });
    const capturedAmount = capture.amount
      ? decimalStringToMinor(String(capture.amount.value), evaluation.currency)
      : null;
    const amountOk = capture.amount ? amountMatches(capture.amount, evaluation.priceMinor, evaluation.currency) : false;
    if (capture.status === 'COMPLETED' && amountOk) {
      setExecution(ctx, row.id, {
        state: 'CAPTURE_CONFIRMED',
        paymentState: 'CAPTURE_COMPLETED',
        captureId: capture.id,
        providerStatus: capture.status,
        capturedMinor: capturedAmount,
        failureReason: null,
      });
      finishPaymentOperation(ctx, operation, { state: 'COMPLETED', providerRef: capture.id, response: capture });
      appendAudit(ctx.store, {
        actorType: actor.type,
        actorId: actor.id,
        action: 'promise.capture_confirmed',
        subjectType: 'promise_execution',
        subjectId: row.id,
        metadata: {
          captureId: capture.id,
          capturedMinor: capturedAmount,
          currency: evaluation.currency,
          providerStatus: capture.status,
        },
      }, ctx.now());
    } else if (capture.status === 'PENDING') {
      setExecution(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'CAPTURE_PENDING',
        captureId: capture.id,
        providerStatus: capture.status,
        capturedMinor: null,
        failureReason: 'PayPal accepted the capture but reports PENDING. Reconcile before retrying.',
      });
      finishPaymentOperation(ctx, operation, { state: 'PENDING', providerRef: capture.id, response: capture });
    } else {
      setExecution(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        captureId: capture.id,
        providerStatus: capture.status,
        capturedMinor: null,
        failureReason: `PayPal capture returned ${capture.status}. Reconcile before any retry.`,
      });
      finishPaymentOperation(ctx, operation, { state: capture.status, providerRef: capture.id, response: capture });
    }
    row = requireExecution(ctx, row.id);
    return executionView(ctx, row.id, actor);
  } catch (error) {
    finishPaymentOperation(ctx, operation, { state: 'UNKNOWN' });
    setExecution(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      paymentState: 'UNRESOLVED',
      providerStatus: 'CAPTURE_OUTCOME_UNKNOWN',
      failureReason: 'The provider outcome is unknown. Reconcile before retrying; do not start a second capture.',
    });
    throw providerFailure(error);
  }
}

export async function voidPromiseExecution(
  ctx: AppContext,
  actor: Actor,
  executionId: string,
): Promise<PromiseExecutionView> {
  const row = requireExecutionForActor(ctx, executionId, actor);
  if (row.demo) throw errors.conflict('DEMO_EXECUTION', 'A demo observation has no authorization to void.');
  if (row.paypal_capture_id || row.state === 'CAPTURE_CONFIRMED') {
    throw errors.conflict('ALREADY_CAPTURED', 'A confirmed capture cannot be voided. Use a refund workflow if supported.');
  }
  if (row.state === 'VOID_CONFIRMED') return executionView(ctx, row.id, actor);
  if (!row.paypal_authorization_id) {
    setExecution(ctx, row.id, { state: 'VOID_CONFIRMED', paymentState: 'VOIDED', providerStatus: 'NO_AUTHORIZATION' });
    return executionView(ctx, row.id, actor);
  }
  const paypal = requirePayPal(ctx);
  const requestId = providerRequestId(['promise-void', row.id, row.agreement_hash, row.paypal_authorization_id]);
  const operation = ensurePaymentOperation(ctx, row.id, 'VOID', {
    requestId,
    amountMinor: 0,
    currency: executionTerms(row).financial.currency,
    state: 'REQUESTED',
  });
  setExecution(ctx, row.id, { state: 'VOID_REQUESTED', paymentState: 'VOID_REQUESTED', failureReason: null });
  try {
    const authorization = await paypal.voidAuthorization(row.paypal_authorization_id, requestId);
    setExecution(ctx, row.id, {
      state: 'VOID_CONFIRMED',
      paymentState: 'VOIDED',
      voidId: authorization.id,
      providerStatus: authorization.status,
      capturedMinor: null,
    });
    finishPaymentOperation(ctx, operation, { state: 'COMPLETED', providerRef: authorization.id, response: authorization });
    appendAudit(ctx.store, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'promise.void_confirmed',
      subjectType: 'promise_execution',
      subjectId: row.id,
      metadata: { authorizationId: authorization.id, status: authorization.status },
    }, ctx.now());
    return executionView(ctx, row.id, actor);
  } catch (error) {
    finishPaymentOperation(ctx, operation, { state: 'UNKNOWN' });
    setExecution(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      paymentState: 'UNRESOLVED',
      providerStatus: 'VOID_OUTCOME_UNKNOWN',
      failureReason: 'The void outcome is unknown. Reconcile before retrying.',
    });
    throw providerFailure(error);
  }
}

export interface PromiseReconciliationResult {
  executionId: string;
  result:
    | 'NO_CHANGE'
    | 'CAPTURE_CONFIRMED'
    | 'VOID_CONFIRMED'
    | 'RECONCILIATION_REQUIRED'
    | 'RECONCILE_FAILED';
}

/**
 * Resolve a PayPal identifier to a promise execution only through identifiers
 * this installation stored itself. A provider event never supplies a local ID.
 */
export function findPromiseExecutionForProviderIds(
  ctx: AppContext,
  providerIds: string[],
): string | null {
  for (const providerId of providerIds) {
    if (!providerId) continue;
    const row = ctx.store.get<{ id: string }>(
      `SELECT id FROM promise_executions
       WHERE paypal_order_id = ? OR paypal_authorization_id = ?
          OR paypal_capture_id = ? OR paypal_void_id = ?
       LIMIT 1`,
      providerId,
      providerId,
      providerId,
      providerId,
    );
    if (row) return row.id;
    const operation = ctx.store.get<{ execution_id: string }>(
      'SELECT execution_id FROM promise_payment_operations WHERE provider_ref = ? LIMIT 1',
      providerId,
    );
    if (operation) return operation.execution_id;
  }
  return null;
}

async function verifyStoredPromiseEvaluation(
  ctx: AppContext,
  row: PromiseExecutionRow,
): Promise<{ evaluation: PromiseEvaluation; evidenceMatches: boolean }> {
  const terms = executionTerms(row);
  if (!row.evaluation_json || !row.evaluation_hash) {
    throw errors.conflict('NO_EVALUATION', 'This execution has no stored contract evaluation.');
  }
  const stored = JSON.parse(row.evaluation_json) as PromiseEvaluation;
  // Recompute against the approved model at the agreement's own approval
  // instant. Reconciliation confirms a provider fact; it must not let a later
  // retrain or the passage of time create new evidence for a capture.
  const recomputed = await evaluatePromise({
    terms,
    agreementHash: row.agreement_hash,
    observations: observationRows(ctx, row.id).map(observationFromRow),
    currentModelHash: terms.eventModel.hash,
    now: terms.createdAt,
  });
  const storedHash = hashCanonical(stored);
  return {
    evaluation: recomputed,
    evidenceMatches:
      storedHash === row.evaluation_hash &&
      storedHash === hashCanonical(recomputed) &&
      stored.outcome === recomputed.outcome &&
      stored.eligibleForCapture === recomputed.eligibleForCapture &&
      stored.priceMinor === recomputed.priceMinor &&
      stored.agreementHash === row.agreement_hash,
  };
}

/**
 * Read-only reconciliation for promise executions. It never captures, voids or
 * creates an order. A capture is confirmed only when PayPal reports COMPLETED,
 * the amount matches the stored qualified evaluation and ceiling, and a fresh
 * deterministic evaluation of the stored observations agrees with the stored
 * hash. Any disagreement stays RECONCILIATION_REQUIRED with no settlement.
 */
export async function reconcilePromiseExecution(
  ctx: AppContext,
  executionId: string,
): Promise<PromiseReconciliationResult> {
  const row = requireExecution(ctx, executionId);
  if (row.demo || !ctx.paypal) return { executionId: row.id, result: 'NO_CHANGE' };
  if (row.state === 'CAPTURE_CONFIRMED' || row.state === 'VOID_CONFIRMED') {
    return { executionId: row.id, result: 'NO_CHANGE' };
  }
  const paypal = ctx.paypal;
  const terms = executionTerms(row);
  const reconciledAt = ctx.now().toISOString();
  const markReconciled = () => {
    ctx.store.run('UPDATE promise_executions SET provider_reconciled_at = ? WHERE id = ?', reconciledAt, row.id);
  };
  try {
    if (row.paypal_capture_id) {
      const capture = await paypal.getCapture(row.paypal_capture_id);
      if (capture.status === 'COMPLETED') {
        const { evaluation, evidenceMatches } = await verifyStoredPromiseEvaluation(ctx, row);
        const amountOk = amountMatches(capture.amount, evaluation.priceMinor, terms.financial.currency);
        const ceilingOk = evaluation.priceMinor <= terms.financial.maximumChargeMinor;
        const operation = paymentOperation(ctx, row.id, 'CAPTURE');
        const operationOk =
          !operation ||
          (operation.amount_minor === evaluation.priceMinor && operation.currency === terms.financial.currency);
        if (
          evidenceMatches &&
          evaluation.eligibleForCapture &&
          evaluation.outcome === 'QUALIFIED' &&
          amountOk &&
          ceilingOk &&
          operationOk
        ) {
          const capturedMinor = decimalStringToMinor(String(capture.amount!.value), terms.financial.currency);
          setExecution(ctx, row.id, {
            state: 'CAPTURE_CONFIRMED',
            paymentState: 'CAPTURE_COMPLETED',
            captureId: capture.id,
            providerStatus: capture.status,
            capturedMinor,
            failureReason: null,
          });
          if (operation) {
            finishPaymentOperation(ctx, operation, {
              state: 'COMPLETED',
              providerRef: capture.id,
              response: capture,
            });
          }
          appendAudit(
            ctx.store,
            {
              actorType: 'system',
              actorId: 'webhook',
              action: 'promise.capture_reconciled',
              subjectType: 'promise_execution',
              subjectId: row.id,
              metadata: {
                captureId: capture.id,
                capturedMinor,
                currency: terms.financial.currency,
                providerStatus: capture.status,
              },
            },
            ctx.now(),
          );
          markReconciled();
          return { executionId: row.id, result: 'CAPTURE_CONFIRMED' };
        }
        const providerStatus =
          !evidenceMatches || !evaluation.eligibleForCapture
            ? 'EVIDENCE_NOT_QUALIFIED'
            : !amountOk
              ? 'AMOUNT_MISMATCH'
              : 'CAPTURE_CONTRACT_MISMATCH';
        setExecution(ctx, row.id, {
          state: 'RECONCILIATION_REQUIRED',
          paymentState: 'UNRESOLVED',
          providerStatus,
          capturedMinor: null,
          failureReason:
            'PayPal reports a completed capture, but the stored evidence, approved amount or payment operation does not agree. Do not retry or claim settlement; review manually.',
        });
        if (operation) {
          finishPaymentOperation(ctx, operation, {
            state: 'REVIEW_REQUIRED',
            providerRef: capture.id,
            response: capture,
          });
        }
        appendAudit(
          ctx.store,
          {
            actorType: 'system',
            actorId: 'webhook',
            action: 'promise.capture_conflict',
            subjectType: 'promise_execution',
            subjectId: row.id,
            metadata: { captureId: capture.id, providerStatus },
          },
          ctx.now(),
        );
        markReconciled();
        return { executionId: row.id, result: 'RECONCILIATION_REQUIRED' };
      }
      if (capture.status === 'PENDING') {
        setExecution(ctx, row.id, {
          paymentState: 'CAPTURE_PENDING',
          providerStatus: capture.status,
          capturedMinor: null,
        });
        const operation = paymentOperation(ctx, row.id, 'CAPTURE');
        if (operation) {
          finishPaymentOperation(ctx, operation, { state: 'PENDING', providerRef: capture.id, response: capture });
        }
        markReconciled();
        return { executionId: row.id, result: 'NO_CHANGE' };
      }
      setExecution(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        providerStatus: capture.status,
        capturedMinor: null,
        failureReason: `PayPal capture status ${capture.status}. No settlement is confirmed.`,
      });
      const operation = paymentOperation(ctx, row.id, 'CAPTURE');
      if (operation) {
        finishPaymentOperation(ctx, operation, { state: capture.status, providerRef: capture.id, response: capture });
      }
      markReconciled();
      return { executionId: row.id, result: 'RECONCILIATION_REQUIRED' };
    }

    if (row.paypal_authorization_id) {
      const authorization = await paypal.getAuthorization(row.paypal_authorization_id);
      if (authorization.status === 'VOIDED') {
        setExecution(ctx, row.id, {
          state: 'VOID_CONFIRMED',
          paymentState: 'VOIDED',
          voidId: authorization.id,
          providerStatus: authorization.status,
          capturedMinor: null,
          failureReason: null,
        });
        const operation = paymentOperation(ctx, row.id, 'VOID');
        if (operation) {
          finishPaymentOperation(ctx, operation, {
            state: 'COMPLETED',
            providerRef: authorization.id,
            response: authorization,
          });
        }
        appendAudit(
          ctx.store,
          {
            actorType: 'system',
            actorId: 'webhook',
            action: 'promise.void_reconciled',
            subjectType: 'promise_execution',
            subjectId: row.id,
            metadata: { authorizationId: authorization.id, providerStatus: authorization.status },
          },
          ctx.now(),
        );
        markReconciled();
        return { executionId: row.id, result: 'VOID_CONFIRMED' };
      }
      if (authorization.status === 'CAPTURED' || authorization.status === 'PARTIALLY_CAPTURED') {
        setExecution(ctx, row.id, {
          state: 'RECONCILIATION_REQUIRED',
          paymentState: 'UNRESOLVED',
          providerStatus: authorization.status,
          capturedMinor: null,
          failureReason:
            'PayPal reports the authorization captured, but no capture ID is stored. Review in PayPal before claiming settlement.',
        });
        markReconciled();
        return { executionId: row.id, result: 'RECONCILIATION_REQUIRED' };
      }
      if (authorization.status === 'CREATED') {
        setExecution(ctx, row.id, { providerStatus: authorization.status });
        markReconciled();
        return { executionId: row.id, result: 'NO_CHANGE' };
      }
      setExecution(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        providerStatus: authorization.status,
        failureReason: `PayPal authorization status ${authorization.status}. No capture is confirmed.`,
      });
      markReconciled();
      return { executionId: row.id, result: 'RECONCILIATION_REQUIRED' };
    }

    if (row.paypal_order_id) {
      const order = await paypal.getOrder(row.paypal_order_id);
      if (order.status === 'APPROVED' && row.payment_state === 'ORDER_CREATED') {
        setExecution(ctx, row.id, { paymentState: 'BUYER_APPROVED', providerStatus: order.status });
      } else {
        setExecution(ctx, row.id, { providerStatus: order.status });
      }
      markReconciled();
      return { executionId: row.id, result: 'NO_CHANGE' };
    }
    return { executionId: row.id, result: 'NO_CHANGE' };
  } catch (error) {
    if (error instanceof AppError && error.code === 'NO_EVALUATION') {
      setExecution(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        providerStatus: 'NO_EVALUATION',
        capturedMinor: null,
        failureReason:
          'PayPal returned a provider state, but this execution has no stored contract evaluation. Do not retry or claim settlement; review manually.',
      });
      markReconciled();
      return { executionId: row.id, result: 'RECONCILIATION_REQUIRED' };
    }
    appendAudit(
      ctx.store,
      {
        actorType: 'system',
        actorId: 'webhook',
        action: 'promise.reconcile_failed',
        subjectType: 'promise_execution',
        subjectId: row.id,
        metadata: { message: (error as Error).message.slice(0, 200) },
      },
      ctx.now(),
    );
    ctx.store.run('UPDATE promise_executions SET provider_status = ? WHERE id = ?', 'RECONCILE_FAILED', row.id);
    return { executionId: row.id, result: 'RECONCILE_FAILED' };
  }
}

export async function promiseProof(
  ctx: AppContext,
  executionId: string,
  actor?: Actor,
  proofIdOverride?: string,
): Promise<PromiseProofView> {
  const row = actor ? requireExecutionForActor(ctx, executionId, actor) : requireExecution(ctx, executionId);
  const existing = ctx.store.get<PromiseProofRow>('SELECT * FROM promise_proofs WHERE execution_id = ?', row.id);
  if (!existing) {
    if (!row.observation_stopped_at) throw errors.conflict('PROOF_NOT_READY', 'Stop the observation before creating a proof.');
    const agreement = executionAgreement(ctx, row);
    const object = requirePromiseObject(ctx, row.object_id);
    const terms = executionTerms(row);
    const modelRow = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', agreement.event_model_id);
    if (!modelRow) throw errors.internal('Proof model is missing.');
    const artifact = JSON.parse(modelRow.artifact_json) as EventModelArtifact;
      const modelHash = hashCanonical(artifact);
    if (modelHash !== modelRow.model_hash) throw errors.internal('Event model artifact hash does not match its stored digest.');
    const observations = observationRows(ctx, row.id).map(observationFromRow);
    if (!row.evaluation_json) throw errors.conflict('PROOF_NOT_READY', 'No contract evaluation exists for this execution.');
    const evaluation = JSON.parse(row.evaluation_json) as PromiseEvaluation;
    const now = ctx.now().toISOString();
    const proofId = proofIdOverride ?? newId('ppr');
    const payment: PhysicalProofPayment = {
      mode: row.demo ? 'DEMO_NO_PAYMENT' : 'PAYPAL_SANDBOX',
      state: row.payment_state,
      orderId: row.paypal_order_id,
      authorizationId: row.paypal_authorization_id,
      captureId: row.paypal_capture_id,
      voidId: row.paypal_void_id,
      providerStatus: row.provider_status,
      providerConfirmed: Boolean(row.paypal_capture_id) && row.captured_minor !== null,
      capturedMinor: row.captured_minor,
      currency: terms.financial.currency,
      providerLookup: row.paypal_capture_id
        ? 'CAPTURE_COMPLETED'
        : row.paypal_void_id
          ? 'VOIDED'
          : row.paypal_authorization_id
            ? 'AUTHORIZATION_CREATED'
            : 'NOT_PERFORMED',
    };
    const payload: PhysicalProofPayload = {
      schema: 'whirr.physical-proof.v1',
      proofId,
      executionId: row.id,
      createdAt: now,
      representativeRef: shortRef('renter', row.renter_id),
      object: { id: object.id, name: object.name, glyph: object.glyph },
      agreement: { id: agreement.id, hash: row.agreement_hash, terms },
      model: {
        id: agreement.event_model_id,
        version: modelRow.version,
        hash: modelRow.model_hash,
        status: modelRow.status === 'READY' ? 'READY' : 'LIMITED',
        provenance: modelRow.provenance,
        datasetHash: modelRow.dataset_hash,
        artifact,
        metrics: {
          frameAccuracy: artifact.metrics.frameAccuracy,
          macroRecall: artifact.metrics.macroRecall,
          unknownRate: artifact.metrics.unknownRate,
        },
      },
      session: {
        createdAt: row.created_at,
        consentedAt: row.consented_at,
        authorizedAt: row.authorized_at,
        observationStartedAt: row.observation_started_at,
        observationStoppedAt: row.observation_stopped_at,
        completedAt: row.completed_at,
        demo: Boolean(row.demo),
        observationMode: row.observation_mode,
      },
      observations,
      observationsHash: evaluation.observationsHash,
      evaluation,
      evidenceRoot: row.evidence_root ?? evaluation.evidenceRoot,
      approvals: {
        ownerApprovedAt: agreement.created_at,
        buyerConsentedAt: row.consented_at,
        buyerTermsHash: row.agreement_hash,
        humanAcceptance: row.human_acceptance_json ? (JSON.parse(row.human_acceptance_json) as unknown) : null,
      },
      payment,
      trust: [
        {
          domain: 'INTEGRITY',
          status: 'CHECKED',
          detail: 'The proof payload is signed with the installation ECDSA key and the agreement, observations and evidence root are hashed.',
        },
        {
          domain: 'SENSOR_PROVENANCE',
          status: 'NOT_VERIFIABLE_OFFLINE',
          detail: 'The browser reports microphone states and quality flags. The proof binds those claims but cannot prove that the microphone or its operator was honest.',
        },
        {
          domain: 'INFERENCE',
          status: 'CHECKED',
          detail: 'The event model artifact is embedded and its hash is independently recomputable. Model metrics are leave-one-take-out results on the stated dataset.',
        },
        {
          domain: 'CONTRACT_COMPLIANCE',
          status: 'CHECKED',
          detail: 'The verifier replays the temporal evaluator against the exact approved terms and observation ledger.',
        },
        {
          domain: 'FINANCIAL_CONFIRMATION',
          status: payment.providerConfirmed ? 'CHECKED' : 'NOT_CONFIRMED',
          detail: payment.providerConfirmed
            ? 'A provider capture identifier and matching captured amount are present. A verifier still needs PayPal access to confirm the provider record.'
            : 'No provider-confirmed capture is claimed by this proof.',
        },
        {
          domain: 'REAL_WORLD_FULFILLMENT',
          status: 'NOT_CLAIMED',
          detail: 'The proof does not establish that a physical task produced a correct or useful result. It records an observable operating sequence only.',
        },
      ],
      limitations: [
        ...artifact.limitations,
        'A temporal stop is inferred when confident active sensing returns to confident idle. This is not a separately classified completion sound.',
        'Only PayPal Sandbox is supported. The proof never represents a sandbox capture as real money.',
      ],
      attestation:
        'Whirr attests that this installation produced the signed observation and evaluation record. It does not attest to microphone honesty, real-world product quality, or provider settlement beyond the embedded provider references.',
    };
    const signed = await ctx.signer.sign('physical-proof', payload);
    const publicSigned = signed;
    const payloadHash = hashCanonical(payload);
    ctx.store.run(
      `INSERT INTO promise_proofs (id, execution_id, payload_hash, document_json, public_document_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      proofId,
      row.id,
      payloadHash,
      JSON.stringify(signed),
      JSON.stringify(publicSigned),
      now,
    );
  }
  const proof = ctx.store.get<PromiseProofRow>('SELECT * FROM promise_proofs WHERE execution_id = ?', row.id)!;
  const publicDocument = JSON.parse(proof.public_document_json) as unknown;
  const verification = await verifyPhysicalProofDocument(publicDocument);
  return {
    id: proof.id,
    executionId: proof.execution_id,
    agreementHash: row.agreement_hash,
    createdAt: proof.created_at,
    document: JSON.parse(proof.document_json) as unknown,
    publicDocument,
    verification: {
      valid: verification.valid,
      signatureValid: verification.signatureValid,
      agreementHashValid: verification.agreementHashValid,
      modelHashValid: verification.modelHashValid,
      observationsHashValid: verification.observationsHashValid,
      evidenceRootValid: verification.evidenceRootValid,
      evaluationMatches: verification.evaluationMatches,
      paymentConsistent: verification.paymentConsistent,
      checks: verification.checks,
      disclaimer: verification.disclaimer,
    },
  };
}

export function publicPromiseProof(ctx: AppContext, proofId: string): PromiseProofView {
  const row = ctx.store.get<PromiseProofRow>('SELECT * FROM promise_proofs WHERE id = ?', proofId);
  if (!row) throw errors.notFound('Physical proof not found.');
  const execution = requireExecution(ctx, row.execution_id);
  return {
    id: row.id,
    executionId: row.execution_id,
    agreementHash: execution.agreement_hash,
    createdAt: row.created_at,
    document: JSON.parse(row.document_json) as unknown,
    publicDocument: JSON.parse(row.public_document_json) as unknown,
    verification: {
      valid: false,
      signatureValid: false,
      agreementHashValid: false,
      modelHashValid: false,
      observationsHashValid: false,
      evidenceRootValid: false,
      evaluationMatches: false,
      paymentConsistent: false,
      checks: [],
      disclaimer: 'Open the verifier endpoint to recompute this public proof.',
    },
  };
}

export async function verifyPublicPromiseProof(ctx: AppContext, proofId: string): Promise<PromiseProofView> {
  const row = ctx.store.get<PromiseProofRow>('SELECT * FROM promise_proofs WHERE id = ?', proofId);
  if (!row) throw errors.notFound('Physical proof not found.');
  const execution = requireExecution(ctx, row.execution_id);
  const publicDocument = JSON.parse(row.public_document_json) as unknown;
  const verification = await verifyPhysicalProofDocument(publicDocument);
  return {
    id: row.id,
    executionId: row.execution_id,
    agreementHash: execution.agreement_hash,
    createdAt: row.created_at,
    document: JSON.parse(row.document_json) as unknown,
    publicDocument,
    verification: {
      valid: verification.valid,
      signatureValid: verification.signatureValid,
      agreementHashValid: verification.agreementHashValid,
      modelHashValid: verification.modelHashValid,
      observationsHashValid: verification.observationsHashValid,
      evidenceRootValid: verification.evidenceRootValid,
      evaluationMatches: verification.evaluationMatches,
      paymentConsistent: verification.paymentConsistent,
      checks: verification.checks,
      disclaimer: verification.disclaimer,
    },
  };
}

export function listPromiseExecutions(ctx: AppContext, actor: Actor, limit = 50): PromiseExecutionListItem[] {
  const rows = ctx.store.all<PromiseExecutionRow & { object_name: string; service_name: string }>(
    `SELECT e.*, o.name AS object_name, a.service_name
     FROM promise_executions e
     JOIN objects o ON o.id = e.object_id
     JOIN promise_agreements a ON a.id = e.agreement_id
     WHERE (e.renter_id = ? OR e.owner_id = ?)
     ORDER BY e.created_at DESC LIMIT ?`,
    actor.id,
    actor.id,
    limit,
  );
  return rows.map((row) => {
    const terms = executionTerms(row);
    return {
      id: row.id,
      agreementId: row.agreement_id,
      objectId: row.object_id,
      objectName: row.object_name,
      serviceName: row.service_name,
      state: row.state,
      paymentState: row.payment_state,
      demo: Boolean(row.demo),
      outcome: row.outcome,
      eligibleForCapture: Boolean(row.eligible_for_capture),
      priceMinor: terms.financial.fixedPriceMinor,
      currency: terms.financial.currency,
      runMs: row.run_ms,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  });
}

export function promiseJudge(ctx: AppContext): PromiseJudgeView {
  const rows = ctx.store.all<PromiseExecutionRow & { object_name: string; service_name: string }>(
    `SELECT e.*, o.name AS object_name, a.service_name
     FROM promise_executions e
     JOIN objects o ON o.id = e.object_id
     JOIN promise_agreements a ON a.id = e.agreement_id
     ORDER BY e.created_at DESC LIMIT 12`,
  );
  const seedAgreement = ctx.store.get<PromiseAgreementRow>(
    'SELECT * FROM promise_agreements ORDER BY created_at DESC LIMIT 1',
  );
  const seedModel = seedAgreement
    ? ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', seedAgreement.event_model_id)
    : undefined;
  const genuineCapture = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM promise_executions WHERE captured_minor IS NOT NULL AND demo = 0",
  );
  return {
    available: Boolean(seedAgreement),
    generatedAt: ctx.now().toISOString(),
    seed: {
      agreementId: seedAgreement?.id ?? null,
      objectId: seedAgreement?.object_id ?? null,
      eventModelId: seedAgreement?.event_model_id ?? null,
      provenance: seedModel?.provenance ?? null,
    },
    latestExecutions: rows.map((row) => {
      const terms = executionTerms(row);
      return {
        id: row.id,
        agreementId: row.agreement_id,
        objectId: row.object_id,
        objectName: row.object_name,
        serviceName: row.service_name,
        state: row.state,
        paymentState: row.payment_state,
        demo: Boolean(row.demo),
        outcome: row.outcome,
        eligibleForCapture: Boolean(row.eligible_for_capture),
        priceMinor: terms.financial.fixedPriceMinor,
        currency: terms.financial.currency,
        runMs: row.run_ms,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      };
    }),
    evidence: {
      physicalFieldTrial: 'OPEN_NOT_RUN',
      genuineSandboxCapture: (genuineCapture?.count ?? 0) > 0 ? 'OBSERVED' : 'OPEN_NOT_RUN',
      webhookDelivery: 'OPEN_NOT_VERIFIED',
    },
    limitations: [
      'The seeded reference model is trained on procedurally synthesized audio, not a physical appliance. The UI labels it SYNTHETIC.',
      'A genuine physical field trial has not been performed by the software itself. The protocol is documented and the gate remains OPEN.',
      'A real PayPal Sandbox buyer approval, capture and webhook delivery require the human operator. No provider action is fabricated.',
    ],
  };
}

export function seededAgreementId(ctx: AppContext): string | null {
  return ctx.store.get<{ id: string }>('SELECT id FROM promise_agreements ORDER BY created_at DESC LIMIT 1')?.id ?? null;
}

export function executionExists(ctx: AppContext, id: string): boolean {
  return Boolean(ctx.store.get<{ id: string }>('SELECT id FROM promise_executions WHERE id = ?', id));
}

export { agreementRow, executionTerms, hashAgreementTerms };
