import { pathToFileURL } from 'node:url';
import type { AppContext } from '../apps/api/src/context.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { Store } from '../apps/api/src/db/index.ts';
import { appendAudit } from '../apps/api/src/lib/audit.ts';
import { hashCanonical } from '../apps/api/src/lib/hash.ts';
import { shortRef } from '../apps/api/src/lib/hash.ts';
import { loadSigner } from '../apps/api/src/lib/signing.ts';
import { RateLimiter } from '../apps/api/src/lib/rate-limit.ts';
import { ambientProof } from '../apps/api/src/domain/ambient.ts';
import type {
  AmbientAgreementRow,
  AmbientOfferRow,
  AmbientSessionRow,
  EventModelRow,
  ObjectRow,
  UserRow,
} from '../apps/api/src/domain/rows.ts';
import {
  compileAmbientAgreement,
  evaluateAmbientAgreement,
  type AmbientAgreementTerms,
  type AmbientObservation,
} from '../packages/ambient-engine/src/index.ts';

export const AMBIENT_AGREEMENT_ID = 'amb_reference_window';
export const AMBIENT_BUYER_ID = 'usr_ambient_viewer';
export const AMBIENT_MODEL_ID = 'evm_promise_reference';
export const AMBIENT_INTERRUPTED_SESSION_ID = 'ase_reference_interrupted';
export const AMBIENT_QUALIFIED_SESSION_ID = 'ase_reference_qualified';

const AGREEMENT_TEXT =
  'I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00 for a continuous quiet window.';

function modelRef(row: EventModelRow): AmbientAgreementTerms['eventModel'] {
  if (row.status === 'REJECTED') {
    throw new Error('The reference event model was rejected; refusing to seed an unverifiable Ambient agreement.');
  }
  return {
    id: row.id,
    version: row.version,
    hash: row.model_hash,
    status: row.status,
    datasetHash: row.dataset_hash,
    provenance: row.provenance,
  };
}

function observation(
  seq: number,
  startMs: number,
  endMs: number,
  sourceState: AmbientObservation['sourceState'],
  confidence: number,
): AmbientObservation {
  return { seq, startMs, endMs, sourceState, confidence, qualityFlags: [] };
}

const INTERRUPTED_OBSERVATIONS: AmbientObservation[] = [
  observation(1, 0, 4_200, 'ACTIVE', 0.94),
  observation(2, 4_200, 10_000, 'INACTIVE', 0.93),
  observation(3, 10_000, 11_200, 'ACTIVE', 0.91),
  observation(4, 11_200, 24_000, 'INACTIVE', 0.93),
];

const QUALIFIED_OBSERVATIONS: AmbientObservation[] = [
  observation(1, 0, 4_200, 'ACTIVE', 0.94),
  observation(2, 4_200, 36_200, 'INACTIVE', 0.9),
];

