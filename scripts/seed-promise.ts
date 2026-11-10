import { pathToFileURL } from 'node:url';
import type { AppContext } from '../apps/api/src/context.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { Store } from '../apps/api/src/db/index.ts';
import { hashCanonical } from '../apps/api/src/lib/hash.ts';
import { appendAudit } from '../apps/api/src/lib/audit.ts';
import { promiseProof } from '../apps/api/src/domain/promises.ts';
import { loadSigner } from '../apps/api/src/lib/signing.ts';
import { RateLimiter } from '../apps/api/src/lib/rate-limit.ts';
import { generateReferenceData } from './generate-fixtures.ts';
import { REFERENCE_CREATED_AT, REFERENCE_OBJECT_ID } from './reference-config.ts';
import { compilePhysicalAgreement, evaluatePromise, type PromiseObservation } from '../packages/promise/src/index.ts';
import { trainEventModel, type EventDemonstration, type EventModelArtifact } from '../packages/audio/src/event-model.ts';
import { FEATURE_SPEC_VERSION } from '../packages/audio/src/spec.ts';
import type { EventModelRow, PromiseExecutionRow, PromiseObservationRow } from '../apps/api/src/domain/rows.ts';

const EVENT_MODEL_ID = 'evm_promise_reference';
const AGREEMENT_ID = 'prm_reference_fan';
const DEMO_RENTER_ID = 'usr_promise_viewer';

function upsertDemo(store: Store, take: EventDemonstration, index: number): void {
  const id = `evd_ref_${take.label}_${String(index + 1).padStart(2, '0')}`;
  store.run(
    `INSERT INTO event_demonstrations
      (id, object_id, label, frames_json, frame_flags_json, frame_count, duration_ms, feature_spec_version,
       source, provenance, session_group, device_label, notes, dataset_hash, captured_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synthetic', 'SYNTHETIC_REFERENCE', ?, 'Procedural reference dataset', 'Synthetic demonstration used only for the judge replay.', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       frames_json = excluded.frames_json,
       frame_flags_json = excluded.frame_flags_json,
       frame_count = excluded.frame_count,
       duration_ms = excluded.duration_ms,
       dataset_hash = excluded.dataset_hash`,
    id,
    REFERENCE_OBJECT_ID,
    take.label,
    JSON.stringify(take.frames),
    JSON.stringify(take.frameFlags ?? take.frames.map(() => [])),
    take.frames.length,
    take.durationMs,
    FEATURE_SPEC_VERSION,
    take.sessionGroup,
    hashCanonical({
      schema: 'whirr.event-demonstration.v1',
      objectId: REFERENCE_OBJECT_ID,
      label: take.label,
      frameCount: take.frames.length,
      durationMs: take.durationMs,
      sessionGroup: take.sessionGroup,
      featureSpecVersion: FEATURE_SPEC_VERSION,
    }),
    take.createdAt,
    take.createdAt,
  );
}

