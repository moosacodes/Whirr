import type { Actor, AppContext } from '../context.ts';
import type {
  AmbientAgreementRow,
  AmbientOfferRow,
  AmbientObservationRow,
  AmbientPaymentOperationRow,
  AmbientProofRow,
  AmbientSessionRow,
  EventModelRow,
  ObjectRow,
  UserRow,
} from './rows.ts';
import { newId, providerRequestId } from '../lib/ids.ts';
import { appendAudit } from '../lib/audit.ts';
import { errors, AppError } from '../lib/errors.ts';
import { hashCanonical, shortRef } from '../lib/hash.ts';
import { formatMinor, decimalStringToMinor, type Currency } from '../../../../packages/meter/src/currency.ts';
import {
  compileAmbientAgreement,
  evaluateAmbientAgreement,
  hashAmbientTerms,
  validateAmbientTermsShape,
  type AmbientAgreementStatus,
  type AmbientAgreementTerms,
  type AmbientCompilationIssue,
  type AmbientEvaluation,
  type AmbientInterpretation,
  type AmbientModelRef,
  type AmbientObservation,
  type AmbientOutcome,
  type CompiledAmbientAgreement,
} from '../../../../packages/ambient-engine/src/index.ts';
import type { EventModelArtifact } from '../../../../packages/audio/src/event-model.ts';
import {
  PayPalApiError,
  extractAuthorization,
  type PayPalCapture,
} from '../../../../packages/paypal/src/client.ts';
import type {
  AmbientAgreementView,
  AmbientCatalogItem,
  AmbientCatalogView,
  AmbientJudgeView,
  AmbientModelSummaryView,
  AmbientObjectView,
  AmbientOfferView,
  AmbientProofView,
  AmbientSourceView,
  AmbientSessionSummary,
  AmbientSessionView,
} from '../../../../packages/contracts/src/types.ts';
import type {
  AmbientProofPayload,
  AmbientProofPayment,
} from '../../../../packages/protocol/src/ambient-proof.ts';
import { verifyAmbientProofDocument } from '../../../../packages/verify/src/ambient.ts';

const DEMO_AGREEMENT_ID = 'amb_reference_window';
const DEMO_BUYER_ID = 'usr_ambient_viewer';
const REFERENCE_OBJECT_ID = 'obj_reference_fan';
const OFFER_TTL_MINUTES = 45;

function requireAmbientObject(ctx: AppContext, objectId: string): ObjectRow {
  const row = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', objectId);
  if (!row) throw errors.notFound('Object not found.');
  if (row.status !== 'ACTIVE') throw errors.conflict('OBJECT_REVOKED', 'This object is no longer active.');
  return row;
}

function objectView(ctx: AppContext, object: ObjectRow): AmbientObjectView {
  const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  return {
    objectId: object.id,
    objectName: object.name,
    glyph: object.glyph,
    description: object.description,
    ownerLabel: owner?.display_name ?? 'Whirr operator',
  };
}

function modelRowForAgreement(ctx: AppContext, agreement: AmbientAgreementRow): EventModelRow {
  const row = ctx.store.get<EventModelRow>('SELECT * FROM event_models WHERE id = ?', agreement.event_model_id);
  if (!row) throw errors.internal('Ambient agreement model is missing.');
  return row;
}

function modelSummary(row: EventModelRow): AmbientModelSummaryView {
  const artifact = JSON.parse(row.artifact_json) as EventModelArtifact;
  return {
    id: row.id,
    version: row.version,
    hash: row.model_hash,
    status: row.status === 'READY' ? 'READY' : 'LIMITED',
    provenance: row.provenance,
    datasetHash: row.dataset_hash,
    takeCount: artifact.training.takeCount,
    frameCount: artifact.training.frameCount,
    groupCount: artifact.training.groupCount,
    macroRecall: artifact.metrics.macroRecall,
    unknownRate: artifact.metrics.unknownRate,
    limitations: artifact.limitations,
  };
}

function modelRef(row: EventModelRow): AmbientModelRef {
  return {
    id: row.id,
    version: row.version,
    hash: row.model_hash,
    status: row.status === 'READY' ? 'READY' : 'LIMITED',
    datasetHash: row.dataset_hash,
    provenance: row.provenance,
  };
}

function latestModelRow(ctx: AppContext, objectId: string): EventModelRow | null {
  return (
    ctx.store.get<EventModelRow>(
      'SELECT * FROM event_models WHERE object_id = ? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1',
      objectId,
    ) ?? null
  );
}

function sourcePublication(
  ctx: AppContext,
  object: ObjectRow,
): AmbientSourceView['publishedVia'] | null {
  if (object.active_terms_id) return 'PUBLISHED_TERMS';
  const promise = ctx.store.get<{ id: string }>(
    "SELECT id FROM promise_agreements WHERE object_id = ? AND status = 'OWNER_APPROVED' LIMIT 1",
    object.id,
  );
  return promise ? 'PUBLISHED_PROMISE' : null;
}

function ambientSourceForObject(ctx: AppContext, object: ObjectRow): AmbientSourceView | null {
  if (object.status !== 'ACTIVE') return null;
  const publishedVia = sourcePublication(ctx, object);
  if (!publishedVia) return null;
  const model = latestModelRow(ctx, object.id);
  if (!model || model.status !== 'READY') return null;
  const provider = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  if (!provider || provider.role !== 'operator') return null;
  return {
    target: objectView(ctx, object),
    model: modelSummary(model),
    publishedVia,
  };
}

function requireAmbientSource(
  ctx: AppContext,
  objectId: string,
): { object: ObjectRow; model: EventModelRow; provider: UserRow; source: AmbientSourceView } {
  const object = requireAmbientObject(ctx, objectId);
  const source = ambientSourceForObject(ctx, object);
  if (!source) {
    throw errors.conflict(
      'SOURCE_NOT_READY',
      'This object is not a published Ambient source with a current READY event model.',
    );
  }
  const model = latestModelRow(ctx, object.id);
  const provider = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
  if (!model || !provider) throw errors.internal('The published Ambient source is incomplete.');
  return { object, model, provider, source };
}

function agreementRow(ctx: AppContext, id: string): AmbientAgreementRow {
  const row = ctx.store.get<AmbientAgreementRow>('SELECT * FROM ambient_agreements WHERE id = ?', id);
  if (!row) throw errors.notFound('Ambient agreement not found.');
  return row;
}

function sessionRow(ctx: AppContext, id: string): AmbientSessionRow {
  const row = ctx.store.get<AmbientSessionRow>('SELECT * FROM ambient_sessions WHERE id = ?', id);
  if (!row) throw errors.notFound('Ambient session not found.');
  return row;
}

function agreementTerms(row: AmbientAgreementRow): AmbientAgreementTerms {
  const terms = JSON.parse(row.terms_json) as AmbientAgreementTerms;
  if (!validateAmbientTermsShape(terms)) throw errors.internal('Stored Ambient terms are malformed.');
  return terms;
}

function sessionTerms(row: AmbientSessionRow): AmbientAgreementTerms {
  const terms = JSON.parse(row.terms_snapshot_json) as AmbientAgreementTerms;
  if (!validateAmbientTermsShape(terms)) throw errors.internal('Stored Ambient session terms are malformed.');
  return terms;
}

function offerRows(ctx: AppContext, agreementId: string): AmbientOfferRow[] {
  return ctx.store.all<AmbientOfferRow>(
    'SELECT * FROM ambient_offers WHERE agreement_id = ? ORDER BY revision DESC',
    agreementId,
  );
}

function currentOffer(ctx: AppContext, agreement: AmbientAgreementRow): AmbientOfferRow | null {
  return (
    ctx.store.get<AmbientOfferRow>(
      'SELECT * FROM ambient_offers WHERE agreement_id = ? AND revision = ?',
      agreement.id,
      agreement.current_revision,
    ) ?? null
  );
}

