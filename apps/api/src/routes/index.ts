import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext, Actor } from '../context.ts';
import type { DisputeRow, SessionRow, UserRow, WebhookEventRow } from '../domain/rows.ts';
import { parseArtifact } from '../domain/rows.ts';
import {
  clearOperatorCookie,
  ensureOperatorUser,
  ensureRenter,
  getOperator,
  getRenter,
  renterRef,
  requestAgentHash,
  requestIpHash,
  requireOperator,
  setOperatorCookie,
} from '../lib/auth.ts';
import { AppError, errors, parseBody } from '../lib/errors.ts';
import { equalsKey } from '../lib/hash.ts';
import { appendAudit } from '../lib/audit.ts';
import {
  addTake,
  createObject,
  deleteTake,
  exampleQuotes,
  listOwnerObjects,
  modelArtifactFor,
  modelSummary,
  ownerObjectView,
  publishTerms,
  purgeCalibration,
  requireObject,
  revokeObject,
  serviceObjectView,
  termsWithHash,
  trainObject,
  activeModel,
  activeTerms,
  setShelfListed,
  setTakeRole,
} from '../domain/objects.ts';
import {
  acceptReview,
  appendIntervals,
  applyCredit,
  approveReview,
  buildSessionView,
  consentSession,
  createSession,
  enableDemoMode,
  listAllSessions,
  openDispute,
  pauseSession,
  requireSession,
  requireSessionForActor,
  resolveDispute,
  resumeSession,
  startSession,
  stopSession,
  sessionModelRow,
  recordPreflight,
  useFairnessReserve,
} from '../domain/sessions.ts';
import {
  authorizeReturnPayment,
  capturePayment,
  createAuthorizationOrder,
  demoComplete,
  getPaymentStatus,
  refundPayment,
  reauthorizePayment,
  voidPayment,
} from '../domain/payments.ts';
import { receiptForSession, redactReceipt, receiptJsonDownload } from '../domain/receipts.ts';
import { passportView } from '../domain/passport.ts';
import { ensureReceiptProof, proofById } from '../domain/proofs.ts';
import { ensureProofBundle, proofBundleForSession, publicProofBundleById } from '../domain/bundles.ts';
import { createHold, releaseHold } from '../domain/holds.ts';
import { listShelf, requireShelfObject } from '../domain/shelf.ts';
import { drainOutbox, ingestWebhook } from '../domain/webhooks.ts';
import { buildJudgeStatus, judgeChecks } from '../domain/judge.ts';
import {
  deleteFieldTrial,
  fieldValidationSummary,
  publicFieldReport,
  submitFieldReport,
  submitFieldTrial,
} from '../domain/field-test.ts';
import { normaliseOrigin } from '../config.ts';
import {
  consentSchema,
  disputeResolveSchema,
  disputeSchema,
  intervalBatchSchema,
  objectCreateSchema,
  objectRevokeSchema,
  operatorCreditSchema,
  operatorLoginSchema,
  pauseSchema,
  preflightSchema,
  refundSchema,
  reviewAcceptSchema,
  shelfListingSchema,
  sessionCreateSchema,
  takeRoleUpdateSchema,
  takeUploadSchema,
  termsPublishSchema,
  fieldTrialUploadSchema,
} from '../../../../packages/contracts/src/schemas.ts';
import type {
  AuthSessionView,
  DisputeView,
  JudgeStatus,
  ServiceView,
} from '../../../../packages/contracts/src/types.ts';

const CSRF_HEADER = 'x-whirr-csrf';

function requireRenterUser(ctx: AppContext, req: FastifyRequest) {
  const renter = getRenter(ctx, req);
  if (!renter) throw errors.unauthorized('Open the service link to create a renter session first.');
  return renter;
}

function actorFor(ctx: AppContext, req: FastifyRequest): Actor {
  const operator = getOperator(ctx, req);
  if (operator) return { type: 'operator', id: operator.id };
  const renter = getRenter(ctx, req);
  if (renter) return { type: 'renter', id: renter.id };
  throw errors.unauthorized('Authentication required');
}