async function seedSession(
  ctx: AppContext,
  agreement: AmbientAgreementRow,
  terms: AmbientAgreementTerms,
  input: {
    id: string;
    observations: AmbientObservation[];
    acceptResult: boolean;
    acceptedAt: string;
    startedAt: string;
  },
): Promise<void> {
  const createdAt = new Date(Date.parse(input.acceptedAt) - 30_000).toISOString();
  const startedAt = input.startedAt;
  const stoppedAt = new Date(Date.parse(startedAt) + input.observations.at(-1)!.endMs).toISOString();
  const evaluation = await evaluateAmbientAgreement({
    terms,
    agreementHash: agreement.terms_hash,
    observations: input.observations,
    currentModelHash: terms.eventModel.hash,
    now: stoppedAt,
  });
  const resultAcceptedAt = new Date(Date.parse(stoppedAt) + 2_000).toISOString();
  const acceptance = input.acceptResult
    ? {
        accepted: true,
        acceptedAt: resultAcceptedAt,
        note: 'The buyer reviewed the interval ledger and accepted the qualified window.',
        buyerRef: terms.parties.buyerRef,
      }
    : null;
  const state = input.acceptResult ? 'DEMO_COMPLETE' : 'NOT_QUALIFIED';
  const paymentState = 'DEMO_MODE';
  ctx.store.run(
    `INSERT INTO ambient_sessions
      (id, agreement_id, agreement_revision, agreement_hash, object_id, buyer_id, provider_id,
       terms_snapshot_json, state, payment_state, demo, observation_mode, created_at, accepted_at,
       authorized_at, observation_started_at, observation_stopped_at, authorization_expires_at,
       paypal_order_id, paypal_approve_url, paypal_authorization_id, paypal_capture_id, paypal_void_id,
       provider_status, provider_reconciled_at, captured_minor, outcome, eligible_for_capture,
       evaluation_json, evaluation_hash, evidence_root, acceptance_json, failure_reason,
       last_client_seq, last_observed_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'REPLAY', ?, ?, NULL, ?, ?, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    agreement.id,
    agreement.current_revision,
    agreement.terms_hash,
    agreement.object_id,
    agreement.buyer_id,
    agreement.provider_id,
    agreement.terms_json,
    state,
    paymentState,
    createdAt,
    input.acceptedAt,
    startedAt,
    stoppedAt,
    evaluation.outcome,
    evaluation.eligibleForCapture ? 1 : 0,
    JSON.stringify(evaluation),
    hashCanonical(evaluation),
    evaluation.evidenceRoot,
    acceptance ? JSON.stringify(acceptance) : null,
    input.acceptResult ? null : evaluation.reason,
    input.observations.length,
    input.observations.at(-1)!.endMs,
  );
  for (const interval of input.observations) {
    ctx.store.run(
      `INSERT INTO ambient_observations
        (id, session_id, seq, start_ms, end_ms, source_state, confidence, event_match, quality_flags_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?)`,
      `aob_${input.id}_${interval.seq}`,
      input.id,
      interval.seq,
      interval.startMs,
      interval.endMs,
      interval.sourceState,
      interval.confidence,
      stoppedAt,
    );
  }
  await ambientProof(ctx, input.id);
}

export async function seedAmbient(): Promise<{
  agreementId: string;
  interruptedSessionId: string;
  qualifiedSessionId: string;
  termsHash: string;
  modelHash: string;
}> {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  try {
    const object = store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', 'obj_reference_fan');
    if (!object) throw new Error('Run npm run setup first; the reference object is missing.');
    const provider = store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
    if (!provider || provider.role !== 'operator') {
      throw new Error('Run npm run setup first; the reference operator is missing.');
    }
    const model = store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', AMBIENT_MODEL_ID);
    if (!model) {
      throw new Error('The reference event model is missing. Run npm run setup to seed the Physical Promise reference first.');
    }
    if (!store.get('SELECT id FROM users WHERE id = ?', AMBIENT_BUYER_ID)) {
      store.run(
        'INSERT INTO users (id, role, display_name, created_at) VALUES (?, ?, ?, ?)',
        AMBIENT_BUYER_ID,
        'renter',
        'Ambient judge visitor',
        ctxNowIso(),
      );
    }

    const now = ctxNowIso();
    const compiled = compileAmbientAgreement({
      agreementId: AMBIENT_AGREEMENT_ID,
      revision: 1,
      text: AGREEMENT_TEXT,
      buyerRef: shortRef('buyer', AMBIENT_BUYER_ID),
      providerRef: shortRef('provider', provider.id),
      target: { objectId: object.id, objectName: object.name, glyph: object.glyph },
      eventModel: modelRef(model),
      currency: 'USD',
      fixedPriceMinor: 200,
      durationSeconds: 30,
      now,
      expiresInMinutes: 60 * 24 * 7,
      authorizationExpiryMinutes: 60,
    });
    if (!compiled.executable) {
      throw new Error(`The seeded Ambient agreement is not executable: ${compiled.issues.map((issue) => issue.message).join(' ')}`);
    }
    const terms = compiled.terms;
    const providerAcceptedAt = new Date(Date.parse(now) + 30_000).toISOString();
    const buyerAcceptedAt = new Date(Date.parse(now) + 60_000).toISOString();
    const interruptedStartAt = new Date(Date.parse(now) + 120_000).toISOString();
    const qualifiedStartAt = new Date(Date.parse(now) + 180_000).toISOString();

    store.run('DELETE FROM ambient_proofs WHERE session_id IN (?, ?)', AMBIENT_INTERRUPTED_SESSION_ID, AMBIENT_QUALIFIED_SESSION_ID);
    store.run('DELETE FROM ambient_payment_operations WHERE session_id IN (?, ?)', AMBIENT_INTERRUPTED_SESSION_ID, AMBIENT_QUALIFIED_SESSION_ID);
    store.run('DELETE FROM ambient_observations WHERE session_id IN (?, ?)', AMBIENT_INTERRUPTED_SESSION_ID, AMBIENT_QUALIFIED_SESSION_ID);
    store.run('DELETE FROM ambient_sessions WHERE agreement_id = ?', AMBIENT_AGREEMENT_ID);
    store.run('DELETE FROM ambient_offers WHERE agreement_id = ?', AMBIENT_AGREEMENT_ID);
    store.run('DELETE FROM ambient_agreements WHERE id = ?', AMBIENT_AGREEMENT_ID);

    store.run(
      `INSERT INTO ambient_agreements
        (id, buyer_id, provider_id, object_id, event_model_id, status, current_revision,
         terms_json, terms_hash, offer_expires_at, created_at, updated_at, buyer_accepted_at, provider_accepted_at)
       VALUES (?, ?, ?, ?, ?, 'ACCEPTED', 1, ?, ?, ?, ?, ?, ?, ?)`,
      AMBIENT_AGREEMENT_ID,
      AMBIENT_BUYER_ID,
      provider.id,
      object.id,
      model.id,
      JSON.stringify(terms),
      compiled.hash,
      terms.expiresAt,
      now,
      buyerAcceptedAt,
      buyerAcceptedAt,
      providerAcceptedAt,
    );
    store.run(
      `INSERT INTO ambient_offers
        (id, agreement_id, revision, terms_json, terms_hash, proposed_by, price_minor, duration_ms,
         status, note, created_at, decided_at)
       VALUES (?, ?, 1, ?, ?, 'BUYER', ?, ?, 'ACCEPTED', ?, ?, ?)`,
      'aof_reference_window_1',
      AMBIENT_AGREEMENT_ID,
      JSON.stringify(terms),
      compiled.hash,
      terms.financial.fixedPriceMinor,
      terms.condition.requiredInactiveMs,
      'Accepted at the original duration and price. The provider did not counter.',
      now,
      providerAcceptedAt,
    );

    const agreement: AmbientAgreementRow = {
      id: AMBIENT_AGREEMENT_ID,
      buyer_id: AMBIENT_BUYER_ID,
      provider_id: provider.id,
      object_id: object.id,
      event_model_id: model.id,
      status: 'ACCEPTED',
      current_revision: 1,
      terms_json: JSON.stringify(terms),
      terms_hash: compiled.hash,
      offer_expires_at: terms.expiresAt,
      created_at: now,
      updated_at: buyerAcceptedAt,
      buyer_accepted_at: buyerAcceptedAt,
      provider_accepted_at: providerAcceptedAt,
      rejected_at: null,
      rejected_by: null,
    };

    const signer = await loadSigner(config.rootDir);
    const ctx: AppContext = {
      config,
      store,
      paypal: null,
      limiter: new RateLimiter(),
      signer,
      now: () => new Date(),
    };

    await seedSession(ctx, agreement, terms, {
      id: AMBIENT_INTERRUPTED_SESSION_ID,
      observations: INTERRUPTED_OBSERVATIONS,
      acceptResult: false,
      acceptedAt: buyerAcceptedAt,
      startedAt: interruptedStartAt,
    });
    if (ctxNowIso() >= terms.expiresAt) {
      throw new Error('The seeded Ambient terms expired while seeding. Re-run setup.');
    }
    await seedSession(ctx, agreement, terms, {
      id: AMBIENT_QUALIFIED_SESSION_ID,
      observations: QUALIFIED_OBSERVATIONS,
      acceptResult: true,
      acceptedAt: buyerAcceptedAt,
      startedAt: qualifiedStartAt,
    });

    appendAudit(
      store,
      {
        actorType: 'system',
        actorId: 'ambient-seed',
        action: 'ambient.reference_seeded',
        subjectType: 'ambient_agreement',
        subjectId: AMBIENT_AGREEMENT_ID,
        metadata: {
          modelHash: model.model_hash,
          termsHash: compiled.hash,
          interruptedSessionId: AMBIENT_INTERRUPTED_SESSION_ID,
          qualifiedSessionId: AMBIENT_QUALIFIED_SESSION_ID,
          provenance: 'SYNTHETIC_REFERENCE',
          warning: 'Synthetic interval ledger only. Not a physical appliance field trial and not a PayPal transaction.',
        },
      },
      new Date(),
    );

    return {
      agreementId: AMBIENT_AGREEMENT_ID,
      interruptedSessionId: AMBIENT_INTERRUPTED_SESSION_ID,
      qualifiedSessionId: AMBIENT_QUALIFIED_SESSION_ID,
      termsHash: compiled.hash,
      modelHash: model.model_hash,
    };
  } finally {
    store.close();
  }
}

function ctxNowIso(): string {
  return new Date().toISOString();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  seedAmbient()
    .then((result) => {
      console.log('Ambient Quiet Window reference seeded.');
      console.log(`  agreement: ${result.agreementId}`);
      console.log(`  interrupted: ${result.interruptedSessionId}`);
      console.log(`  qualified: ${result.qualifiedSessionId}`);
      console.log(`  terms: ${result.termsHash.slice(0, 16)}…`);
      console.log(`  model: ${result.modelHash.slice(0, 16)}…`);
      console.log('  provenance: SYNTHETIC_REFERENCE — no payment, no physical field trial');
      console.log(`  judge: http://localhost:5173/ambient/judge`);
    })
    .catch((error) => {
      console.error(`Ambient seed failed: ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