function offerView(row: AmbientOfferRow): AmbientOfferView {
  return {
    id: row.id,
    revision: row.revision,
    terms: JSON.parse(row.terms_json) as AmbientAgreementTerms,
    termsHash: row.terms_hash,
    proposedBy: row.proposed_by,
    priceMinor: row.price_minor,
    durationMs: row.duration_ms,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function sessionSummary(row: AmbientSessionRow): AmbientSessionSummary {
  return {
    id: row.id,
    state: row.state,
    demo: Boolean(row.demo),
    outcome: row.outcome,
    eligibleForCapture: Boolean(row.eligible_for_capture),
    capturedMinor: row.captured_minor,
    createdAt: row.created_at,
    stoppedAt: row.observation_stopped_at,
  };
}

function latestSession(ctx: AppContext, agreementId: string): AmbientSessionRow | null {
  return (
    ctx.store.get<AmbientSessionRow>(
      'SELECT * FROM ambient_sessions WHERE agreement_id = ? ORDER BY created_at DESC LIMIT 1',
      agreementId,
    ) ?? null
  );
}

function expireAgreementIfNeeded(ctx: AppContext, row: AmbientAgreementRow): AmbientAgreementRow {
  if (
    ['OFFERED', 'COUNTERED', 'PROVIDER_ACCEPTED'].includes(row.status) &&
    Date.parse(row.offer_expires_at) <= ctx.now().getTime()
  ) {
    ctx.store.run(
      "UPDATE ambient_agreements SET status = 'EXPIRED', updated_at = ? WHERE id = ?",
      ctx.now().toISOString(),
      row.id,
    );
    const offer = currentOffer(ctx, row);
    if (offer) {
      ctx.store.run(
        "UPDATE ambient_offers SET status = 'EXPIRED', decided_at = ? WHERE id = ?",
        ctx.now().toISOString(),
        offer.id,
      );
    }
    return agreementRow(ctx, row.id);
  }
  return row;
}

export function ambientAgreementView(
  ctx: AppContext,
  idOrRow: string | AmbientAgreementRow,
  actor?: Actor,
): AmbientAgreementView {
  let row = typeof idOrRow === 'string' ? agreementRow(ctx, idOrRow) : idOrRow;
  row = expireAgreementIfNeeded(ctx, row);
  const terms = agreementTerms(row);
  const object = requireAmbientObject(ctx, row.object_id);
  const model = modelRowForAgreement(ctx, row);
  const offers = offerRows(ctx, row.id).map(offerView);
  const offer = currentOffer(ctx, row);
  const session = latestSession(ctx, row.id);
  const buyer = actor?.type === 'renter' && actor.id === row.buyer_id;
  const provider = actor?.type === 'operator' && actor.id === row.provider_id;
  const offerExpired = Date.parse(row.offer_expires_at) <= ctx.now().getTime();
  const canMakeOffer = buyer && row.status === 'DRAFT' && !offerExpired;
  return {
    id: row.id,
    status: row.status,
    revision: row.current_revision,
    serviceName: terms.serviceName,
    target: objectView(ctx, object),
    terms,
    termsHash: row.terms_hash,
    interpretation: terms.interpretation,
    model: modelSummary(model),
    offers,
    currentOffer: offer ? offerView(offer) : null,
    buyerRef: terms.parties.buyerRef,
    providerRef: terms.parties.providerRef,
    roles: { buyer, provider },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    offerExpiresAt: row.offer_expires_at,
    offerExpired,
    buyerAcceptedAt: row.buyer_accepted_at,
    providerAcceptedAt: row.provider_accepted_at,
    financial: {
      currency: terms.financial.currency,
      fixedPriceMinor: terms.financial.fixedPriceMinor,
      maximumChargeMinor: terms.financial.maximumChargeMinor,
      displayPrice: formatMinor(terms.financial.fixedPriceMinor, terms.financial.currency),
      displayMaximum: formatMinor(terms.financial.maximumChargeMinor, terms.financial.currency),
    },
    latestSession: session ? sessionSummary(session) : null,
    flags: {
      canMakeOffer,
      canRespond: provider && row.status === 'OFFERED' && !offerExpired,
      canBuyerDecide:
        buyer && ['PROVIDER_ACCEPTED', 'COUNTERED'].includes(row.status) && !offerExpired,
      canWithdraw: buyer && ['OFFERED', 'COUNTERED', 'PROVIDER_ACCEPTED'].includes(row.status),
      canOpenSession: buyer && row.status === 'ACCEPTED' && !session,
      awaitingBuyer:
        row.status === 'PROVIDER_ACCEPTED' ||
        row.status === 'COUNTERED' ||
        (row.status === 'ACCEPTED' && !session),
      awaitingProvider: row.status === 'OFFERED',
    },
    limitations: terms.interpretation.limitations,
    sandbox: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
  };
}

export function compileAmbientWish(
  ctx: AppContext,
  renter: UserRow,
  input: {
    objectId: string;
    text: string;
    durationSeconds: number;
    fixedPriceMinor: number;
    currency: Currency;
  },
): CompiledAmbientAgreement {
  const { object, model, provider } = requireAmbientSource(ctx, input.objectId);
  return compileAmbientAgreement({
    agreementId: newId('amb'),
    revision: 1,
    text: input.text,
    buyerRef: shortRef('buyer', renter.id),
    providerRef: shortRef('provider', provider.id),
    target: { objectId: object.id, objectName: object.name, glyph: object.glyph },
    eventModel: modelRef(model),
    currency: input.currency,
    fixedPriceMinor: input.fixedPriceMinor,
    durationSeconds: input.durationSeconds,
    now: ctx.now().toISOString(),
    expiresInMinutes: OFFER_TTL_MINUTES,
  });
}

export function createAmbientAgreement(
  ctx: AppContext,
  renter: UserRow,
  input: { terms: unknown; termsHash: string; approved: true },
): AmbientAgreementView {
  if (!validateAmbientTermsShape(input.terms)) {
    throw errors.badRequest('The reviewed Ambient terms are malformed.');
  }
  const terms = input.terms;
  if (hashAmbientTerms(terms) !== input.termsHash) {
    throw errors.conflict('TERMS_CHANGED', 'The reviewed terms changed. Read the interpretation again before offering.');
  }
  const { object, model, provider } = requireAmbientSource(ctx, terms.target.objectId);
  if (
    model.id !== terms.eventModel.id ||
    model.model_hash !== terms.eventModel.hash ||
    model.dataset_hash !== terms.eventModel.datasetHash
  ) {
    throw errors.conflict('MODEL_CHANGED', 'The object model changed after review. Compile the wish again.');
  }
  if (terms.parties.buyerRef !== shortRef('buyer', renter.id)) {
    throw errors.forbidden('The reviewed buyer does not match this session.');
  }
  if (terms.parties.providerRef !== shortRef('provider', provider.id)) {
    throw errors.forbidden('The reviewed provider does not own this object.');
  }
  if (ctx.store.get('SELECT id FROM ambient_agreements WHERE id = ?', terms.agreementId)) {
    throw errors.conflict('AGREEMENT_EXISTS', 'This reviewed agreement has already been offered.');
  }
  if (!terms.interpretation.supported) {
    throw errors.badRequest('The reviewed condition is not executable.');
  }
  const now = ctx.now().toISOString();
  const offerExpiresAt = new Date(ctx.now().getTime() + OFFER_TTL_MINUTES * 60_000).toISOString();
  const offerId = newId('aof');
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO ambient_agreements
        (id, buyer_id, provider_id, object_id, event_model_id, status, current_revision,
         terms_json, terms_hash, offer_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'OFFERED', 1, ?, ?, ?, ?, ?)`,
      terms.agreementId,
      renter.id,
      provider.id,
      object.id,
      terms.eventModel.id,
      JSON.stringify(terms),
      input.termsHash,
      offerExpiresAt,
      now,
      now,
    );
    ctx.store.run(
      `INSERT INTO ambient_offers
        (id, agreement_id, revision, terms_json, terms_hash, proposed_by, price_minor, duration_ms,
         status, note, created_at, decided_at)
       VALUES (?, ?, 1, ?, ?, 'BUYER', ?, ?, 'OFFERED', NULL, ?, NULL)`,
      offerId,
      terms.agreementId,
      JSON.stringify(terms),
      input.termsHash,
      terms.financial.fixedPriceMinor,
      terms.condition.requiredInactiveMs,
      now,
    );
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: 'ambient.offer_created',
      subjectType: 'ambient_agreement',
      subjectId: terms.agreementId,
      metadata: {
        termsHash: input.termsHash,
        objectId: object.id,
        priceMinor: terms.financial.fixedPriceMinor,
        durationMs: terms.condition.requiredInactiveMs,
      },
    },
    ctx.now(),
  );
  return ambientAgreementView(ctx, terms.agreementId, { type: 'renter', id: renter.id });
}

export function withdrawAmbientAgreement(
  ctx: AppContext,
  renter: UserRow,
  agreementId: string,
): AmbientAgreementView {
  const row = expireAgreementIfNeeded(ctx, agreementRow(ctx, agreementId));
  if (row.buyer_id !== renter.id) throw errors.notFound('Agreement not found.');
  if (!['OFFERED', 'COUNTERED', 'PROVIDER_ACCEPTED'].includes(row.status)) {
    throw errors.conflict('INVALID_STATE', 'This offer can no longer be withdrawn.');
  }
  const offer = currentOffer(ctx, row);
  ctx.store.transaction(() => {
    ctx.store.run(
      "UPDATE ambient_agreements SET status = 'WITHDRAWN', updated_at = ? WHERE id = ?",
      ctx.now().toISOString(),
      row.id,
    );
    if (offer) {
      ctx.store.run(
        "UPDATE ambient_offers SET status = 'WITHDRAWN', decided_at = ? WHERE id = ?",
        ctx.now().toISOString(),
        offer.id,
      );
    }
  });
  return ambientAgreementView(ctx, row.id, { type: 'renter', id: renter.id });
}

export function respondToAmbientOffer(
  ctx: AppContext,
  operator: UserRow,
  agreementId: string,
  input: {
    action: 'ACCEPT' | 'COUNTER' | 'REJECT';
    termsHash: string;
    priceMinor?: number;
    durationSeconds?: number;
    note?: string | null;
  },
): AmbientAgreementView {
  let row = expireAgreementIfNeeded(ctx, agreementRow(ctx, agreementId));
  if (row.provider_id !== operator.id) throw errors.notFound('Agreement not found.');
  if (row.status !== 'OFFERED') throw errors.conflict('INVALID_STATE', 'There is no open buyer offer to answer.');
  if (row.terms_hash !== input.termsHash) throw errors.conflict('TERMS_CHANGED', 'The offer changed before it was answered.');
  const offer = currentOffer(ctx, row);
  if (!offer) throw errors.internal('Open Ambient offer is missing.');
  const now = ctx.now().toISOString();
  if (input.action === 'REJECT') {
    ctx.store.transaction(() => {
      ctx.store.run(
        "UPDATE ambient_offers SET status = 'REJECTED', decided_at = ? WHERE id = ?",
        now,
        offer.id,
      );
      ctx.store.run(
        "UPDATE ambient_agreements SET status = 'REJECTED', rejected_at = ?, rejected_by = 'PROVIDER', updated_at = ? WHERE id = ?",
        now,
        now,
        row.id,
      );
    });
    return ambientAgreementView(ctx, row.id, { type: 'operator', id: operator.id });
  }
  if (input.action === 'ACCEPT') {
    ctx.store.transaction(() => {
      ctx.store.run(
        "UPDATE ambient_offers SET status = 'ACCEPTED', decided_at = ? WHERE id = ?",
        now,
        offer.id,
      );
      ctx.store.run(
        "UPDATE ambient_agreements SET status = 'PROVIDER_ACCEPTED', provider_accepted_at = ?, updated_at = ? WHERE id = ?",
        now,
        now,
        row.id,
      );
    });
    appendAudit(
      ctx.store,
      {
        actorType: 'operator',
        actorId: operator.id,
        action: 'ambient.provider_accepted',
        subjectType: 'ambient_agreement',
        subjectId: row.id,
        metadata: { termsHash: row.terms_hash },
      },
      ctx.now(),
    );
    return ambientAgreementView(ctx, row.id, { type: 'operator', id: operator.id });
  }

  const current = agreementTerms(row);
  if (input.priceMinor === undefined && input.durationSeconds === undefined) {
    throw errors.badRequest('A counteroffer must change the price, the duration, or both.');
  }
  const priceMinor = input.priceMinor ?? current.financial.fixedPriceMinor;
  const durationSeconds = input.durationSeconds ?? Math.round(current.condition.requiredInactiveMs / 1000);
  if (priceMinor === current.financial.fixedPriceMinor && durationSeconds === current.condition.requiredInactiveMs / 1000) {
    throw errors.badRequest('A counteroffer must change at least one term.');
  }
  const provider = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', operator.id);
  if (!provider) throw errors.internal('Provider account is missing.');
  const compiled = compileAmbientAgreement({
    agreementId: row.id,
    revision: row.current_revision + 1,
    text: current.interpretation.requestedText,
    buyerRef: current.parties.buyerRef,
    providerRef: current.parties.providerRef,
    target: current.target,
    eventModel: current.eventModel,
    currency: current.financial.currency,
    fixedPriceMinor: priceMinor,
    durationSeconds,
    preferExplicitTerms: true,
    now,
    expiresInMinutes: OFFER_TTL_MINUTES,
  });
  if (!compiled.executable) {
    throw errors.badRequest('The counteroffer is not executable.', compiled.issues);
  }
  const offerExpiresAt = compiled.terms.expiresAt;
  const newOfferId = newId('aof');
  const providerNote = input.note?.trim() || null;
  ctx.store.transaction(() => {
    ctx.store.run(
      "UPDATE ambient_offers SET status = 'SUPERSEDED', decided_at = ? WHERE id = ?",
      now,
      offer.id,
    );
    ctx.store.run(
      `INSERT INTO ambient_offers
        (id, agreement_id, revision, terms_json, terms_hash, proposed_by, price_minor, duration_ms,
         status, note, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, 'PROVIDER', ?, ?, 'COUNTERED', ?, ?, ?)`,
      newOfferId,
      row.id,
      compiled.terms.revision,
      JSON.stringify(compiled.terms),
      compiled.hash,
      compiled.terms.financial.fixedPriceMinor,
      compiled.terms.condition.requiredInactiveMs,
      providerNote,
      now,
      now,
    );
    ctx.store.run(
      `UPDATE ambient_agreements
       SET status = 'COUNTERED', current_revision = ?, terms_json = ?, terms_hash = ?,
           offer_expires_at = ?, provider_accepted_at = ?, updated_at = ?
       WHERE id = ?`,
      compiled.terms.revision,
      JSON.stringify(compiled.terms),
      compiled.hash,
      offerExpiresAt,
      now,
      now,
      row.id,
    );
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'operator',
      actorId: operator.id,
      action: 'ambient.provider_countered',
      subjectType: 'ambient_agreement',
      subjectId: row.id,
      metadata: {
        revision: compiled.terms.revision,
        termsHash: compiled.hash,
        priceMinor: compiled.terms.financial.fixedPriceMinor,
        durationMs: compiled.terms.condition.requiredInactiveMs,
      },
    },
    ctx.now(),
  );
  return ambientAgreementView(ctx, row.id, { type: 'operator', id: operator.id });
}

export function buyerDecideAmbientOffer(
  ctx: AppContext,
  renter: UserRow,
  agreementId: string,
  input: { action: 'ACCEPT' | 'REJECT'; termsHash: string },
): AmbientAgreementView {
  const row = expireAgreementIfNeeded(ctx, agreementRow(ctx, agreementId));
  if (row.buyer_id !== renter.id) throw errors.notFound('Agreement not found.');
  if (!['PROVIDER_ACCEPTED', 'COUNTERED'].includes(row.status)) {
    throw errors.conflict('INVALID_STATE', 'There is no provider response awaiting your decision.');
  }
  if (row.terms_hash !== input.termsHash) {
    throw errors.conflict('TERMS_CHANGED', 'The terms changed. Review the exact final offer again.');
  }
  const offer = currentOffer(ctx, row);
  if (!offer) throw errors.internal('Open Ambient offer is missing.');
  const now = ctx.now().toISOString();
  if (input.action === 'REJECT') {
    ctx.store.transaction(() => {
      ctx.store.run("UPDATE ambient_offers SET status = 'REJECTED', decided_at = ? WHERE id = ?", now, offer.id);
      ctx.store.run(
        "UPDATE ambient_agreements SET status = 'REJECTED', rejected_at = ?, rejected_by = 'BUYER', updated_at = ? WHERE id = ?",
        now,
        now,
        row.id,
      );
    });
    return ambientAgreementView(ctx, row.id, { type: 'renter', id: renter.id });
  }
  ctx.store.transaction(() => {
    ctx.store.run("UPDATE ambient_offers SET status = 'ACCEPTED', decided_at = ? WHERE id = ?", now, offer.id);
    ctx.store.run(
      "UPDATE ambient_agreements SET status = 'ACCEPTED', buyer_accepted_at = ?, provider_accepted_at = COALESCE(provider_accepted_at, ?), updated_at = ? WHERE id = ?",
      now,
      now,
      now,
      row.id,
    );
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: 'ambient.buyer_accepted',
      subjectType: 'ambient_agreement',
      subjectId: row.id,
      metadata: { termsHash: row.terms_hash, revision: row.current_revision },
    },
    ctx.now(),
  );
  return ambientAgreementView(ctx, row.id, { type: 'renter', id: renter.id });
}

function demoReplayObservations(terms: AmbientAgreementTerms): AmbientObservation[] {
  const baselineEnd = terms.condition.requiredBaselineActiveMs + 1_200;
  const inactiveEnd = baselineEnd + terms.condition.requiredInactiveMs + 4_000;
  return [
    {
      seq: 1,
      startMs: 0,
      endMs: baselineEnd,
      sourceState: 'ACTIVE',
      confidence: 0.94,
      qualityFlags: [],
    },
    {
      seq: 2,
      startMs: baselineEnd,
      endMs: inactiveEnd,
      sourceState: 'INACTIVE',
      confidence: 0.9,
      qualityFlags: [],
    },
  ];
}

export function createAmbientSession(
  ctx: AppContext,
  renter: UserRow,
  agreementId: string,
  input: { demo: boolean; observationMode: 'LIVE' | 'REPLAY' },
): AmbientSessionView {
  const agreement = expireAgreementIfNeeded(ctx, agreementRow(ctx, agreementId));
  if (agreement.buyer_id !== renter.id) throw errors.notFound('Agreement not found.');
  if (agreement.status !== 'ACCEPTED') throw errors.conflict('NOT_ACCEPTED', 'Both parties must accept the exact terms first.');
  if (!input.demo && !ctx.paypal) {
    throw errors.unavailable('PayPal Sandbox is not configured. Use the labelled demo window or configure Sandbox credentials.');
  }
  const existing = latestSession(ctx, agreement.id);
  if (existing) return ambientSessionView(ctx, existing.id, { type: 'renter', id: renter.id });
  const terms = agreementTerms(agreement);
  const now = ctx.now().toISOString();
  const id = newId('ase');
  const autoReplay = input.demo && input.observationMode === 'REPLAY';
  const replay = autoReplay ? demoReplayObservations(terms) : [];
  const replayEndMs = replay.at(-1)?.endMs ?? 0;
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO ambient_sessions
        (id, agreement_id, agreement_revision, agreement_hash, object_id, buyer_id, provider_id,
         terms_snapshot_json, state, payment_state, demo, observation_mode, created_at, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      agreement.id,
      agreement.current_revision,
      agreement.terms_hash,
      agreement.object_id,
      agreement.buyer_id,
      agreement.provider_id,
      agreement.terms_json,
      autoReplay ? 'OBSERVING' : input.demo ? 'AUTHORIZED' : 'PAYMENT_PENDING',
      input.demo ? 'DEMO_MODE' : 'NONE',
      input.demo ? 1 : 0,
      input.observationMode,
      now,
      agreement.buyer_accepted_at ?? now,
    );
    if (autoReplay) {
      for (const interval of replay) {
        ctx.store.run(
          `INSERT INTO ambient_observations
            (id, session_id, seq, start_ms, end_ms, source_state, confidence, event_match, quality_flags_json, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?)`,
          `aob_${id}_${interval.seq}`,
          id,
          interval.seq,
          interval.startMs,
          interval.endMs,
          interval.sourceState,
          interval.confidence,
          now,
        );
      }
      ctx.store.run(
        'UPDATE ambient_sessions SET observation_started_at = ?, last_client_seq = ?, last_observed_ms = ? WHERE id = ?',
        now,
        replay.length,
        replayEndMs,
        id,
      );
    }
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: 'ambient.session_created',
      subjectType: 'ambient_session',
      subjectId: id,
      metadata: {
        agreementId: agreement.id,
        demo: input.demo,
        observationMode: input.observationMode,
        priceMinor: terms.financial.fixedPriceMinor,
        replayIntervals: replay.length,
        replayEndMs,
      },
    },
    ctx.now(),
  );
  return ambientSessionView(ctx, id, { type: 'renter', id: renter.id });
}

function observationRows(ctx: AppContext, sessionId: string): AmbientObservationRow[] {
  return ctx.store.all<AmbientObservationRow>(
    'SELECT * FROM ambient_observations WHERE session_id = ? ORDER BY seq ASC',
    sessionId,
  );
}

function observationFromRow(row: AmbientObservationRow): AmbientObservation {
  return {
    seq: row.seq,
    startMs: row.start_ms,
    endMs: row.end_ms,
    sourceState: row.source_state,
    confidence: row.confidence,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
    ...(row.event_match === null ? {} : { eventMatch: row.event_match }),
  };
}

function setSession(
  ctx: AppContext,
  id: string,
  input: Partial<{
    state: AmbientSessionRow['state'];
    paymentState: string;
    authorizedAt: string | null;
    observationStartedAt: string | null;
    observationStoppedAt: string | null;
    authorizationExpiresAt: string | null;
    orderId: string | null;
    approveUrl: string | null;
    authorizationId: string | null;
    captureId: string | null;
    voidId: string | null;
    providerStatus: string | null;
    providerReconciledAt: string | null;
    capturedMinor: number | null;
    outcome: AmbientOutcome | null;
    eligibleForCapture: boolean;
    evaluationJson: string | null;
    evaluationHash: string | null;
    evidenceRoot: string | null;
    acceptanceJson: string | null;
    failureReason: string | null;
  }>,
): void {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const map: Array<[keyof typeof input, string]> = [
    ['state', 'state'],
    ['paymentState', 'payment_state'],
    ['authorizedAt', 'authorized_at'],
    ['observationStartedAt', 'observation_started_at'],
    ['observationStoppedAt', 'observation_stopped_at'],
    ['authorizationExpiresAt', 'authorization_expires_at'],
    ['orderId', 'paypal_order_id'],
    ['approveUrl', 'paypal_approve_url'],
    ['authorizationId', 'paypal_authorization_id'],
    ['captureId', 'paypal_capture_id'],
    ['voidId', 'paypal_void_id'],
    ['providerStatus', 'provider_status'],
    ['providerReconciledAt', 'provider_reconciled_at'],
    ['capturedMinor', 'captured_minor'],
    ['outcome', 'outcome'],
    ['evaluationJson', 'evaluation_json'],
    ['evaluationHash', 'evaluation_hash'],
    ['evidenceRoot', 'evidence_root'],
    ['acceptanceJson', 'acceptance_json'],
    ['failureReason', 'failure_reason'],
  ];
  for (const [key, column] of map) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(input[key] as string | number | null);
    }
  }
  if (input.eligibleForCapture !== undefined) {
    fields.push('eligible_for_capture = ?');
    values.push(input.eligibleForCapture ? 1 : 0);
  }
  if (fields.length === 0) return;
  values.push(id);
  ctx.store.run(`UPDATE ambient_sessions SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

function requireSessionForActor(ctx: AppContext, id: string, actor: Actor): AmbientSessionRow {
  const row = sessionRow(ctx, id);
  const allowed =
    (actor.type === 'renter' && actor.id === row.buyer_id) ||
    (actor.type === 'operator' && actor.id === row.provider_id);
  if (!allowed) throw errors.notFound('Ambient session not found.');
  return row;
}

export function ambientSessionView(
  ctx: AppContext,
  sessionId: string,
  actor?: Actor,
): AmbientSessionView {
  const row = actor ? requireSessionForActor(ctx, sessionId, actor) : sessionRow(ctx, sessionId);
  const agreement = agreementRow(ctx, row.agreement_id);
  const object = requireAmbientObject(ctx, row.object_id);
  const model = modelRowForAgreement(ctx, agreement);
  const terms = sessionTerms(row);
  const evaluation = row.evaluation_json ? (JSON.parse(row.evaluation_json) as AmbientEvaluation) : null;
  const observations = observationRows(ctx, row.id).map((entry) => ({
    seq: entry.seq,
    startMs: entry.start_ms,
    endMs: entry.end_ms,
    sourceState: entry.source_state,
    confidence: entry.confidence,
    qualityFlags: JSON.parse(entry.quality_flags_json) as string[],
  }));
  const authorizationExpired =
    row.authorization_expires_at !== null && Date.parse(row.authorization_expires_at) <= ctx.now().getTime();
  const proof = ctx.store.get<AmbientProofRow>('SELECT * FROM ambient_proofs WHERE session_id = ?', row.id);
  const buyer = actor?.type === 'renter' && actor.id === row.buyer_id;
  const provider = actor?.type === 'operator' && actor.id === row.provider_id;
  const finalStates = new Set([
    'CAPTURED',
    'VOID_CONFIRMED',
    'NOT_QUALIFIED',
    'BUYER_REJECTED',
    'EXPIRED',
    'DEMO_COMPLETE',
    'RECONCILIATION_REQUIRED',
  ]);
  const canCapture =
    buyer &&
    !row.demo &&
    row.state === 'READY_FOR_CAPTURE' &&
    row.payment_state === 'AUTHORIZED' &&
    !authorizationExpired &&
    Boolean(row.paypal_authorization_id) &&
    row.captured_minor === null;
  return {
    id: row.id,
    agreementId: row.agreement_id,
    agreementRevision: row.agreement_revision,
    agreementHash: row.agreement_hash,
    target: objectView(ctx, object),
    serviceName: terms.serviceName,
    state: row.state,
    paymentState: row.payment_state,
    demo: Boolean(row.demo),
    observationMode: row.observation_mode,
    terms,
    interpretation: terms.interpretation,
    model: modelSummary(model),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    authorizedAt: row.authorized_at,
    observationStartedAt: row.observation_started_at,
    observationStoppedAt: row.observation_stopped_at,
    authorizationExpiresAt: row.authorization_expires_at,
    authorizationExpired,
    meterClockMs: row.last_observed_ms,
    evaluation,
    observations,
    acceptance: row.acceptance_json
      ? (JSON.parse(row.acceptance_json) as AmbientSessionView['acceptance'])
      : null,
    payment: {
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
    ownership: { buyer, provider },
    flags: {
      canOrder: buyer && !row.demo && row.state === 'PAYMENT_PENDING' && row.payment_state === 'NONE',
      canAuthorize:
        buyer && !row.demo && Boolean(row.paypal_order_id) && row.payment_state === 'ORDER_CREATED',
      canStart:
        buyer &&
        row.observation_started_at === null &&
        row.state === 'AUTHORIZED' &&
        (Boolean(row.demo) || row.payment_state === 'AUTHORIZED') &&
        !authorizationExpired,
      canSubmitObservations: buyer && row.state === 'OBSERVING',
      canStop: buyer && row.state === 'OBSERVING',
      canAcceptResult: buyer && row.state === 'QUALIFIED_AWAITING_ACCEPTANCE',
      canCapture,
      canVoid:
        !row.demo &&
        !row.paypal_capture_id &&
        Boolean(row.paypal_authorization_id) &&
        !['VOID_CONFIRMED', 'CAPTURED'].includes(row.state),
      canProof: finalStates.has(row.state) && Boolean(row.evaluation_json),
      awaitingBuyer: buyer && ['PAYMENT_PENDING', 'AUTHORIZED', 'QUALIFIED_AWAITING_ACCEPTANCE'].includes(row.state),
      awaitingProvider: row.payment_state === 'CAPTURE_REQUESTED',
    },
    limitations: terms.interpretation.limitations,
    sandboxNotice: row.demo
      ? 'Synthetic or live demonstration with no PayPal order, authorization or capture. No money can move.'
      : 'PayPal Sandbox only. The buyer must authorize the fixed price before observation, and capture is explicit only after a qualified window and buyer acceptance.',
  };
}

export async function createAmbientOrder(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  origin: string,
): Promise<{ orderId: string; approveUrl: string | null; session: AmbientSessionView }> {
  if (!ctx.paypal) throw errors.unavailable('PayPal Sandbox is not configured.');
  const row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.demo) throw errors.conflict('DEMO_SESSION', 'Demo sessions do not create PayPal orders.');
  if (row.paypal_order_id && row.paypal_approve_url) {
    return {
      orderId: row.paypal_order_id,
      approveUrl: row.paypal_approve_url,
      session: ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id }),
    };
  }
  if (row.state !== 'PAYMENT_PENDING') throw errors.conflict('INVALID_STATE', `Cannot create an order from ${row.state}.`);
  const terms = sessionTerms(row);
  const requestId = providerRequestId([
    'ambient-order',
    row.id,
    row.agreement_hash,
    terms.financial.maximumChargeMinor,
  ]);
  const operation = ensureAmbientOperation(ctx, row.id, 'CREATE_ORDER', {
    requestId,
    amountMinor: terms.financial.maximumChargeMinor,
    currency: terms.financial.currency,
    state: 'PENDING',
  });
  try {
    const normalised = origin.replace(/\/$/, '');
    if (!ctx.config.publicOrigins.includes(normalised)) throw errors.badRequest('Unrecognised application origin.');
    const { order, approveUrl } = await ctx.paypal.createOrder({
      capMinor: terms.financial.maximumChargeMinor,
      currency: terms.financial.currency,
      sessionId: row.id,
      description: `Whirr Ambient coordination - ${terms.serviceName}`.slice(0, 127),
      returnUrl: `${normalised}/ambient/window/${row.id}?paypal=return`,
      cancelUrl: `${normalised}/ambient/window/${row.id}?paypal=cancel`,
      requestId,
    });
    if (!order.id || !approveUrl) throw errors.provider('PayPal did not return an approval link.');
    setSession(ctx, row.id, {
      orderId: order.id,
      approveUrl,
      paymentState: 'ORDER_CREATED',
      providerStatus: order.status ?? 'CREATED',
    });
    finishAmbientOperation(ctx, operation, { state: 'COMPLETED', providerRef: order.id, response: order });
    const updated = sessionRow(ctx, row.id);
    return {
      orderId: order.id,
      approveUrl,
      session: ambientSessionView(ctx, updated.id, { type: 'renter', id: renter.id }),
    };
  } catch (error) {
    finishAmbientOperation(ctx, operation, { state: 'FAILED' });
    throw ambientProviderFailure(error);
  }
}

export async function authorizeAmbientSession(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
): Promise<AmbientSessionView> {
  if (!ctx.paypal) throw errors.unavailable('PayPal Sandbox is not configured.');
  let row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.demo) throw errors.conflict('DEMO_SESSION', 'Demo sessions never authorize money.');
  if (row.payment_state === 'AUTHORIZED' || row.state === 'AUTHORIZED') {
    return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  }
  if (!row.paypal_order_id) throw errors.conflict('NO_ORDER', 'Create the PayPal order before authorizing.');
  if (row.state !== 'PAYMENT_PENDING') throw errors.conflict('INVALID_STATE', `Cannot authorize from ${row.state}.`);
  const terms = sessionTerms(row);
  const requestId = providerRequestId([
    'ambient-authorize',
    row.id,
    row.agreement_hash,
    row.paypal_order_id,
  ]);
  const operation = ensureAmbientOperation(ctx, row.id, 'AUTHORIZE', {
    requestId,
    amountMinor: terms.financial.maximumChargeMinor,
    currency: terms.financial.currency,
    state: 'PENDING',
  });
  try {
    const order = await ctx.paypal.getOrder(row.paypal_order_id);
    if (order.status !== 'APPROVED' && order.status !== 'COMPLETED') {
      throw errors.conflict('ORDER_NOT_APPROVED', `PayPal reports the order as ${order.status}. Buyer approval is required.`);
    }
    const authorized = await ctx.paypal.authorizeOrder(row.paypal_order_id, requestId);
    const authorization = extractAuthorization(authorized);
    if (!authorization || !['CREATED', 'CAPTURED'].includes(authorization.status)) {
      throw errors.provider('PayPal did not return an authorization in a usable state.');
    }
    const expectedMinor = terms.financial.maximumChargeMinor;
    const actualMinor = decimalStringToMinor(String(authorization.amount.value), terms.financial.currency);
    if (
      authorization.amount.currency_code !== terms.financial.currency ||
      actualMinor === null ||
      actualMinor !== expectedMinor
    ) {
      throw errors.provider('PayPal returned an authorization amount or currency that does not match the approved terms.');
    }
    const now = ctx.now();
    const expiresAt =
      authorization.expiration_time && Number.isFinite(Date.parse(authorization.expiration_time))
        ? authorization.expiration_time
        : new Date(now.getTime() + terms.financial.authorizationExpiryMinutes * 60_000).toISOString();
    setSession(ctx, row.id, {
      state: 'AUTHORIZED',
      paymentState: 'AUTHORIZED',
      authorizedAt: now.toISOString(),
      authorizationId: authorization.id,
      authorizationExpiresAt: expiresAt,
      providerStatus: authorization.status,
      failureReason: null,
    });
    finishAmbientOperation(ctx, operation, {
      state: 'COMPLETED',
      providerRef: authorization.id,
      response: authorized,
    });
    appendAudit(
      ctx.store,
      {
        actorType: 'renter',
        actorId: renter.id,
        action: 'ambient.authorization_created',
        subjectType: 'ambient_session',
        subjectId: row.id,
        metadata: {
          orderId: row.paypal_order_id,
          authorizationId: authorization.id,
          authorizedMinor: actualMinor,
          currency: terms.financial.currency,
        },
      },
      ctx.now(),
    );
    row = sessionRow(ctx, row.id);
    return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  } catch (error) {
    finishAmbientOperation(ctx, operation, { state: 'FAILED' });
    if (error instanceof AppError) throw error;
    throw ambientProviderFailure(error);
  }
}