async function seedSyntheticExecution(
  ctx: AppContext,
  agreementHash: string,
  termsJson: string,
  executionId: string,
  kind: 'incomplete' | 'qualified',
): Promise<void> {
  const terms = JSON.parse(termsJson) as Parameters<typeof evaluatePromise>[0]['terms'];
  const base = kind === 'qualified' ? 21_000 : 10_000;
  const observations: PromiseObservation[] =
    kind === 'qualified'
      ? [
          { seq: 1, startMs: 0, endMs: 5_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
          { seq: 2, startMs: 5_000, endMs: base, state: 'ACTIVE_CONFIDENT', confidence: 0.96, qualityFlags: [], eventMatch: 0.88 },
          { seq: 3, startMs: base, endMs: 26_000, state: 'IDLE', confidence: 0.95, qualityFlags: [] },
        ]
      : [
          { seq: 1, startMs: 0, endMs: 4_000, state: 'IDLE', confidence: 0.94, qualityFlags: [] },
          { seq: 2, startMs: 4_000, endMs: 12_000, state: 'ACTIVE_CONFIDENT', confidence: 0.92, qualityFlags: [], eventMatch: 0.84 },
          { seq: 3, startMs: 12_000, endMs: 18_000, state: 'IDLE', confidence: 0.93, qualityFlags: [] },
        ];
  const evaluation = await evaluatePromise({
    terms,
    agreementHash,
    observations,
    currentModelHash: terms.eventModel.hash,
    now: terms.createdAt,
  });
  const now = terms.createdAt;
  const state = evaluation.outcome === 'QUALIFIED' ? 'ELIGIBLE_FOR_CAPTURE' : 'INELIGIBLE';
  const existing = ctx.store.get<{ id: string }>('SELECT id FROM promise_executions WHERE id = ?', executionId);
  const existingProof = ctx.store.get<{ id: string }>(
    'SELECT id FROM promise_proofs WHERE execution_id = ?',
    executionId,
  );
  if (!existing) {
    ctx.store.run(
      `INSERT INTO promise_executions
        (id, agreement_id, agreement_hash, object_id, owner_id, renter_id, state, payment_state, demo, observation_mode,
         terms_snapshot_json, created_at, consented_at, observation_started_at, observation_stopped_at, completed_at,
         last_client_seq, last_observed_ms, observed_ms, run_ms, idle_ms, uncertain_ms, sensor_loss_ms, outcome,
         eligible_for_capture, evaluation_json, evaluation_hash, evidence_root, failure_reason)
       VALUES (?, ?, ?, ?, 'usr_operator', ?, ?, 'DEMO_MODE', 1, 'REPLAY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      executionId,
      AGREEMENT_ID,
      agreementHash,
      REFERENCE_OBJECT_ID,
      DEMO_RENTER_ID,
      state,
      termsJson,
      now,
      now,
      now,
      now,
      now,
      observations.length,
      observations[observations.length - 1]!.endMs,
      evaluation.observedMs,
      evaluation.runMs,
      evaluation.idleMs,
      evaluation.uncertainMs,
      evaluation.outcome,
      evaluation.eligibleForCapture ? 1 : 0,
      JSON.stringify(evaluation),
      hashCanonical(evaluation),
      evaluation.evidenceRoot,
      evaluation.reason,
    );
  }
  // Always replace observation rows for deterministic replay.
  ctx.store.run('DELETE FROM promise_observations WHERE execution_id = ?', executionId);
  for (const observation of observations) {
    ctx.store.run(
      `INSERT INTO promise_observations
        (id, execution_id, seq, start_ms, end_ms, state, confidence, event_match, quality_flags_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
      `pob_${executionId}_${observation.seq}`,
      executionId,
      observation.seq,
      observation.startMs,
      observation.endMs,
      observation.state,
      observation.confidence,
      observation.eventMatch ?? null,
      now,
    );
  }
  // The seeded execution is a fixed synthetic fixture. Re-seeding must replace
  // every timestamp-bound field, including the terms snapshot, or a later run
  // can leave the evaluation and agreement hash describing different terms.
  ctx.store.run(
    `UPDATE promise_executions SET agreement_hash = ?, terms_snapshot_json = ?,
       state = ?, payment_state = 'DEMO_MODE', demo = 1, observation_mode = 'REPLAY',
       outcome = ?, eligible_for_capture = ?, evaluation_json = ?, evaluation_hash = ?, evidence_root = ?,
       observed_ms = ?, run_ms = ?, idle_ms = ?, uncertain_ms = ?, failure_reason = ?, last_client_seq = ?,
       last_observed_ms = ?, created_at = ?, consented_at = ?, observation_started_at = ?,
       observation_stopped_at = ?, completed_at = ?, authorization_expires_at = NULL,
       paypal_order_id = NULL, paypal_approve_url = NULL, paypal_authorization_id = NULL,
       paypal_capture_id = NULL, paypal_void_id = NULL, provider_status = NULL,
       provider_reconciled_at = NULL, captured_minor = NULL, human_acceptance_json = NULL
     WHERE id = ?`,
    agreementHash,
    termsJson,
    state,
    evaluation.outcome,
    evaluation.eligibleForCapture ? 1 : 0,
    JSON.stringify(evaluation),
    hashCanonical(evaluation),
    evaluation.evidenceRoot,
    evaluation.observedMs,
    evaluation.runMs,
    evaluation.idleMs,
    evaluation.uncertainMs,
    evaluation.reason,
    observations.length,
    observations[observations.length - 1]!.endMs,
    now,
    now,
    now,
    now,
    now,
    executionId,
  );
  ctx.store.run('DELETE FROM promise_payment_operations WHERE execution_id = ?', executionId);
  if (existingProof) ctx.store.run('DELETE FROM promise_proofs WHERE id = ?', existingProof.id);
  await promiseProof(ctx, executionId, undefined, existingProof?.id);
}

export async function seedPromise(): Promise<{
  agreementId: string;
  eventModelId: string;
  termsHash: string;
  modelHash: string;
  modelStatus: string;
}> {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  try {
    const operator = store.get<{ id: string }>("SELECT id FROM users WHERE role = 'operator' ORDER BY created_at LIMIT 1");
    if (!operator) throw new Error('Run npm run setup first; the operator account is missing.');
    if (!store.get('SELECT id FROM objects WHERE id = ?', REFERENCE_OBJECT_ID)) {
      throw new Error('The reference object is missing. Run npm run setup first.');
    }
    if (!store.get('SELECT id FROM users WHERE id = ?', DEMO_RENTER_ID)) {
      store.run(
        'INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)',
        DEMO_RENTER_ID,
        'renter',
        'Judge replay visitor',
        REFERENCE_CREATED_AT,
      );
    }
    const data = generateReferenceData();
    const core = {
      idle: data.takes.filter((take) => take.label === 'idle').slice(0, 5),
      active: data.takes.filter((take) => take.label === 'active').slice(0, 5),
      negative: data.takes.filter((take) => take.label === 'negative').slice(0, 5),
    };
    const demonstrations: EventDemonstration[] = [];
    for (const [label, takes] of Object.entries(core) as Array<['idle' | 'active' | 'negative', typeof data.takes]>) {
      takes.forEach((take, index) => {
        demonstrations.push({
          id: `evd_ref_${label}_${String(index + 1).padStart(2, '0')}`,
          objectId: REFERENCE_OBJECT_ID,
          label,
          frames: take.frames,
          frameFlags: take.frameFlags,
          durationMs: take.durationMs ?? Math.round(take.frames.length * 32),
          featureSpecVersion: FEATURE_SPEC_VERSION,
          source: 'synthetic',
          provenance: 'SYNTHETIC_REFERENCE',
          sessionGroup: `syn-${label}-group-${index % 2}`,
          deviceLabel: 'Procedural reference dataset',
          notes: 'Synthetic demonstration used for the judge replay. Not a physical appliance recording.',
          createdAt: REFERENCE_CREATED_AT,
        });
      });
    }
    demonstrations.forEach((take, index) => upsertDemo(store, take, index));
    const trained = trainEventModel({
      takes: demonstrations,
      version: 'promise-ref-v1',
      createdAt: REFERENCE_CREATED_AT,
      featureSpecVersion: FEATURE_SPEC_VERSION,
      provenance: 'SYNTHETIC_REFERENCE',
    });
    if (trained.artifact.status !== 'READY') {
      throw new Error(
        `The synthetic promise event model did not pass its gate: ${trained.artifact.status}. ${trained.artifact.statusReasons.join(' ')}`,
      );
    }
    const modelHash = hashCanonical(trained.artifact);
    store.run(
      `INSERT INTO event_models
        (id, object_id, version, artifact_json, model_hash, status, dataset_hash, metrics_json, provenance, created_at, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC_REFERENCE', ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         artifact_json = excluded.artifact_json,
         model_hash = excluded.model_hash,
         status = excluded.status,
         dataset_hash = excluded.dataset_hash,
         metrics_json = excluded.metrics_json,
         created_at = excluded.created_at,
         superseded_at = NULL`,
      EVENT_MODEL_ID,
      REFERENCE_OBJECT_ID,
      trained.artifact.version,
      JSON.stringify(trained.artifact),
      modelHash,
      trained.artifact.status,
      trained.artifact.training.datasetHash,
      JSON.stringify(trained.artifact.metrics),
      REFERENCE_CREATED_AT,
    );
    store.run(
      'UPDATE event_models SET superseded_at = ? WHERE object_id = ? AND id <> ? AND superseded_at IS NULL',
      REFERENCE_CREATED_AT,
      REFERENCE_OBJECT_ID,
      EVENT_MODEL_ID,
    );
    const now = new Date();
    const compiled = compilePhysicalAgreement({
      text: 'Charge $2 for one complete cycle. The machine must run for at least 15 seconds and return to idle. Do not charge if it stops early or the microphone disconnects.',
      serviceName: 'One qualified fan cycle',
      objectId: REFERENCE_OBJECT_ID,
      objectName: 'Reference desk fan',
      currency: 'USD',
      eventModel: {
        id: EVENT_MODEL_ID,
        version: trained.artifact.version,
        hash: modelHash,
        status: 'READY',
        datasetHash: trained.artifact.training.datasetHash,
        provenance: 'SYNTHETIC_REFERENCE',
      },
      now: now.toISOString(),
      expiresInMinutes: 60,
    });
    if (!compiled.executable) {
      throw new Error(`The seeded promise is not executable: ${compiled.issues.map((issue) => issue.message).join(' ')}`);
    }
    store.run(
      `INSERT INTO promise_agreements
        (id, object_id, owner_id, event_model_id, event_model_hash, service_name, proposal_text, terms_json, terms_hash, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWNER_APPROVED', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         event_model_id = excluded.event_model_id,
         event_model_hash = excluded.event_model_hash,
         service_name = excluded.service_name,
         proposal_text = excluded.proposal_text,
         terms_json = excluded.terms_json,
         terms_hash = excluded.terms_hash,
         status = 'OWNER_APPROVED',
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
      AGREEMENT_ID,
      REFERENCE_OBJECT_ID,
      operator.id,
      EVENT_MODEL_ID,
      modelHash,
      compiled.terms.serviceName,
      compiled.proposal.text,
      JSON.stringify(compiled.terms),
      compiled.hash,
      compiled.terms.createdAt,
      compiled.terms.expiresAt,
    );
    const signer = await loadSigner(config.rootDir);
    const ctx: AppContext = {
      config,
      store,
      paypal: null,
      limiter: new RateLimiter(),
      signer,
      now: () => new Date(),
    };
    await seedSyntheticExecution(ctx, compiled.hash, JSON.stringify(compiled.terms), 'pex_reference_incomplete', 'incomplete');
    await seedSyntheticExecution(ctx, compiled.hash, JSON.stringify(compiled.terms), 'pex_reference_qualified', 'qualified');
    appendAudit(
      store,
      {
        actorType: 'system',
        actorId: 'promise-seed',
        action: 'promise.reference_seeded',
        subjectType: 'promise_agreement',
        subjectId: AGREEMENT_ID,
        metadata: {
          modelHash,
          termsHash: compiled.hash,
          provenance: 'SYNTHETIC_REFERENCE',
          warning: 'Synthetic demonstration only. Not a physical appliance field trial.',
        },
      },
      new Date(),
    );
    return {
      agreementId: AGREEMENT_ID,
      eventModelId: EVENT_MODEL_ID,
      termsHash: compiled.hash,
      modelHash,
      modelStatus: trained.artifact.status,
    };
  } finally {
    store.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  seedPromise()
    .then((result) => {
      console.log('Physical promise reference seeded.');
      console.log(`  agreement: ${result.agreementId}`);
      console.log(`  event model: ${result.eventModelId} (${result.modelStatus}, ${result.modelHash.slice(0, 16)}…)`);
      console.log(`  terms: ${result.termsHash.slice(0, 16)}…`);
      console.log('  provenance: SYNTHETIC_REFERENCE');
      console.log('  share: http://localhost:5173/promise/' + result.agreementId);
    })
    .catch((error) => {
      console.error(`Promise seed failed: ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