function sessionActor(ctx: AppContext, req: FastifyRequest, id: string): { actor: Actor; session: SessionRow } {
  const actor = actorFor(ctx, req);
  return { actor, session: requireSessionForActor(ctx, id, actor) };
}

function limitRequest(ctx: AppContext, req: FastifyRequest, bucket: string, max: number, windowMs: number): void {
  const result = ctx.limiter.check(`${bucket}:${req.ip}`, max, windowMs);
  if (!result.allowed) throw errors.tooMany();
}

function authView(ctx: AppContext, req: FastifyRequest): AuthSessionView {
  const operator = getOperator(ctx, req);
  const renter = getRenter(ctx, req);
  return {
    operator: Boolean(operator),
    operatorId: operator?.id ?? null,
    displayName: operator?.display_name ?? null,
    renterRef: renter ? renterRef(renter.id) : null,
    paypal: {
      configured: ctx.config.paypal.configured,
      env: 'sandbox',
      webhookConfigured: ctx.config.paypal.webhookConfigured,
    },
    demoMode: ctx.config.demoMode,
  };
}

function requestOrigin(ctx: AppContext, req: FastifyRequest): string {
  const header = req.headers.origin;
  if (typeof header === 'string') {
    const normalised = normaliseOrigin(header);
    if (ctx.config.publicOrigins.includes(normalised)) return normalised;
  }
  return ctx.config.primaryPublicOrigin;
}