export function startAmbientObservation(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
): AmbientSessionView {
  const row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.state === 'OBSERVING') return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  if (row.state !== 'AUTHORIZED') throw errors.conflict('INVALID_STATE', 'The window is not authorized to begin.');
  if (!row.demo && row.payment_state !== 'AUTHORIZED') {
    throw errors.conflict('NOT_AUTHORIZED', 'PayPal has not authorized the approved amount.');
  }
  if (row.authorization_expires_at && Date.parse(row.authorization_expires_at) <= ctx.now().getTime()) {
    setSession(ctx, row.id, { state: 'EXPIRED', failureReason: 'Authorization expired before observation.' });
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The authorization expired before the window began. No charge was made.');
  }
  if (row.last_observed_ms > 0) throw errors.conflict('OBSERVATION_ALREADY_STARTED', 'This window already has observations.');
  setSession(ctx, row.id, { state: 'OBSERVING', observationStartedAt: ctx.now().toISOString(), failureReason: null });
  return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
}

export function appendAmbientObservations(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: { clientSeq: number; intervals: AmbientObservation[] },
): AmbientSessionView {
  const row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.state !== 'OBSERVING') throw errors.conflict('NOT_OBSERVING', 'The physical window is not open.');
  const terms = sessionTerms(row);
  let lastSeq = row.last_client_seq;
  let lastMs = row.last_observed_ms;
  const now = ctx.now().toISOString();
  ctx.store.transaction(() => {
    for (const interval of input.intervals) {
      if (interval.seq <= lastSeq) throw errors.conflict('STALE_OBSERVATION', 'Observation sequence numbers must increase.');
      if (interval.startMs < lastMs) throw errors.conflict('OVERLAPPING_OBSERVATION', 'Observation intervals must not overlap.');
      if (interval.endMs - interval.startMs > 120_000) throw errors.badRequest('A single interval is too long.');
      const gap = interval.startMs - lastMs;
      if (gap > terms.condition.maxObservationGapMs) {
        throw errors.conflict(
          'OBSERVATION_GAP',
          `A ${gap}ms gap exceeds the approved ${terms.condition.maxObservationGapMs}ms evidence limit.`,
        );
      }
      if (interval.endMs > 15 * 60_000) throw errors.badRequest('The observation session exceeds 15 minutes.');
      ctx.store.run(
        `INSERT INTO ambient_observations
          (id, session_id, seq, start_ms, end_ms, source_state, confidence, event_match, quality_flags_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('aob'),
        row.id,
        interval.seq,
        interval.startMs,
        interval.endMs,
        interval.sourceState,
        interval.confidence,
        interval.eventMatch ?? null,
        JSON.stringify(interval.qualityFlags ?? []),
        now,
      );
      lastSeq = interval.seq;
      lastMs = interval.endMs;
    }
    ctx.store.run(
      'UPDATE ambient_sessions SET last_client_seq = ?, last_observed_ms = ? WHERE id = ?',
      lastSeq,
      lastMs,
      row.id,
    );
  });
  return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
}

async function voidSessionInternal(
  ctx: AppContext,
  row: AmbientSessionRow,
  actor: Actor | null,
  reason: string,
): Promise<AmbientSessionRow> {
  if (row.demo) {
    setSession(ctx, row.id, {
      state: row.state === 'QUALIFIED_AWAITING_ACCEPTANCE' ? 'DEMO_COMPLETE' : 'VOID_CONFIRMED',
      paymentState: 'DEMO_MODE',
      failureReason: reason,
    });
    return sessionRow(ctx, row.id);
  }
  if (!row.paypal_authorization_id) {
    setSession(ctx, row.id, {
      state: 'VOID_CONFIRMED',
      paymentState: 'VOIDED',
      providerStatus: 'NO_AUTHORIZATION',
      failureReason: reason,
    });
    return sessionRow(ctx, row.id);
  }
  if (!ctx.paypal) {
    setSession(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      paymentState: 'UNRESOLVED',
      providerStatus: 'PAYPAL_NOT_CONFIGURED',
      failureReason: 'PayPal is no longer configured. The authorization could not be voided.',
    });
    return sessionRow(ctx, row.id);
  }
  const terms = sessionTerms(row);
  const requestId = providerRequestId(['ambient-void', row.id, row.agreement_hash, row.paypal_authorization_id]);
  const operation = ensureAmbientOperation(ctx, row.id, 'VOID', {
    requestId,
    amountMinor: 0,
    currency: terms.financial.currency,
    state: 'REQUESTED',
  });
  setSession(ctx, row.id, { state: 'VOID_REQUESTED', paymentState: 'VOID_REQUESTED', failureReason: reason });
  try {
    const authorization = await ctx.paypal.voidAuthorization(row.paypal_authorization_id, requestId);
    setSession(ctx, row.id, {
      state: 'VOID_CONFIRMED',
      paymentState: 'VOIDED',
      voidId: authorization.id,
      providerStatus: authorization.status,
      failureReason: reason,
    });
    finishAmbientOperation(ctx, operation, {
      state: 'COMPLETED',
      providerRef: authorization.id,
      response: authorization,
    });
    appendAudit(
      ctx.store,
      {
        actorType: actor?.type ?? 'system',
        actorId: actor?.id ?? 'ambient',
        action: 'ambient.void_confirmed',
        subjectType: 'ambient_session',
        subjectId: row.id,
        metadata: { authorizationId: authorization.id, status: authorization.status, reason },
      },
      ctx.now(),
    );
    return sessionRow(ctx, row.id);
  } catch (error) {
    finishAmbientOperation(ctx, operation, { state: 'UNKNOWN' });
    setSession(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      paymentState: 'UNRESOLVED',
      providerStatus: 'VOID_OUTCOME_UNKNOWN',
      failureReason: 'The void outcome is unknown. Reconcile before retrying; do not capture.',
    });
    throw ambientProviderFailure(error);
  }
}

export async function stopAmbientObservation(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
): Promise<AmbientSessionView> {
  let row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  const terminal = new Set([
    'QUALIFIED_AWAITING_ACCEPTANCE',
    'READY_FOR_CAPTURE',
    'CAPTURED',
    'VOID_CONFIRMED',
    'NOT_QUALIFIED',
    'BUYER_REJECTED',
    'EXPIRED',
    'DEMO_COMPLETE',
    'RECONCILIATION_REQUIRED',
  ]);
  if (terminal.has(row.state)) return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  if (row.state !== 'OBSERVING') throw errors.conflict('NOT_OBSERVING', 'The physical window is not open.');
  const agreement = agreementRow(ctx, row.agreement_id);
  const terms = sessionTerms(row);
  const observations = observationRows(ctx, row.id).map(observationFromRow);
  const currentModel = latestModelRow(ctx, row.object_id);
  const now = ctx.now().toISOString();
  const evaluation = await evaluateAmbientAgreement({
    terms,
    agreementHash: row.agreement_hash,
    observations,
    currentModelHash: currentModel?.model_hash,
    now,
  });
  const qualified = evaluation.outcome === 'QUALIFIED' && evaluation.eligibleForCapture;
  setSession(ctx, row.id, {
    state: qualified ? 'QUALIFIED_AWAITING_ACCEPTANCE' : 'NOT_QUALIFIED',
    observationStoppedAt: now,
    outcome: evaluation.outcome,
    eligibleForCapture: evaluation.eligibleForCapture,
    evaluationJson: JSON.stringify(evaluation),
    evaluationHash: hashCanonical(evaluation),
    evidenceRoot: evaluation.evidenceRoot,
    failureReason: qualified ? null : evaluation.reason,
    paymentState: row.demo ? 'DEMO_MODE' : row.payment_state,
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: qualified ? 'ambient.window_qualified' : 'ambient.window_not_qualified',
      subjectType: 'ambient_session',
      subjectId: row.id,
      metadata: {
        agreementId: agreement.id,
        outcome: evaluation.outcome,
        inactiveMs: evaluation.inactiveMs,
        requiredInactiveMs: evaluation.requiredInactiveMs,
        priceMinor: terms.financial.fixedPriceMinor,
        evidenceRoot: evaluation.evidenceRoot,
      },
    },
    ctx.now(),
  );
  row = sessionRow(ctx, row.id);
  if (!row.demo && !qualified && row.paypal_authorization_id) {
    try {
      row = await voidSessionInternal(ctx, row, { type: 'renter', id: renter.id }, evaluation.reason);
    } catch {
      // The session is already in RECONCILIATION_REQUIRED; return that honest state.
      row = sessionRow(ctx, row.id);
    }
  }
  if (!qualified && row.demo) {
    setSession(ctx, row.id, { state: 'NOT_QUALIFIED', paymentState: 'DEMO_MODE' });
  }
  return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
}

export async function acceptAmbientResult(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: { accepted: boolean; termsHash: string; note?: string | null },
): Promise<AmbientSessionView> {
  let row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.agreement_hash !== input.termsHash) {
    throw errors.conflict('TERMS_CHANGED', 'The session terms do not match the acceptance.');
  }
  if (row.state !== 'QUALIFIED_AWAITING_ACCEPTANCE') {
    throw errors.conflict('NOT_AWAITING_ACCEPTANCE', 'This window is not awaiting buyer acceptance.');
  }
  const acceptance = {
    accepted: input.accepted,
    acceptedAt: ctx.now().toISOString(),
    note: input.note?.trim() || null,
    buyerRef: shortRef('buyer', renter.id),
  };
  setSession(ctx, row.id, {
    state: input.accepted ? 'READY_FOR_CAPTURE' : 'BUYER_REJECTED',
    acceptanceJson: JSON.stringify(acceptance),
    failureReason: input.accepted ? null : 'The buyer rejected the observed result.',
  });
  appendAudit(
    ctx.store,
    {
      actorType: 'renter',
      actorId: renter.id,
      action: input.accepted ? 'ambient.result_accepted' : 'ambient.result_rejected',
      subjectType: 'ambient_session',
      subjectId: row.id,
      metadata: { accepted: input.accepted, termsHash: input.termsHash },
    },
    ctx.now(),
  );
  row = sessionRow(ctx, row.id);
  if (!input.accepted) {
    if (row.demo) setSession(ctx, row.id, { state: 'BUYER_REJECTED', paymentState: 'DEMO_MODE' });
    else if (row.paypal_authorization_id) {
      try {
        row = await voidSessionInternal(ctx, row, { type: 'renter', id: renter.id }, 'Buyer rejected the observed result.');
      } catch {
        row = sessionRow(ctx, row.id);
      }
    }
  } else if (row.demo) {
    setSession(ctx, row.id, { state: 'DEMO_COMPLETE', paymentState: 'DEMO_MODE' });
  }
  return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
}

export async function captureAmbientSession(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: { confirmed: true; termsHash: string },
): Promise<AmbientSessionView> {
  if (!ctx.paypal) throw errors.unavailable('PayPal Sandbox is not configured.');
  let row = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (row.demo) throw errors.conflict('DEMO_SESSION', 'Demo windows never capture money.');
  if (row.agreement_hash !== input.termsHash) throw errors.conflict('TERMS_CHANGED', 'The capture terms do not match the session.');
  if (row.state === 'CAPTURED') return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  if (row.state !== 'READY_FOR_CAPTURE') throw errors.conflict('NOT_READY', 'The window is not ready for capture.');
  if (row.payment_state !== 'AUTHORIZED' || !row.paypal_authorization_id) {
    throw errors.conflict('NOT_AUTHORIZED', 'No live PayPal authorization is available.');
  }
  if (row.authorization_expires_at && Date.parse(row.authorization_expires_at) <= ctx.now().getTime()) {
    setSession(ctx, row.id, { state: 'EXPIRED', failureReason: 'Authorization expired before capture.' });
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The authorization expired. No charge was made.');
  }
  if (!row.evaluation_json) throw errors.conflict('NO_EVALUATION', 'No temporal evaluation exists.');
  const terms = sessionTerms(row);
  const stored = JSON.parse(row.evaluation_json) as AmbientEvaluation;
  const acceptance = row.acceptance_json ? (JSON.parse(row.acceptance_json) as { accepted?: boolean }) : null;
  if (!acceptance?.accepted) throw errors.conflict('ACCEPTANCE_REQUIRED', 'The buyer must accept the observed result.');
  const currentModel = latestModelRow(ctx, row.object_id);
  const revalidated = await evaluateAmbientAgreement({
    terms,
    agreementHash: row.agreement_hash,
    observations: observationRows(ctx, row.id).map(observationFromRow),
    currentModelHash: currentModel?.model_hash,
    now: row.observation_stopped_at ?? ctx.now().toISOString(),
  });
  if (
    revalidated.outcome !== 'QUALIFIED' ||
    !revalidated.eligibleForCapture ||
    revalidated.evidenceRoot !== row.evidence_root ||
    hashCanonical(revalidated) !== row.evaluation_hash ||
    stored.outcome !== revalidated.outcome
  ) {
    setSession(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      eligibleForCapture: false,
      failureReason: 'Stored evidence no longer replays to a qualified result. No capture was attempted.',
    });
    throw errors.conflict('EVIDENCE_CHANGED', 'The stored evidence no longer qualifies. No capture was attempted.');
  }
  const priceMinor = terms.financial.fixedPriceMinor;
  if (priceMinor <= 0 || priceMinor > terms.financial.maximumChargeMinor) {
    throw errors.conflict('CHARGE_CEILING', 'The capture price exceeds the approved ceiling.');
  }
  const requestId = providerRequestId([
    'ambient-capture',
    row.id,
    row.agreement_hash,
    row.paypal_authorization_id,
    priceMinor,
  ]);
  const operation = ensureAmbientOperation(ctx, row.id, 'CAPTURE', {
    requestId,
    amountMinor: priceMinor,
    currency: terms.financial.currency,
    state: 'REQUESTED',
  });
  setSession(ctx, row.id, {
    state: 'CAPTURE_REQUESTED',
    paymentState: 'CAPTURE_REQUESTED',
    failureReason: null,
  });
  try {
    const capture: PayPalCapture = await ctx.paypal.captureAuthorization({
      authorizationId: row.paypal_authorization_id,
      amountMinor: priceMinor,
      currency: terms.financial.currency,
      requestId,
      invoiceId: row.id,
      noteToPayer: `Whirr Ambient ${row.id.slice(-8)} - ${terms.condition.requiredInactiveMs / 1000}s verified window`,
    });
    const capturedMinor = capture.amount
      ? decimalStringToMinor(String(capture.amount.value), terms.financial.currency)
      : null;
    const amountOk =
      capture.amount?.currency_code === terms.financial.currency && capturedMinor === priceMinor;
    if (capture.status === 'COMPLETED' && amountOk) {
      setSession(ctx, row.id, {
        state: 'CAPTURED',
        paymentState: 'CAPTURED',
        captureId: capture.id,
        providerStatus: capture.status,
        capturedMinor,
        failureReason: null,
      });
      finishAmbientOperation(ctx, operation, { state: 'COMPLETED', providerRef: capture.id, response: capture });
      appendAudit(
        ctx.store,
        {
          actorType: 'renter',
          actorId: renter.id,
          action: 'ambient.capture_confirmed',
          subjectType: 'ambient_session',
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
    } else {
      setSession(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: capture.status === 'PENDING' ? 'CAPTURE_PENDING' : 'UNRESOLVED',
        captureId: capture.id,
        providerStatus: capture.status,
        capturedMinor: null,
        failureReason:
          capture.status === 'PENDING'
            ? 'PayPal reports the capture as PENDING. Reconcile before retrying.'
            : 'PayPal returned an unexpected capture state. Reconcile before any retry.',
      });
      finishAmbientOperation(ctx, operation, {
        state: capture.status,
        providerRef: capture.id,
        response: capture,
      });
    }
    row = sessionRow(ctx, row.id);
    return ambientSessionView(ctx, row.id, { type: 'renter', id: renter.id });
  } catch (error) {
    finishAmbientOperation(ctx, operation, { state: 'UNKNOWN' });
    setSession(ctx, row.id, {
      state: 'RECONCILIATION_REQUIRED',
      paymentState: 'UNRESOLVED',
      providerStatus: 'CAPTURE_OUTCOME_UNKNOWN',
      failureReason: 'The provider outcome is unknown. Reconcile before retrying; do not start a second capture.',
    });
    throw ambientProviderFailure(error);
  }
}

export async function voidAmbientSession(
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  reason?: string,
): Promise<AmbientSessionView> {
  const row = requireSessionForActor(ctx, sessionId, actor);
  if (row.demo) throw errors.conflict('DEMO_SESSION', 'There is no authorization to void.');
  if (row.paypal_capture_id || row.state === 'CAPTURED') {
    throw errors.conflict('ALREADY_CAPTURED', 'A confirmed capture cannot be voided here.');
  }
  if (row.state === 'VOID_CONFIRMED') return ambientSessionView(ctx, row.id, actor);
  const updated = await voidSessionInternal(ctx, row, actor, reason?.slice(0, 240) || 'Cooperation session cancelled.');
  return ambientSessionView(ctx, updated.id, actor);
}

function ensureAmbientOperation(
  ctx: AppContext,
  sessionId: string,
  operationType: AmbientPaymentOperationRow['operation_type'],
  input: { requestId: string; amountMinor: number; currency: Currency; state: string },
): AmbientPaymentOperationRow {
  const existing = ctx.store.get<AmbientPaymentOperationRow>(
    'SELECT * FROM ambient_payment_operations WHERE session_id = ? AND operation_type = ?',
    sessionId,
    operationType,
  );
  if (existing) {
    if (existing.request_id !== input.requestId) {
      throw errors.conflict(
        'PAYMENT_OPERATION_CONFLICT',
        'A different provider request already exists for this operation. Reconcile instead of retrying.',
      );
    }
    return existing;
  }
  const now = ctx.now().toISOString();
  const id = newId('apo');
  ctx.store.run(
    `INSERT INTO ambient_payment_operations
      (id, session_id, operation_type, request_id, state, amount_minor, currency, request_hash, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id,
    sessionId,
    operationType,
    input.requestId,
    input.state,
    input.amountMinor,
    input.currency,
    hashCanonical({ sessionId, operationType, requestId: input.requestId, amountMinor: input.amountMinor }),
    now,
    now,
  );
  const row = ctx.store.get<AmbientPaymentOperationRow>('SELECT * FROM ambient_payment_operations WHERE id = ?', id);
  if (!row) throw errors.internal('Failed to create Ambient payment operation.');
  return row;
}

function finishAmbientOperation(
  ctx: AppContext,
  operation: AmbientPaymentOperationRow,
  input: { state: string; providerRef?: string | null; response?: unknown },
): void {
  ctx.store.run(
    `UPDATE ambient_payment_operations
     SET state = ?, provider_ref = COALESCE(?, provider_ref), response_json = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = ?`,
    input.state,
    input.providerRef ?? null,
    input.response === undefined ? operation.response_json : JSON.stringify(input.response),
    ctx.now().toISOString(),
    operation.id,
  );
}

function ambientProviderFailure(error: unknown): AppError {
  if (error instanceof PayPalApiError) {
    return new AppError(502, error.issue ?? 'PAYPAL_ERROR', `PayPal Sandbox: ${error.message}`, {
      issue: error.issue,
      debugId: error.debugId,
      providerStatus: error.status,
    });
  }
  return errors.provider(`PayPal Sandbox request failed: ${(error as Error).message}`);
}

export interface AmbientReconciliationResult {
  sessionId: string;
  result: 'NO_CHANGE' | 'CAPTURE_CONFIRMED' | 'VOID_CONFIRMED' | 'RECONCILIATION_REQUIRED' | 'RECONCILE_FAILED';
}

export function findAmbientSessionForProviderIds(ctx: AppContext, providerIds: string[]): string | null {
  for (const providerId of providerIds) {
    if (!providerId) continue;
    const row = ctx.store.get<{ id: string }>(
      `SELECT id FROM ambient_sessions
       WHERE paypal_order_id = ? OR paypal_authorization_id = ?
          OR paypal_capture_id = ? OR paypal_void_id = ?
       LIMIT 1`,
      providerId,
      providerId,
      providerId,
      providerId,
    );
    if (row) return row.id;
    const operation = ctx.store.get<{ session_id: string }>(
      'SELECT session_id FROM ambient_payment_operations WHERE provider_ref = ? LIMIT 1',
      providerId,
    );
    if (operation) return operation.session_id;
  }
  return null;
}

async function verifyStoredAmbientEvaluation(
  ctx: AppContext,
  row: AmbientSessionRow,
): Promise<{ evaluation: AmbientEvaluation; matches: boolean }> {
  if (!row.evaluation_json || !row.evaluation_hash) {
    throw errors.conflict('NO_EVALUATION', 'This Ambient session has no stored evaluation.');
  }
  const terms = sessionTerms(row);
  const stored = JSON.parse(row.evaluation_json) as AmbientEvaluation;
  const replay = await evaluateAmbientAgreement({
    terms,
    agreementHash: row.agreement_hash,
    observations: observationRows(ctx, row.id).map(observationFromRow),
    currentModelHash: terms.eventModel.hash,
    now: row.observation_stopped_at ?? stored.evaluatedAt,
  });
  const storedHash = hashCanonical(stored);
  return {
    evaluation: replay,
    matches:
      storedHash === row.evaluation_hash &&
      storedHash === hashCanonical(replay) &&
      stored.outcome === replay.outcome &&
      stored.eligibleForCapture === replay.eligibleForCapture &&
      stored.priceMinor === replay.priceMinor &&
      stored.agreementHash === row.agreement_hash,
  };
}

/**
 * Read-only provider reconciliation. It never captures or voids. A completed
 * capture is accepted only when the stored evidence replays, the buyer accepted
 * the result, and the provider amount/currency match the approved fixed price.
 */
export async function reconcileAmbientSession(
  ctx: AppContext,
  sessionId: string,
): Promise<AmbientReconciliationResult> {
  const row = sessionRow(ctx, sessionId);
  if (row.demo || !ctx.paypal) return { sessionId: row.id, result: 'NO_CHANGE' };
  if (row.state === 'CAPTURED' || row.state === 'VOID_CONFIRMED') {
    return { sessionId: row.id, result: 'NO_CHANGE' };
  }
  const paypal = ctx.paypal;
  const terms = sessionTerms(row);
  const reconciledAt = ctx.now().toISOString();
  const mark = () => setSession(ctx, row.id, { providerReconciledAt: reconciledAt });
  try {
    if (row.paypal_capture_id) {
      const capture = await paypal.getCapture(row.paypal_capture_id);
      if (capture.status === 'COMPLETED') {
        const { evaluation, matches } = await verifyStoredAmbientEvaluation(ctx, row);
        const amountOk = capture.amount
          ? capture.amount.currency_code === terms.financial.currency &&
            decimalStringToMinor(String(capture.amount.value), terms.financial.currency) === terms.financial.fixedPriceMinor
          : false;
        const acceptance = row.acceptance_json
          ? (JSON.parse(row.acceptance_json) as { accepted?: boolean })
          : null;
        const operation = ctx.store.get<AmbientPaymentOperationRow>(
          "SELECT * FROM ambient_payment_operations WHERE session_id = ? AND operation_type = 'CAPTURE'",
          row.id,
        );
        const operationOk =
          !operation ||
          operation.amount_minor === terms.financial.fixedPriceMinor &&
            operation.currency === terms.financial.currency;
        if (
          matches &&
          evaluation.outcome === 'QUALIFIED' &&
          evaluation.eligibleForCapture &&
          acceptance?.accepted === true &&
          amountOk &&
          operationOk
        ) {
          const capturedMinor = decimalStringToMinor(String(capture.amount!.value), terms.financial.currency);
          setSession(ctx, row.id, {
            state: 'CAPTURED',
            paymentState: 'CAPTURED',
            captureId: capture.id,
            providerStatus: capture.status,
            capturedMinor,
            failureReason: null,
          });
          if (operation) {
            finishAmbientOperation(ctx, operation, {
              state: 'COMPLETED',
              providerRef: capture.id,
              response: capture,
            });
          }
          mark();
          return { sessionId: row.id, result: 'CAPTURE_CONFIRMED' };
        }
        setSession(ctx, row.id, {
          state: 'RECONCILIATION_REQUIRED',
          paymentState: 'UNRESOLVED',
          providerStatus: 'CAPTURE_EVIDENCE_MISMATCH',
          capturedMinor: null,
          failureReason:
            'PayPal reports a completed capture, but the accepted evidence, amount, or operation does not agree. Do not retry; review manually.',
        });
        mark();
        return { sessionId: row.id, result: 'RECONCILIATION_REQUIRED' };
      }
      if (capture.status === 'PENDING') {
        setSession(ctx, row.id, { paymentState: 'CAPTURE_PENDING', providerStatus: capture.status });
        mark();
        return { sessionId: row.id, result: 'NO_CHANGE' };
      }
      setSession(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        providerStatus: capture.status,
        capturedMinor: null,
        failureReason: `PayPal capture status ${capture.status}. No settlement is confirmed.`,
      });
      mark();
      return { sessionId: row.id, result: 'RECONCILIATION_REQUIRED' };
    }
    if (row.paypal_authorization_id) {
      const authorization = await paypal.getAuthorization(row.paypal_authorization_id);
      if (authorization.status === 'VOIDED') {
        setSession(ctx, row.id, {
          state: 'VOID_CONFIRMED',
          paymentState: 'VOIDED',
          voidId: authorization.id,
          providerStatus: authorization.status,
          failureReason: null,
        });
        mark();
        return { sessionId: row.id, result: 'VOID_CONFIRMED' };
      }
      if (authorization.status === 'CAPTURED' || authorization.status === 'PARTIALLY_CAPTURED') {
        setSession(ctx, row.id, {
          state: 'RECONCILIATION_REQUIRED',
          paymentState: 'UNRESOLVED',
          providerStatus: authorization.status,
          capturedMinor: null,
          failureReason:
            'PayPal reports the authorization captured, but no capture ID is stored. Review before claiming settlement.',
        });
        mark();
        return { sessionId: row.id, result: 'RECONCILIATION_REQUIRED' };
      }
      if (authorization.status === 'CREATED') {
        setSession(ctx, row.id, { providerStatus: authorization.status });
        mark();
        return { sessionId: row.id, result: 'NO_CHANGE' };
      }
      setSession(ctx, row.id, {
        state: 'RECONCILIATION_REQUIRED',
        paymentState: 'UNRESOLVED',
        providerStatus: authorization.status,
        failureReason: `PayPal authorization status ${authorization.status}. No capture is confirmed.`,
      });
      mark();
      return { sessionId: row.id, result: 'RECONCILIATION_REQUIRED' };
    }
    if (row.paypal_order_id) {
      const order = await paypal.getOrder(row.paypal_order_id);
      setSession(ctx, row.id, { providerStatus: order.status });
      mark();
      return { sessionId: row.id, result: 'NO_CHANGE' };
    }
    return { sessionId: row.id, result: 'NO_CHANGE' };
  } catch (error) {
    appendAudit(
      ctx.store,
      {
        actorType: 'system',
        actorId: 'ambient-webhook',
        action: 'ambient.reconcile_failed',
        subjectType: 'ambient_session',
        subjectId: row.id,
        metadata: { message: (error as Error).message.slice(0, 200) },
      },
      ctx.now(),
    );
    setSession(ctx, row.id, { providerStatus: 'RECONCILE_FAILED' });
    return { sessionId: row.id, result: 'RECONCILE_FAILED' };
  }
}

const PROOF_FINAL_STATES = new Set([
  'CAPTURED',
  'VOID_CONFIRMED',
  'NOT_QUALIFIED',
  'BUYER_REJECTED',
  'EXPIRED',
  'DEMO_COMPLETE',
]);

export async function ambientProof(
  ctx: AppContext,
  sessionId: string,
  actor?: Actor,
  proofIdOverride?: string,
): Promise<AmbientProofView> {
  const row = actor ? requireSessionForActor(ctx, sessionId, actor) : sessionRow(ctx, sessionId);
  const existing = ctx.store.get<AmbientProofRow>('SELECT * FROM ambient_proofs WHERE session_id = ?', row.id);
  if (!existing) {
    if (!PROOF_FINAL_STATES.has(row.state)) {
      throw errors.conflict('PROOF_NOT_READY', 'Finish the window and its financial outcome before generating the Accord proof.');
    }
    if (!row.observation_stopped_at || !row.evaluation_json) {
      throw errors.conflict('PROOF_NOT_READY', 'The observation and evaluation must be complete.');
    }
    const agreement = agreementRow(ctx, row.agreement_id);
    const terms = sessionTerms(row);
    const object = requireAmbientObject(ctx, row.object_id);
    const model = modelRowForAgreement(ctx, agreement);
    const evaluation = JSON.parse(row.evaluation_json) as AmbientEvaluation;
    const acceptance = row.acceptance_json
      ? (JSON.parse(row.acceptance_json) as { accepted?: boolean; acceptedAt?: string })
      : null;
    const now = ctx.now().toISOString();
    const proofId = proofIdOverride ?? newId('apr');
    const payment: AmbientProofPayment = {
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
    const payload: AmbientProofPayload = {
      schema: 'whirr.ambient-proof.v1',
      proofId,
      sessionId: row.id,
      agreementId: agreement.id,
      createdAt: now,
      buyerRef: terms.parties.buyerRef,
      providerRef: terms.parties.providerRef,
      target: { objectId: object.id, objectName: object.name, glyph: object.glyph },
      agreement: {
        id: agreement.id,
        revision: row.agreement_revision,
        hash: row.agreement_hash,
        terms,
      },
      model: modelRef(model),
      session: {
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        authorizedAt: row.authorized_at,
        observationStartedAt: row.observation_started_at,
        observationStoppedAt: row.observation_stopped_at,
        demo: Boolean(row.demo),
        observationMode: row.observation_mode,
      },
      observations: observationRows(ctx, row.id).map(observationFromRow),
      observationsHash: evaluation.observationsHash,
      evaluation,
      evidenceRoot: row.evidence_root ?? evaluation.evidenceRoot,
      consent: {
        buyerAcceptedAt: agreement.buyer_accepted_at ?? row.accepted_at,
        buyerTermsHash: row.agreement_hash,
        providerAcceptedAt: agreement.provider_accepted_at,
        providerTermsHash: agreement.provider_accepted_at ? row.agreement_hash : null,
        humanAcceptance: acceptance,
      },
      payment,
      trust: [
        {
          domain: 'INTEGRITY',
          status: 'CHECKED',
          detail: 'The payload is signed with the installation ECDSA key and the agreement, observations, evaluation, and evidence root are hashed.',
        },
        {
          domain: 'SENSOR_PROVENANCE',
          status: 'NOT_VERIFIABLE_OFFLINE',
          detail: 'The browser reports microphone states and quality flags. The installation binds those claims but cannot prove the microphone or its operator was honest.',
        },
        {
          domain: 'SOURCE_INFERENCE',
          status: 'NOT_VERIFIABLE_OFFLINE',
          detail: 'The proof binds a model digest. The verifier does not retrain or independently reproduce the acoustic model on raw audio.',
        },
        {
          domain: 'TEMPORAL_EVALUATION',
          status: 'CHECKED',
          detail: 'The verifier recomputes the negative-space rule from the exact terms and interval ledger.',
        },
        {
          domain: 'HUMAN_ACCEPTANCE',
          status: acceptance?.accepted === true ? 'CHECKED' : 'NOT_CONFIRMED',
          detail: acceptance?.accepted
            ? 'The buyer accepted the observed result before any capture.'
            : 'No positive buyer acceptance is claimed for this result.',
        },
        {
          domain: 'FINANCIAL_OUTCOME',
          status: payment.providerConfirmed ? 'CHECKED' : 'NOT_CONFIRMED',
          detail: payment.providerConfirmed
            ? 'A provider capture identifier and matching captured amount are present. A verifier still needs PayPal access to confirm the current provider record.'
            : 'No provider-confirmed capture is claimed by this proof.',
        },
        {
          domain: 'REAL_WORLD_TRUTH',
          status: 'NOT_CLAIMED',
          detail: 'The proof does not establish silence, power-off, legal authority, safety, or that the provider caused the condition.',
        },
      ],
      limitations: [
        ...terms.interpretation.limitations,
        'The proof records interval-level non-detection, not raw audio or a sound-level certification.',
        'Only PayPal Sandbox is supported; a sandbox capture is never real money.',
        'The named provider is not necessarily the PayPal merchant; no marketplace split or payout is claimed.',
      ],
      attestation:
        'Whirr attests that this installation produced and signed the stated agreement, interval ledger, deterministic evaluation, consent record, and provider references. It does not attest to microphone honesty, physical silence, legal authority, or the real-world quality of the cooperation.',
    };
    const signed = await ctx.signer.sign('ambient-proof', payload);
    const payloadHash = hashCanonical(payload);
    ctx.store.run(
      `INSERT INTO ambient_proofs (id, session_id, payload_hash, document_json, public_document_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      proofId,
      row.id,
      payloadHash,
      JSON.stringify(signed),
      JSON.stringify(signed),
      now,
    );
  }
  const proof = ctx.store.get<AmbientProofRow>('SELECT * FROM ambient_proofs WHERE session_id = ?', row.id)!;
  const publicDocument = JSON.parse(proof.public_document_json) as unknown;
  const verification = await verifyAmbientProofDocument(publicDocument);
  return {
    id: proof.id,
    sessionId: proof.session_id,
    agreementHash: row.agreement_hash,
    createdAt: proof.created_at,
    document: JSON.parse(proof.document_json) as unknown,
    publicDocument,
    verification,
  };
}

export function publicAmbientProof(ctx: AppContext, proofId: string): AmbientProofView {
  const row = ctx.store.get<AmbientProofRow>('SELECT * FROM ambient_proofs WHERE id = ?', proofId);
  if (!row) throw errors.notFound('Ambient proof not found.');
  const session = sessionRow(ctx, row.session_id);
  return {
    id: row.id,
    sessionId: row.session_id,
    agreementHash: session.agreement_hash,
    createdAt: row.created_at,
    document: JSON.parse(row.document_json) as unknown,
    publicDocument: JSON.parse(row.public_document_json) as unknown,
    verification: {
      valid: false,
      signatureValid: false,
      agreementHashValid: false,
      modelBindingValid: false,
      observationsHashValid: false,
      evidenceRootValid: false,
      evaluationMatches: false,
      consentOrderValid: false,
      paymentConsistent: false,
      checks: [],
      disclaimer: 'Open the verifier endpoint to recompute this public proof.',
    },
  };
}

export async function verifyPublicAmbientProof(ctx: AppContext, proofId: string): Promise<AmbientProofView> {
  const row = ctx.store.get<AmbientProofRow>('SELECT * FROM ambient_proofs WHERE id = ?', proofId);
  if (!row) throw errors.notFound('Ambient proof not found.');
  const session = sessionRow(ctx, row.session_id);
  const publicDocument = JSON.parse(row.public_document_json) as unknown;
  const verification = await verifyAmbientProofDocument(publicDocument);
  return {
    id: row.id,
    sessionId: row.session_id,
    agreementHash: session.agreement_hash,
    createdAt: row.created_at,
    document: JSON.parse(row.document_json) as unknown,
    publicDocument,
    verification,
  };
}

export function ambientProofBySession(ctx: AppContext, sessionId: string, actor?: Actor): Promise<AmbientProofView> {
  return ambientProof(ctx, sessionId, actor);
}

export function listAmbientAgreements(ctx: AppContext, actor: Actor): AmbientAgreementView[] {
  const rows =
    actor.type === 'operator'
      ? ctx.store.all<AmbientAgreementRow>(
          'SELECT * FROM ambient_agreements WHERE provider_id = ? ORDER BY updated_at DESC LIMIT 50',
          actor.id,
        )
      : ctx.store.all<AmbientAgreementRow>(
          'SELECT * FROM ambient_agreements WHERE buyer_id = ? ORDER BY updated_at DESC LIMIT 50',
          actor.id,
        );
  return rows.map((row) => ambientAgreementView(ctx, row, actor));
}

export function ambientCatalog(ctx: AppContext): AmbientCatalogView {
  const rows = ctx.store.all<AmbientAgreementRow>(
    `SELECT * FROM ambient_agreements
     WHERE id = ? OR buyer_id = ?
     ORDER BY created_at DESC LIMIT 30`,
    DEMO_AGREEMENT_ID,
    DEMO_BUYER_ID,
  );
  const items: AmbientCatalogItem[] = [];
  for (const row of rows) {
    const terms = agreementTerms(row);
    const object = requireAmbientObject(ctx, row.object_id);
    const model = modelRowForAgreement(ctx, row);
    const sessions = ctx.store.all<AmbientSessionRow>(
      'SELECT * FROM ambient_sessions WHERE agreement_id = ? ORDER BY created_at DESC',
      row.id,
    );
    const latest = sessions[0] ?? null;
    items.push({
      agreementId: row.id,
      serviceName: terms.serviceName,
      target: objectView(ctx, object),
      model: modelSummary(model),
      termsHash: row.terms_hash,
      fixedPriceMinor: terms.financial.fixedPriceMinor,
      currency: terms.financial.currency,
      requiredInactiveMs: terms.condition.requiredInactiveMs,
      sessionCount: sessions.length,
      qualifiedCount: sessions.filter((session) => session.outcome === 'QUALIFIED').length,
      capturedCount: sessions.filter((session) => Boolean(session.paypal_capture_id)).length,
      latestSessionId: latest?.id ?? null,
      latestOutcome: latest?.outcome ?? null,
      demoOnly: sessions.length > 0 && sessions.every((session) => Boolean(session.demo)),
    });
  }
  const sourceObjects = ctx.store.all<ObjectRow>(
    "SELECT * FROM objects WHERE status = 'ACTIVE' ORDER BY created_at DESC",
  );
  const sources: AmbientSourceView[] = [];
  for (const object of sourceObjects) {
    const source = ambientSourceForObject(ctx, object);
    if (source) sources.push(source);
  }
  return {
    generatedAt: ctx.now().toISOString(),
    items,
    sources,
    sandbox: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
    limitations: [
      'Ambient is a local Sandbox prototype limited to invited participants with legitimate authority over the activity and space.',
      'Microphone classification is evidence under declared conditions, not proof of silence, power-off, safety, or legal compliance.',
      'Synthetic reference histories are labelled and do not establish a physical field trial.',
      'No marketplace split or automatic provider payout is implemented. The configured Sandbox merchant receives any capture.',
      'Only active objects with published terms or a published Physical Promise and a current READY event model appear as Ambient sources.',
    ],
  };
}

export function ambientJudge(ctx: AppContext): AmbientJudgeView {
  const agreement = ctx.store.get<AmbientAgreementRow>('SELECT * FROM ambient_agreements WHERE id = ?', DEMO_AGREEMENT_ID);
  if (!agreement) {
    return {
      available: false,
      generatedAt: ctx.now().toISOString(),
      seed: { agreementId: null, objectId: null, provenance: null, interruptedSessionId: null, qualifiedSessionId: null },
      sessions: [],
      evidence: {
        physicalFieldTrial: 'OPEN_NOT_RUN',
        genuineSandboxCapture: 'OPEN_NOT_RUN',
        webhookDelivery: 'OPEN_NOT_VERIFIED',
        buyerComprehension: 'OPEN_NOT_RUN',
      },
      limitations: ['The Ambient reference seed has not been installed. Run npm run seed:ambient.'],
    };
  }
  const sessions = ctx.store.all<AmbientSessionRow>(
    'SELECT * FROM ambient_sessions WHERE agreement_id = ? ORDER BY created_at ASC',
    DEMO_AGREEMENT_ID,
  );
  const genuineCapture = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM ambient_sessions WHERE demo = 0 AND paypal_capture_id IS NOT NULL",
  );
  const genuineWebhook = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM paypal_webhook_events WHERE verified = 1 AND event_type LIKE 'PAYMENT.CAPTURE.%'",
  );
  const terms = agreementTerms(agreement);
  return {
    available: true,
    generatedAt: ctx.now().toISOString(),
    seed: {
      agreementId: agreement.id,
      objectId: agreement.object_id,
      provenance: terms.eventModel.provenance,
      interruptedSessionId: sessions.find((session) => session.outcome === 'INTERRUPTED')?.id ?? null,
      qualifiedSessionId: sessions.find((session) => session.outcome === 'QUALIFIED')?.id ?? null,
    },
    sessions: sessions.map(sessionSummary),
    evidence: {
      physicalFieldTrial: 'OPEN_NOT_RUN',
      genuineSandboxCapture: (genuineCapture?.count ?? 0) > 0 ? 'OBSERVED' : 'OPEN_NOT_RUN',
      webhookDelivery: (genuineWebhook?.count ?? 0) > 0 ? 'OBSERVED' : 'OPEN_NOT_VERIFIED',
      buyerComprehension: 'OPEN_NOT_RUN',
    },
    limitations: [
      'The seeded failure and success are synthetic reference histories, not a physical appliance field trial.',
      'The seeded sessions use DEMO_NO_PAYMENT. They cannot capture and are not evidence of a Sandbox settlement.',
      'A genuine Sandbox capture requires a human buyer and remains open in this release candidate.',
      'The provider is the operator account; no payout to a separate workshop participant is implemented.',
    ],
  };
}

export function ambientModelDetail(ctx: AppContext, agreementId: string) {
  const agreement = agreementRow(ctx, agreementId);
  const row = modelRowForAgreement(ctx, agreement);
  const artifact = JSON.parse(row.artifact_json) as EventModelArtifact;
  return {
    ...modelSummary(row),
    artifact,
  };
}

export function ambientTermsForSession(ctx: AppContext, sessionId: string): AmbientAgreementTerms {
  return sessionTerms(sessionRow(ctx, sessionId));
}

export function ambientCompilationResult(
  compiled: CompiledAmbientAgreement,
  extraIssues: AmbientCompilationIssue[] = [],
): CompiledAmbientAgreement {
  return {
    ...compiled,
    issues: [...compiled.issues, ...extraIssues],
    executable: compiled.executable && !extraIssues.some((issue) => issue.severity === 'ERROR'),
  };
}

export function ambientInterpretationForAgreement(ctx: AppContext, agreementId: string): AmbientInterpretation {
  return agreementTerms(agreementRow(ctx, agreementId)).interpretation;
}