function disputeView(row: DisputeRow): DisputeView {
  return {
    id: row.id,
    sessionId: row.session_id,
    intervalIds: JSON.parse(row.interval_ids_json) as string[],
    reason: row.reason,
    reasonCode: (row.reason_code ?? 'OTHER') as DisputeView['reasonCode'],
    status: row.status,
    resolution: row.resolution,
    creditMinor: row.credit_minor,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function receiptReady(session: SessionRow): boolean {
  return ['STOPPED', 'REVIEWED', 'SETTLEMENT_PENDING', 'SETTLED', 'NO_CHARGE', 'DEMO_COMPLETED', 'FAILED'].includes(
    session.state,
  );
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ------------------------------------------------------------------ auth
  app.get('/api/auth/session', async (req) => authView(ctx, req));

  app.post('/api/auth/operator', async (req, reply) => {
    limitRequest(ctx, req, 'operator-login', 10, 5 * 60_000);
    const body = parseBody(operatorLoginSchema, req.body);
    if (!equalsKey(body.key, ctx.config.operatorKey)) {
      appendAudit(ctx.store, {
        actorType: 'system',
        actorId: 'operator-login',
        action: 'operator.login_failed',
        subjectType: 'operator',
        subjectId: 'unknown',
        metadata: { ip: requestIpHash(req, ctx.config.cookieSecret) },
      }, ctx.now());
      throw errors.unauthorized('Operator key is not valid.');
    }
    const operator = ensureOperatorUser(ctx);
    setOperatorCookie(ctx, reply, operator.id);
    appendAudit(ctx.store, {
      actorType: 'operator',
      actorId: operator.id,
      action: 'operator.login',
      subjectType: 'operator',
      subjectId: operator.id,
      metadata: { ip: requestIpHash(req, ctx.config.cookieSecret) },
    }, ctx.now());
    return {
      ok: true,
      operator: { id: operator.id, displayName: operator.display_name },
      paypal: {
        configured: ctx.config.paypal.configured,
        env: 'sandbox',
        webhookConfigured: ctx.config.paypal.webhookConfigured,
      },
      demoMode: ctx.config.demoMode,
    };
  });

  app.post('/api/auth/operator/logout', async (req, reply) => {
    clearOperatorCookie(ctx, reply);
    return { ok: true, authenticated: false };
  });

  app.post('/api/auth/renter', async (req, reply) => {
    limitRequest(ctx, req, 'renter-create', 10, 60_000);
    const renter = ensureRenter(ctx, req, reply);
    return { renterRef: renterRef(renter.id), createdAt: renter.created_at };
  });

  // ---------------------------------------------------------------- health
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'whirr',
    uptimeSeconds: Math.round(process.uptime()),
    paypal: { configured: ctx.config.paypal.configured, env: 'sandbox', webhookConfigured: ctx.config.paypal.webhookConfigured },
    demoMode: ctx.config.demoMode,
  }));

  // --------------------------------------------------------------- public
  app.get('/api/service/:objectId', async (req) => {
    const { objectId } = req.params as { objectId: string };
    const object = requireObject(ctx, objectId);
    const modelRow = activeModel(ctx, object);
    const termsRow = activeTerms(ctx, object);
    if (!modelRow || !termsRow) throw errors.notFound('This service card is not published yet.');
    const terms = termsWithHash(termsRow);
    const active = ctx.store.get<{ id: string }>(
      "SELECT id FROM sessions WHERE object_id = ? AND state IN ('READY','ACTIVE','PAUSED') LIMIT 1",
      object.id,
    );
    const owner = ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id);
    const view: ServiceView = {
      object: serviceObjectView(object, owner ?? null),
      terms,
      termsHash: termsRow.terms_hash,
      model: modelSummary(modelRow),
      activeSession: Boolean(active),
      sandbox: {
        configured: ctx.config.paypal.configured,
        env: 'sandbox',
        webhookConfigured: ctx.config.paypal.webhookConfigured,
      },
      example: exampleQuotes(terms),
      fieldValidation: fieldValidationSummary(ctx, modelRow),
      limitations: parseArtifact(modelRow).limitations,
      privacy: [
        'Audio is processed on this device. Only acoustic features and state intervals are sent to the local Whirr server; raw audio is never uploaded or stored.',
        'The microphone is opened only after you explicitly start sensing, and stops on pause, stop, tab hide or permission loss.',
        'Ambiguous or low-quality audio is marked UNCERTAIN and excluded from the bill by default.',
        'This supervised, audio-only meter can be fooled by playback or a similar machine. Whirr does not physically lock the object or secure an unattended venue.',
      ],
    };
    return view;
  });

  app.get('/api/passport/:objectId', async (req) => {
    const { objectId } = req.params as { objectId: string };
    const object = requireObject(ctx, objectId);
    const modelRow = activeModel(ctx, object);
    if (!modelRow) throw errors.notFound('This object has no acoustic passport yet.');
    return passportView(ctx, object);
  });

  app.get('/api/passport/:objectId/proof', async (req, reply) => {
    const { objectId } = req.params as { objectId: string };
    const object = requireObject(ctx, objectId);
    const view = await passportView(ctx, object);
    if (!view.signedPassport) throw errors.notFound('This passport is not signed.');
    reply.header('Content-Disposition', `attachment; filename="whirr-passport-${object.id}.json"`);
    reply.type('application/json; charset=utf-8');
    return reply.send(`${JSON.stringify(view.signedPassport, null, 2)}\n`);
  });

  app.get('/api/shelf', async () => listShelf(ctx));

  app.post('/api/objects/:objectId/hold', async (req, reply) => {
    limitRequest(ctx, req, 'hold-create', 20, 60_000);
    const { objectId } = req.params as { objectId: string };
    const renter = ensureRenter(ctx, req, reply);
    const object = requireShelfObject(ctx, objectId);
    reply.code(201);
    return { hold: createHold(ctx, renter, object) };
  });

  app.delete('/api/objects/:objectId/hold', async (req, reply) => {
    const { objectId } = req.params as { objectId: string };
    const renter = ensureRenter(ctx, req, reply);
    releaseHold(ctx, renter, requireShelfObject(ctx, objectId));
    return { ok: true };
  });

  app.get('/api/judge/status', async (req): Promise<JudgeStatus> => {
    limitRequest(ctx, req, 'judge', 60, 60_000);
    return buildJudgeStatus(ctx);
  });

  // ------------------------------------------------------- operator objects
  app.get('/api/operator/objects', async (req) => {
    const operator = requireOperator(ctx, req);
    return {
      objects: listOwnerObjects(ctx, operator.id),
      operator: { id: operator.id, displayName: operator.display_name ?? 'Operator' },
      paypal: {
        configured: ctx.config.paypal.configured,
        env: 'sandbox',
        webhookConfigured: ctx.config.paypal.webhookConfigured,
      },
      demoMode: ctx.config.demoMode,
    };
  });

  app.post('/api/operator/objects', async (req, reply) => {
    const operator = requireOperator(ctx, req);
    const body = parseBody(objectCreateSchema, req.body);
    const view = createObject(ctx, operator, body);
    reply.code(201);
    return view;
  });

  app.get('/api/operator/objects/:id', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const object = requireObject(ctx, id, operator.id);
    return ownerObjectView(ctx, object);
  });

  app.get('/api/operator/objects/:id/model-artifact', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const object = requireObject(ctx, id, operator.id);
    const row = activeModel(ctx, object);
    if (!row) throw errors.notFound('No trained model exists for this object yet.');
    return { artifact: parseArtifact(row), modelId: row.id, modelVersion: row.version, modelHash: row.model_hash };
  });

  app.post('/api/operator/objects/:id/revoke', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(objectRevokeSchema, req.body);
    return revokeObject(ctx, operator, id, body.revoked);
  });

  app.post('/api/operator/objects/:id/shelf', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(shelfListingSchema, req.body);
    return setShelfListed(ctx, operator, id, body.listed);
  });

  app.post('/api/operator/objects/:id/takes', async (req, reply) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(takeUploadSchema, req.body);
    const take = addTake(ctx, operator, id, body);
    reply.code(201);
    return { take };
  });

  app.delete('/api/operator/objects/:id/takes/:takeId', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id, takeId } = req.params as { id: string; takeId: string };
    deleteTake(ctx, operator, id, takeId);
    return { ok: true };
  });

  app.put('/api/operator/objects/:id/takes/:takeId/role', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id, takeId } = req.params as { id: string; takeId: string };
    const body = parseBody(takeRoleUpdateSchema, req.body);
    return { take: setTakeRole(ctx, operator, id, takeId, body.role as 'TRAINING' | 'VALIDATION') };
  });

  app.post('/api/operator/objects/:id/purge-calibration', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    purgeCalibration(ctx, operator, id);
    return { ok: true };
  });

  app.post('/api/operator/objects/:id/train', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    limitRequest(ctx, req, 'train', 10, 60_000);
    const result = trainObject(ctx, operator, id);
    const object = requireObject(ctx, id, operator.id);
    return { ...result, object: ownerObjectView(ctx, object) };
  });

  app.get('/api/operator/objects/:id/field-test', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const object = requireObject(ctx, id, operator.id);
    return ownerObjectView(ctx, object).fieldTest;
  });

  app.post('/api/operator/objects/:id/field-trials', async (req, reply) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    limitRequest(ctx, req, 'field-trial', 30, 60_000);
    const body = parseBody(fieldTrialUploadSchema, req.body);
    const result = submitFieldTrial(ctx, operator, id, body);
    reply.code(201);
    return result;
  });

  app.delete('/api/operator/objects/:id/field-trials/:trialId', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id, trialId } = req.params as { id: string; trialId: string };
    return { fieldTest: deleteFieldTrial(ctx, operator, id, trialId) };
  });

  app.post('/api/operator/objects/:id/field-report', async (req, reply) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    limitRequest(ctx, req, 'field-report', 10, 60_000);
    const result = submitFieldReport(ctx, operator, id);
    reply.code(201);
    return result;
  });

  app.get('/api/field-reports/:id', async (req) => {
    limitRequest(ctx, req, 'field-report-public', 60, 60_000);
    const { id } = req.params as { id: string };
    return publicFieldReport(ctx, id);
  });

  app.put('/api/operator/objects/:id/terms', async (req, reply) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(termsPublishSchema, req.body);
    const result = publishTerms(ctx, operator, id, body);
    reply.code(201);
    return { ...result, object: ownerObjectView(ctx, requireObject(ctx, id, operator.id)) };
  });

  // -------------------------------------------------------- operator review
  app.get('/api/operator/overview', async (req) => {
    const operator = requireOperator(ctx, req);
    const disputes = ctx.store
      .all<DisputeRow>('SELECT * FROM disputes ORDER BY created_at DESC LIMIT 100')
      .map(disputeView);
    const webhooks = ctx.store.all<WebhookEventRow>(
      'SELECT * FROM paypal_webhook_events ORDER BY received_at DESC LIMIT 25',
    );
    const audit = ctx.store.all<{ id: string; action: string; created_at: string; hash: string }>(
      'SELECT id, action, created_at, hash FROM audit_events ORDER BY seq DESC LIMIT 25',
    );
    return {
      objects: listOwnerObjects(ctx, operator.id),
      sessions: listAllSessions(ctx),
      disputes,
      paypal: {
        configured: ctx.config.paypal.configured,
        env: 'sandbox',
        webhookConfigured: ctx.config.paypal.webhookConfigured,
      },
      webhooks: webhooks.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        verified: Boolean(row.verified),
        receivedAt: row.received_at,
        processedAt: row.processed_at,
        result: row.result,
      })),
      audit: audit.map((row) => ({ id: row.id, action: row.action, createdAt: row.created_at, hash: row.hash })),
      selfCheck: judgeChecks(ctx),
    };
  });

  app.post('/api/operator/sessions/:id/approve-review', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    return approveReview(ctx, operator, id);
  });

  app.post('/api/operator/sessions/:id/credit', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(operatorCreditSchema, req.body);
    return applyCredit(ctx, operator, id, body.creditMinor, body.reason);
  });

  app.post('/api/operator/sessions/:id/refund', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(refundSchema, req.body);
    return refundPayment(ctx, operator.id, id, body.amountMinor);
  });

  app.post('/api/operator/disputes/:id/resolve', async (req) => {
    const operator = requireOperator(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(disputeResolveSchema, req.body);
    return resolveDispute(ctx, operator, id, body);
  });

  app.post('/api/operator/outbox/drain', async (req) => {
    requireOperator(ctx, req);
    limitRequest(ctx, req, 'outbox-drain', 20, 60_000);
    const processed = await drainOutbox(ctx);
    return { processed };
  });

  // ---------------------------------------------------------------- renter
  app.post('/api/sessions', async (req, reply) => {
    limitRequest(ctx, req, 'session-create', 10, 60_000);
    const body = parseBody(sessionCreateSchema, req.body);
    const renter = ensureRenter(ctx, req, reply);
    const view = createSession(ctx, renter, body.objectId);
    reply.code(201);
    return view;
  });

  app.get('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { actor, session } = sessionActor(ctx, req, id);
    return buildSessionView(ctx, session, actor);
  });

  app.get('/api/sessions/:id/model', async (req) => {
    const { id } = req.params as { id: string };
    const { actor, session } = sessionActor(ctx, req, id);
    const row = sessionModelRow(ctx, session);
    const artifact = modelArtifactFor(ctx, row.id);
    return {
      artifact,
      sessionToken: buildSessionView(ctx, session, actor).sessionToken,
      modelVersion: row.version,
      modelHash: session.model_hash,
      termsHash: session.terms_hash,
    };
  });

  app.post('/api/sessions/:id/consent', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    const body = parseBody(consentSchema, req.body);
    return consentSession(
      ctx,
      renter,
      id,
      body,
      requestIpHash(req, ctx.config.cookieSecret),
      requestAgentHash(req, ctx.config.cookieSecret),
      body.displayName,
    );
  });

  app.post('/api/sessions/:id/demo-mode', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return enableDemoMode(ctx, renter, id);
  });

  app.post('/api/sessions/:id/preflight', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    const body = parseBody(preflightSchema, req.body);
    return recordPreflight(ctx, renter, id, body);
  });

  app.post('/api/sessions/:id/fairness-reserve', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return useFairnessReserve(ctx, renter, id);
  });

  app.post('/api/sessions/:id/paypal/order', async (req) => {
    limitRequest(ctx, req, 'paypal-order', 20, 60_000);
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return createAuthorizationOrder(ctx, renter.id, id, requestOrigin(ctx, req));
  });

  app.post('/api/sessions/:id/paypal/authorize', async (req) => {
    limitRequest(ctx, req, 'paypal-authorize', 20, 60_000);
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return authorizeReturnPayment(ctx, renter.id, id);
  });

  app.post('/api/sessions/:id/paypal/reauthorize', async (req) => {
    limitRequest(ctx, req, 'paypal-reauthorize', 10, 60_000);
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return reauthorizePayment(ctx, { type: 'renter', id: renter.id }, id, requestOrigin(ctx, req));
  });

  app.get('/api/sessions/:id/paypal/status', async (req) => {
    limitRequest(ctx, req, 'paypal-status', 60, 60_000);
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    // A GET is a safe read. Reconciliation performs provider and local state
    // changes, so it has an explicit POST endpoint protected by CSRF.
    return getPaymentStatus(ctx, actor, id, false);
  });

  app.post('/api/sessions/:id/paypal/reconcile', async (req) => {
    limitRequest(ctx, req, 'paypal-reconcile', 30, 60_000);
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    return getPaymentStatus(ctx, actor, id, true);
  });

  app.post('/api/sessions/:id/start', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return startSession(ctx, renter, id);
  });

  app.post('/api/sessions/:id/pause', async (req) => {
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    const body = parseBody(pauseSchema, req.body);
    return pauseSession(ctx, actor, id, body.reason);
  });

  app.post('/api/sessions/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    return resumeSession(ctx, actor, id);
  });

  app.post('/api/sessions/:id/intervals', async (req) => {
    limitRequest(ctx, req, 'intervals', 300, 60_000);
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    const body = parseBody(intervalBatchSchema, req.body);
    return appendIntervals(ctx, renter, id, body);
  });

  app.post('/api/sessions/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    return stopSession(ctx, actor, id);
  });

  app.post('/api/sessions/:id/review/accept', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    const body = parseBody(reviewAcceptSchema, req.body);
    return acceptReview(ctx, renter, id, body);
  });

  app.post('/api/sessions/:id/capture', async (req) => {
    limitRequest(ctx, req, 'capture', 20, 60_000);
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    return capturePayment(ctx, actor, id);
  });

  app.post('/api/sessions/:id/void', async (req) => {
    limitRequest(ctx, req, 'void', 20, 60_000);
    const { id } = req.params as { id: string };
    const { actor } = sessionActor(ctx, req, id);
    return voidPayment(ctx, actor, id);
  });

  app.post('/api/sessions/:id/demo-complete', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    return demoComplete(ctx, renter.id, id);
  });

  app.post('/api/sessions/:id/disputes', async (req) => {
    const { id } = req.params as { id: string };
    const renter = requireRenterUser(ctx, req);
    const body = parseBody(disputeSchema, req.body);
    return openDispute(ctx, renter, id, body);
  });

  app.get('/api/sessions/:id/receipt', async (req) => {
    limitRequest(ctx, req, 'receipt', 60, 60_000);
    const { id } = req.params as { id: string };
    const { actor, session } = sessionActor(ctx, req, id);
    if (!receiptReady(session)) {
      throw errors.conflict('RECEIPT_NOT_READY', 'Stop the session before requesting a receipt.');
    }
    const result = receiptForSession(ctx, session);
    return { ...result, session: buildSessionView(ctx, session, actor) };
  });

  app.get('/api/sessions/:id/proof', async (req) => {
    const { id } = req.params as { id: string };
    const { session } = sessionActor(ctx, req, id);
    if (!receiptReady(session)) throw errors.conflict('RECEIPT_NOT_READY', 'Stop the session before requesting a proof.');
    const result = receiptForSession(ctx, session);
    return ensureReceiptProof(ctx, session, result.receipt);
  });

  app.get('/api/sessions/:id/bundle', async (req) => {
    limitRequest(ctx, req, 'bundle', 30, 60_000);
    const { id } = req.params as { id: string };
    const { session } = sessionActor(ctx, req, id);
    if (!receiptReady(session)) throw errors.conflict('RECEIPT_NOT_READY', 'Stop the session before requesting a proof bundle.');
    const { receipt } = receiptForSession(ctx, session);
    return (await ensureProofBundle(ctx, session, receipt)).authenticated;
  });

  app.get('/api/proofs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const proof = proofById(ctx, id);
    if (!proof) throw errors.notFound('Proof not found');
    return proof;
  });

  app.get('/api/proof-bundles/:id', async (req) => {
    limitRequest(ctx, req, 'public-bundle', 60, 60_000);
    const { id } = req.params as { id: string };
    const bundle = publicProofBundleById(ctx, id);
    if (!bundle) throw errors.notFound('Proof bundle not found');
    return bundle;
  });

  app.get('/api/sessions/:id/report', async (req) => {
    const { id } = req.params as { id: string };
    const { session } = sessionActor(ctx, req, id);
    const row = ctx.store.get<{ report_json: string }>(
      'SELECT report_json FROM session_sensor_reports WHERE session_id = ?',
      session.id,
    );
    if (!row) throw errors.notFound('No diagnostic report exists for this session.');
    return JSON.parse(row.report_json) as unknown;
  });

  app.get('/api/sessions/:id/receipt/verify', async (req) => {
    const { id } = req.params as { id: string };
    const { session } = sessionActor(ctx, req, id);
    if (!receiptReady(session)) throw errors.conflict('RECEIPT_NOT_READY', 'Stop the session first.');
    return receiptForSession(ctx, session).verification;
  });

  app.get('/api/sessions/:id/receipt/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { session } = sessionActor(ctx, req, id);
    if (!receiptReady(session)) throw errors.conflict('RECEIPT_NOT_READY', 'Stop the session first.');
    const query = req.query as { redacted?: string };
    const { receipt } = receiptForSession(ctx, session);
    const output = query.redacted === '1' ? redactReceipt(receipt) : receipt;
    reply.header('Content-Disposition', `attachment; filename="whirr-receipt-${session.id.slice(-8)}.json"`);
    reply.type('application/json; charset=utf-8');
    return reply.send(receiptJsonDownload(output));
  });

  // --------------------------------------------------------------- webhook
  app.post(
    '/api/paypal/webhook',
    { bodyLimit: 256 * 1024 },
    async (req, reply) => {
      limitRequest(ctx, req, 'webhook', 60, 60_000);
      const contentType = String(req.headers['content-type'] ?? '');
      if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'PayPal webhooks must be application/json');
      }
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody;
      if (!raw) throw errors.badRequest('Raw webhook body is required for signature verification');
      const result = await ingestWebhook(ctx, raw, req.headers);
      reply.code(200);
      return result;
    },
  );

  // --------------------------------------------------------------- fallback
  app.get('/api/judge/checks', async (req) => {
    limitRequest(ctx, req, 'judge-checks', 60, 60_000);
    return { checks: judgeChecks(ctx) };
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'API endpoint not found' } });
      return;
    }
    if (ctx.config.serveStatic) {
      reply.type('text/html; charset=utf-8').sendFile('index.html');
      return;
    }
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Frontend build not found. Run `npm run build`, or use the Vite dev server at http://localhost:5173.',
      },
    });
  });
}

export { CSRF_HEADER };
