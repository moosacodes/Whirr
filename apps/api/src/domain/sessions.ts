import type { Actor, AppContext } from '../context.ts';
import type {
  ConsentRow,
  DisputeRow,
  IntervalRow,
  ModelRow,
  ObjectRow,
  SessionRow,
  TermsRow,
  UserRow,
} from './rows.ts';
import { parseArtifact, parseTerms } from './rows.ts';
import { activeModel, activeTerms, getObject, getModel, getTerms } from './objects.ts';
import { newId } from '../lib/ids.ts';
import { hashCanonical, signSessionToken, verifySessionToken } from '../lib/hash.ts';
import { errors } from '../lib/errors.ts';
import { appendAudit } from '../lib/audit.ts';
import { renterRef } from '../lib/auth.ts';
import { isSafeSandboxApprovalUrl } from '../../../../packages/paypal/src/client.ts';
import { quoteBreakdown } from '../../../../packages/meter/src/pricing.ts';
import { summariseIntervals, type RawInterval } from '../../../../packages/meter/src/intervals.ts';
import type {
  DisputeView,
  IntervalExplanation,
  IntervalView,
  PreflightSummary,
  PreflightView,
  QuoteView,
  SensorReport,
  SessionListItem,
  SessionView,
} from '../../../../packages/contracts/src/types.ts';
import { assertHoldAvailable, consumeHold } from './holds.ts';
import { bundlePaymentTimeline } from './bundles.ts';
import type { z } from 'zod';
import type {
  consentSchema,
  disputeSchema,
  intervalBatchSchema,
  reviewAcceptSchema,
} from '../../../../packages/contracts/src/schemas.ts';

const SESSION_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const CLOCK_SKEW_GRACE_MS = 5_000;
const MAX_ACTIVE_CLOCK_GRACE_MS = 1_500;

function authorizationExpired(session: SessionRow, now: Date): boolean {
  return Boolean(session.authorization_expires_at && Date.parse(session.authorization_expires_at) <= now.getTime());
}

type ConsentInput = z.infer<typeof consentSchema>;
type IntervalBatch = z.infer<typeof intervalBatchSchema>;
type ReviewAccept = z.infer<typeof reviewAcceptSchema>;
type DisputeInput = z.infer<typeof disputeSchema>;

export function getSession(ctx: AppContext, id: string): SessionRow | undefined {
  return ctx.store.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
}

export function requireSession(ctx: AppContext, id: string): SessionRow {
  const session = getSession(ctx, id);
  if (!session) throw errors.notFound('Session not found');
  return session;
}

export function requireSessionForActor(ctx: AppContext, id: string, actor: Actor): SessionRow {
  const session = requireSession(ctx, id);
  if (actor.type === 'operator') return session;
  if (session.renter_id !== actor.id) throw errors.notFound('Session not found');
  return session;
}

function parseTime(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

export function computeMeterClockMs(session: SessionRow, now: Date): number {
  if (!session.started_at) return 0;
  const start = parseTime(session.started_at);
  let end = now.getTime();
  if (session.state === 'PAUSED' && session.paused_at) end = parseTime(session.paused_at);
  else if (session.stopped_at) end = parseTime(session.stopped_at);
  const paused = session.paused_total_ms;
  return Math.max(0, Math.round(end - start - paused));
}

export function intervalEvidenceHash(
  sessionId: string,
  seq: number,
  interval: {
    startMs: number;
    endMs: number;
    state: string;
    modelVersion: string;
    confidence: number;
    qualityFlags: string[];
    explanation?: IntervalExplanation;
  },
): string {
  return hashCanonical({
    schema: interval.explanation ? 'whirr.interval.v2' : 'whirr.interval.v1',
    sessionId,
    seq,
    startMs: interval.startMs,
    endMs: interval.endMs,
    state: interval.state,
    modelVersion: interval.modelVersion,
    confidenceBucket: Math.round(interval.confidence * 1000) / 1000,
    qualityFlags: [...interval.qualityFlags].sort(),
    ...(interval.explanation ? { explanation: interval.explanation } : {}),
  });
}

export function evidenceRoot(
  session: SessionRow,
  intervals: IntervalRow[],
  totals: { billableMs: number },
): string {
  return hashCanonical({
    schema: 'whirr.evidence.v1',
    sessionId: session.id,
    termsHash: session.terms_hash,
    modelHash: session.model_hash,
    intervals: [...intervals]
      .sort((a, b) => a.seq - b.seq)
      .map((row) => ({
        seq: row.seq,
        startMs: row.start_ms,
        endMs: row.end_ms,
        state: row.state,
        evidenceHash: row.evidence_hash,
      })),
    billableMs: totals.billableMs,
  });
}

export function loadIntervals(ctx: AppContext, sessionId: string): IntervalRow[] {
  return ctx.store.all<IntervalRow>(
    'SELECT * FROM observed_intervals WHERE session_id = ? ORDER BY seq ASC',
    sessionId,
  );
}

export function intervalRowsToRaw(rows: IntervalRow[]): RawInterval[] {
  return rows.map((row) => ({
    id: row.id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    state: row.state,
    confidence: row.confidence,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
    modelVersion: row.model_version,
  }));
}

export function liveSummary(ctx: AppContext, session: SessionRow): ReturnType<typeof summariseIntervals> {
  return summariseIntervals(intervalRowsToRaw(loadIntervals(ctx, session.id)));
}

export function currentQuote(session: SessionRow, billableMs: number): QuoteView {
  const breakdown = quoteBreakdown(
    session.minor_per_minute,
    billableMs,
    session.cap_minor,
    session.credit_minor,
    session.currency,
  );
  return {
    billableMs,
    baseQuoteMinor: breakdown.cappedMinor + breakdown.creditMinor,
    creditMinor: breakdown.creditMinor,
    quoteMinor: breakdown.finalMinor,
    capMinor: session.cap_minor,
    currency: session.currency,
    quoteHash: '',
    formula: breakdown.formula,
  };
}

export function quoteHashFor(input: {
  sessionId: string;
  termsHash: string;
  modelHash: string;
  billableMs: number;
  baseQuoteMinor: number;
  creditMinor: number;
  quoteMinor: number;
  currency: string;
  segments: Array<{ startMs: number; endMs: number }>;
}): string {
  return hashCanonical({
    schema: 'whirr.quote.v1',
    ...input,
    segments: input.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs })),
  });
}

function openDisputes(ctx: AppContext, sessionId: string): number {
  const row = ctx.store.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM disputes WHERE session_id = ? AND status = 'OPEN'",
    sessionId,
  );
  return row?.count ?? 0;
}

function disputesFor(ctx: AppContext, sessionId: string): DisputeRow[] {
  return ctx.store.all<DisputeRow>(
    'SELECT * FROM disputes WHERE session_id = ? ORDER BY created_at ASC',
    sessionId,
  );
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

function intervalView(row: IntervalRow): IntervalView {
  return {
    id: row.id,
    seq: row.seq,
    startMs: row.start_ms,
    endMs: row.end_ms,
    state: row.state,
    modelVersion: row.model_version,
    confidence: row.confidence,
    qualityFlags: JSON.parse(row.quality_flags_json) as string[],
    evidenceHash: row.evidence_hash,
    ...(row.explanation_json ? { explanation: JSON.parse(row.explanation_json) as IntervalExplanation } : {}),
  };
}

function preflightView(ctx: AppContext, sessionId: string): PreflightView | null {
  const row = ctx.store.get<{ summary_json: string; created_at: string }>(
    'SELECT summary_json, created_at FROM session_preflights WHERE session_id = ?',
    sessionId,
  );
  if (!row) return null;
  return { ...(JSON.parse(row.summary_json) as Omit<PreflightView, 'sessionId' | 'createdAt'>), sessionId, createdAt: row.created_at };
}

export function recordPreflight(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: Omit<PreflightView, 'sessionId' | 'createdAt'>,
): PreflightView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (session.state !== 'READY' && session.state !== 'CREATED' && session.state !== 'CONSENTED') {
    throw errors.conflict('PREFLIGHT_CLOSED', 'A preflight can only be recorded before sensing starts.');
  }
  const createdAt = ctx.now().toISOString();
  const summary = classifyPreflight(input);
  const capture = input.capture
    ? {
        ...input.capture,
        claimedAt: input.capture.claimedAt || createdAt,
        note:
          input.capture.provenance === 'CLIENT_CLAIMED_LIVE_MICROPHONE'
            ? 'Client claims this capture came from a live microphone. This is signed testimony, not physical proof.'
            : input.capture.note,
      }
    : undefined;
  const storedSummary = { ...summary, ...(capture ? { capture } : {}) };
  ctx.store.run(
    `INSERT INTO session_preflights (session_id, status, summary_json, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, summary_json = excluded.summary_json, created_at = excluded.created_at`,
    session.id,
    summary.status,
    JSON.stringify(storedSummary),
    createdAt,
  );
  if (capture) {
    ctx.store.run('UPDATE sessions SET capture_claim_json = ? WHERE id = ?', JSON.stringify(capture), session.id);
  }
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.preflight_recorded',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { status: summary.status, frameCount: summary.frameCount, clippedRatio: summary.clippedRatio, silentRatio: summary.silentRatio },
  }, ctx.now());
  return { ...storedSummary, sessionId: session.id, createdAt };
}

/**
 * The server classifies the room check from the measured summary rather than
 * trusting a client-supplied verdict. A missing signal or an unstable level is
 * severe enough to block a billable session; ordinary room noise only warns.
 */
function classifyPreflight(input: Omit<PreflightView, 'sessionId' | 'createdAt'>): PreflightSummary {
  const flags = [...new Set(input.flags)];
  let status: PreflightSummary['status'] = 'READY';
  let detail = 'The room has enough stable signal to begin. The microphone is still opened only after you press start.';
  if (input.frameCount < 5 || input.noiseFloorLogRms === null || input.silentRatio >= 0.8) {
    status = 'NO_SIGNAL';
    detail = 'Almost no usable signal reached the microphone. Check the input device and try again before sensing.';
  } else if (input.clippedRatio >= 0.2 || input.levelVariance >= 0.08) {
    status = 'UNSTABLE';
    detail = 'The input is clipping or its level is jumping too much to meter reliably. Move the microphone or lower the gain.';
  } else if (input.noiseFloorLogRms >= -1.6 || input.silentRatio >= 0.45) {
    status = 'NOISY';
    detail = 'The room is noisy or unusually quiet. You may continue, but ambiguous time will remain unbilled.';
  }
  return {
    status,
    frameCount: input.frameCount,
    durationMs: input.durationMs,
    noiseFloorLogRms: input.noiseFloorLogRms,
    levelVariance: input.levelVariance,
    clippedRatio: input.clippedRatio,
    silentRatio: input.silentRatio,
    flags,
    detail,
  };
}

export function buildSessionView(ctx: AppContext, session: SessionRow, actor: Actor): SessionView {
  const object = getObject(ctx.store, session.object_id);
  if (!object) throw errors.internal('Session object missing');
  const model = getModel(ctx, session.model_version_id);
  if (!model) throw errors.internal('Session model missing');
  const terms = getTerms(ctx, session.terms_id);
  if (!terms) throw errors.internal('Session terms missing');
  const artifact = parseArtifact(model);
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const disputes = disputesFor(ctx, session.id).map(disputeView);
  const termsParsed = parseTerms(terms);
  const fairnessApplied = ctx.store.get<{ amount_minor: number }>(
    'SELECT amount_minor FROM fairness_credits WHERE session_id = ?',
    session.id,
  );
  const fairnessReserveMinor = termsParsed.fairnessReserveMinor ?? 0;
  const open = disputes.filter((d) => d.status === 'OPEN').length;
  const quote = currentQuote(session, summary.billableMs);
  const quoteHash =
    session.quote_hash ??
    quoteHashFor({
      sessionId: session.id,
      termsHash: session.terms_hash,
      modelHash: session.model_hash,
      billableMs: quote.billableMs,
      baseQuoteMinor: quote.baseQuoteMinor,
      creditMinor: quote.creditMinor,
      quoteMinor: quote.quoteMinor,
      currency: session.currency,
      segments: summary.mergedBillable,
    });
  const token = signSessionToken(
    {
      sid: session.id,
      rid: session.renter_id,
      th: session.terms_hash,
      mh: session.model_hash,
      exp: ctx.now().getTime() + SESSION_TOKEN_TTL_MS,
    },
    ctx.config.cookieSecret,
  );
  const isOperator = actor.type === 'operator';
  const authorizationExpired = Boolean(
    session.authorization_expires_at && Date.parse(session.authorization_expires_at) <= ctx.now().getTime()
  );
  const paymentReady =
    (session.payment_state === 'AUTHORIZED' && !authorizationExpired) || session.payment_state === 'DEMO_MODE';
  const approved =
    session.review_mode === 'AUTO' || Boolean(session.operator_approved_at);
  const canCapture =
    session.quote_minor > 0 &&
    session.payment_state === 'AUTHORIZED' &&
    session.state === 'REVIEWED' &&
    Boolean(session.reviewed_quote_hash) &&
    session.reviewed_quote_hash === session.quote_hash &&
    approved &&
    !session.captured_minor;
  const awaitingOperator =
    session.review_mode === 'OPERATOR_REQUIRED' &&
    session.state === 'REVIEWED' &&
    !session.operator_approved_at;

  const view: SessionView = {
    id: session.id,
    objectId: object.id,
    objectName: object.name,
    objectGlyph: object.glyph,
    objectPhotoDataUrl: object.photo_data_url,
    ownerLabel: ctx.store.get<UserRow>('SELECT * FROM users WHERE id = ?', object.owner_id)?.display_name ?? 'Whirr operator',
    state: session.state,
    paymentState: session.payment_state,
    reviewMode: session.review_mode,
    terms: termsParsed,
    termsHash: session.terms_hash,
    model: {
      id: model.id,
      version: model.version,
      hash: session.model_hash,
      status: model.status,
      metrics: {
        status: model.status,
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
      soundprint: artifact.soundprint ?? null,
    },
    consentRequired: !session.consented_at,
    consentedAt: session.consented_at,
    createdAt: session.created_at,
    startedAt: session.started_at,
    stoppedAt: session.stopped_at,
    reviewedAt: session.reviewed_at,
    operatorApprovedAt: session.operator_approved_at,
    reviewedQuoteHash: session.reviewed_quote_hash,
    meterClockMs: computeMeterClockMs(session, ctx.now()),
    billableMs: summary.billableMs,
    excludedMs: summary.uncertainMs + summary.disconnectedMs,
    observedMs: summary.observedMs,
    idleMs: summary.idleMs,
    disconnectedMs: summary.disconnectedMs,
    quote: { ...quote, quoteHash },
    approvedCapMinor: session.cap_minor,
    paypal: {
      orderId: session.paypal_order_id,
      authorizationId: session.paypal_authorization_id,
      captureId: session.paypal_capture_id,
      providerStatus: session.provider_status,
      approveUrl:
        session.paypal_order_id &&
        session.payment_state === 'ORDER_CREATED' &&
        session.paypal_approve_url &&
        isSafeSandboxApprovalUrl(session.paypal_approve_url)
          ? session.paypal_approve_url
          : null,
    },
    sandbox: { configured: ctx.config.paypal.configured, env: 'sandbox' },
    intervals: intervals.map(intervalView),
    disputes,
    evidenceHash: session.evidence_hash,
    sensorMode: session.sensor_mode,
    authorizationExpiresAt: session.authorization_expires_at,
    authorizationExpired: Boolean(
      session.authorization_expires_at && Date.parse(session.authorization_expires_at) <= ctx.now().getTime()
    ),
    captureClaim: session.capture_claim_json
      ? (JSON.parse(session.capture_claim_json) as import('../../../../packages/contracts/src/types.ts').CaptureClaim)
      : null,
    proofBundleId:
      ctx.store.get<{ id: string }>('SELECT id FROM proof_bundles WHERE session_id = ?', session.id)?.id ?? null,
    paymentTimeline: bundlePaymentTimeline(ctx, session.id),
    flags: {
      canConsent: session.state === 'CREATED' && !session.consented_at,
      canCreateOrder:
        Boolean(session.consented_at) &&
        (session.state === 'CONSENTED' || session.state === 'PAYMENT_PENDING') &&
        (session.payment_state === 'NONE' || session.payment_state === 'ORDER_CREATED') &&
        ctx.config.paypal.configured,
      canDemoStart:
        Boolean(session.consented_at) &&
        !ctx.config.paypal.configured &&
        session.state === 'CONSENTED' &&
        session.payment_state === 'NONE',
      canStart:
        session.state === 'READY' &&
        paymentReady &&
        object.status === 'ACTIVE' &&
        Boolean(session.consented_at),
      canReauthorize:
        session.state === 'READY' &&
        session.payment_state === 'AUTHORIZED' &&
        authorizationExpired &&
        ctx.config.paypal.configured,
      canPause: session.state === 'ACTIVE',
      canResume: session.state === 'PAUSED',
      canStop: session.state === 'ACTIVE' || session.state === 'PAUSED',
      canAcceptReview:
        session.state === 'STOPPED' && open === 0 && Boolean(session.quote_hash) && !session.reviewed_at,
      canCapture,
      canVoid:
        session.payment_state === 'AUTHORIZED' &&
        session.quote_minor === 0 &&
        (session.state === 'REVIEWED' || (isOperator && session.state === 'STOPPED')),
      canApproveReview:
        isOperator &&
        session.review_mode === 'OPERATOR_REQUIRED' &&
        session.state === 'REVIEWED' &&
        !session.operator_approved_at,
      awaitingOperator,
    },
    preflight: preflightView(ctx, session.id),
    fairnessReserveMinor,
    fairnessCreditAppliedMinor: fairnessApplied?.amount_minor ?? 0,
    canUseFairnessReserve:
      session.state === 'STOPPED' &&
      fairnessReserveMinor > 0 &&
      !fairnessApplied &&
      session.credit_minor < session.base_quote_minor &&
      session.payment_state !== 'CAPTURE_COMPLETED' &&
      session.payment_state !== 'REFUNDED',
    limitations: artifact.limitations,
    sandboxNotice: ctx.config.paypal.configured
      ? 'PayPal Sandbox — simulated funds only. No real money moves.'
      : 'PayPal Sandbox is not configured on this installation. This session uses demo metering only and processes no payment.',
    sessionToken: token,
  };
  return view;
}

function sameRenterIdempotentSession(ctx: AppContext, objectId: string, renterId: string): SessionRow | null {
  const row = ctx.store.get<SessionRow>(
    `SELECT * FROM sessions
     WHERE object_id = ? AND renter_id = ? AND state IN ('CREATED','CONSENTED','PAYMENT_PENDING')
       AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    objectId,
    renterId,
    new Date(ctx.now().getTime() - 2 * 60 * 60 * 1000).toISOString(),
  );
  return row ?? null;
}

export function createSession(ctx: AppContext, renter: UserRow, objectId: string): SessionView {
  const object = getObject(ctx.store, objectId);
  if (!object || object.status !== 'ACTIVE') throw errors.notFound('This object is not available');
  const model = activeModel(ctx, object);
  const terms = activeTerms(ctx, object);
  if (!model || model.status === 'REJECTED') {
    throw errors.conflict('NOT_CALIBRATED', 'This object has not been calibrated for billing yet.');
  }
  if (!terms) throw errors.conflict('NO_TERMS', 'This object has no published price terms.');

  const existing = sameRenterIdempotentSession(ctx, objectId, renter.id);
  if (existing) return buildSessionView(ctx, existing, { type: 'renter', id: renter.id });

  const busy = ctx.store.get<{ id: string }>(
    "SELECT id FROM sessions WHERE object_id = ? AND state IN ('READY','ACTIVE','PAUSED') LIMIT 1",
    objectId,
  );
  if (busy) throw errors.conflict('OBJECT_IN_USE', 'Another renter is currently using this object.');
  const held = assertHoldAvailable(ctx, renter.id, objectId);

  const now = ctx.now().toISOString();
  const id = newId('ses');
  ctx.store.run(
    `INSERT INTO sessions
      (id, object_id, owner_id, renter_id, terms_id, terms_hash, model_version_id, model_hash, model_status,
       currency, minor_per_minute, cap_minor, state, payment_state, review_mode, sensor_mode, created_at,
       base_quote_minor, credit_minor, quote_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', 'NONE', ?, 'LIVE', ?, 0, 0, 0)`,
    id,
    object.id,
    object.owner_id,
    renter.id,
    terms.id,
    terms.terms_hash,
    model.id,
    model.model_hash,
    model.status,
    terms.currency,
    terms.minor_per_minute,
    terms.cap_minor,
    model.status === 'LIMITED' ? 'OPERATOR_REQUIRED' : 'AUTO',
    now,
  );
  consumeHold(ctx, held, id);
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.created',
    subjectType: 'session',
    subjectId: id,
    metadata: { objectId: object.id, termsHash: terms.terms_hash, modelHash: model.model_hash },
  }, ctx.now());
  const session = requireSession(ctx, id);
  return buildSessionView(ctx, session, { type: 'renter', id: renter.id });
}

export function consentSession(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: ConsentInput,
  ipHash: string,
  agentHash: string,
  displayName?: string,
): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (input.termsHash !== session.terms_hash) {
    throw errors.conflict('TERMS_MISMATCH', 'The terms changed. Reload and review the current terms.');
  }
  if (session.consented_at) {
    return buildSessionView(ctx, session, { type: 'renter', id: renter.id });
  }
  if (session.state !== 'CREATED') {
    throw errors.conflict('INVALID_STATE', `Cannot consent from session state ${session.state}.`);
  }
  const terms = getTerms(ctx, session.terms_id);
  if (!terms) throw errors.internal('Session terms missing');
  const now = ctx.now().toISOString();
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO session_consents
        (session_id, renter_id, terms_hash, model_hash, terms_snapshot_json, accepted_at, ip_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      renter.id,
      session.terms_hash,
      session.model_hash,
      terms.terms_json,
      now,
      ipHash,
      agentHash,
    );
    ctx.store.run('UPDATE sessions SET consented_at = ?, state = ? WHERE id = ?', now, 'CONSENTED', session.id);
    if (displayName) {
      ctx.store.run('UPDATE users SET display_name = ? WHERE id = ?', displayName.slice(0, 60), renter.id);
    }
  });
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.consent_accepted',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { termsHash: session.terms_hash, modelHash: session.model_hash },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function enableDemoMode(ctx: AppContext, renter: UserRow, sessionId: string): SessionView {
  if (ctx.config.paypal.configured) {
    throw errors.conflict('PAYPAL_CONFIGURED', 'PayPal Sandbox is configured; use the genuine authorization flow.');
  }
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (!session.consented_at || session.state !== 'CONSENTED' || session.payment_state !== 'NONE') {
    throw errors.conflict('INVALID_STATE', 'Demo metering can only start after consent and before payment.');
  }
  ctx.store.run(
    "UPDATE sessions SET payment_state = 'DEMO_MODE', state = 'READY' WHERE id = ?",
    session.id,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.demo_mode_enabled',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { reason: 'PAYPAL_SANDBOX_NOT_CONFIGURED' },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function startSession(ctx: AppContext, renter: UserRow, sessionId: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (session.state !== 'READY') {
    throw errors.conflict('INVALID_STATE', `Cannot start a session in state ${session.state}.`);
  }
  if (session.payment_state !== 'AUTHORIZED' && session.payment_state !== 'DEMO_MODE') {
    throw errors.conflict('PAYMENT_NOT_READY', 'Buyer approval is required before sensing starts.');
  }
  if (session.payment_state === 'AUTHORIZED' && authorizationExpired(session, ctx.now())) {
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The PayPal authorization expired before sensing. Reauthorize safely; nothing was charged.');
  }
  if (!session.consented_at) throw errors.conflict('NO_CONSENT', 'Consent is required before starting.');
  const preflight = ctx.store.get<{ status: string }>(
    'SELECT status FROM session_preflights WHERE session_id = ?',
    session.id,
  );
  if (preflight?.status === 'NO_SIGNAL' || preflight?.status === 'UNSTABLE') {
    throw errors.conflict(
      'PREFLIGHT_BLOCKED',
      preflight.status === 'NO_SIGNAL'
        ? 'No usable microphone signal was recorded. Fix the input and run the room check again.'
        : 'The room check found clipping or an unstable level. Fix the input and run the room check again.',
    );
  }
  const object = getObject(ctx.store, session.object_id);
  if (!object || object.status !== 'ACTIVE') throw errors.conflict('OBJECT_REVOKED', 'This object is no longer available.');
  const other = ctx.store.get<{ id: string }>(
    "SELECT id FROM sessions WHERE object_id = ? AND id <> ? AND state IN ('READY','ACTIVE','PAUSED') LIMIT 1",
    session.object_id,
    session.id,
  );
  if (other) throw errors.conflict('OBJECT_IN_USE', 'This object already has an active session.');
  const now = ctx.now().toISOString();
  ctx.store.run(
    `UPDATE sessions SET state = 'ACTIVE', started_at = ?, paused_at = NULL, paused_total_ms = 0,
       last_client_seq = 0, last_interval_end_ms = 0
     WHERE id = ?`,
    now,
    session.id,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.started',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { paymentState: session.payment_state },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function pauseSession(ctx: AppContext, actor: Actor, sessionId: string, reason: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, actor);
  if (session.state !== 'ACTIVE') throw errors.conflict('INVALID_STATE', 'Only an active session can be paused.');
  const now = ctx.now();
  ctx.store.transaction(() => {
    ctx.store.run('UPDATE sessions SET state = ?, paused_at = ? WHERE id = ?', 'PAUSED', now.toISOString(), session.id);
    ctx.store.run(
      'INSERT INTO session_pauses (id, session_id, reason, paused_at, resumed_at) VALUES (?, ?, ?, ?, NULL)',
      newId('pse'),
      session.id,
      reason,
      now.toISOString(),
    );
  });
  appendAudit(ctx.store, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'session.paused',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { reason, meterClockMs: computeMeterClockMs(requireSession(ctx, session.id), now) },
  }, now);
  return buildSessionView(ctx, requireSession(ctx, session.id), actor);
}

export function resumeSession(ctx: AppContext, actor: Actor, sessionId: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, actor);
  if (session.state !== 'PAUSED' || !session.paused_at) {
    throw errors.conflict('INVALID_STATE', 'Only a paused session can be resumed.');
  }
  const now = ctx.now();
  const pausedDelta = Math.max(0, now.getTime() - parseTime(session.paused_at));
  ctx.store.transaction(() => {
    ctx.store.run(
      'UPDATE sessions SET state = ?, paused_at = NULL, paused_total_ms = paused_total_ms + ? WHERE id = ?',
      'ACTIVE',
      pausedDelta,
      session.id,
    );
    ctx.store.run(
      'UPDATE session_pauses SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL',
      now.toISOString(),
      session.id,
    );
  });
  appendAudit(ctx.store, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'session.resumed',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { pausedDeltaMs: pausedDelta },
  }, now);
  return buildSessionView(ctx, requireSession(ctx, session.id), actor);
}

export function stopSession(ctx: AppContext, actor: Actor, sessionId: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, actor);
  if (session.state !== 'ACTIVE' && session.state !== 'PAUSED') {
    throw errors.conflict('INVALID_STATE', 'Only an active or paused session can be stopped.');
  }
  const now = ctx.now();
  const nowIso = now.toISOString();
  const pausedDelta =
    session.state === 'PAUSED' && session.paused_at ? Math.max(0, now.getTime() - parseTime(session.paused_at)) : 0;
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  if (summary.overlaps || summary.invalid > 0) {
    throw errors.conflict('EVIDENCE_INTEGRITY', 'Stored evidence contains overlaps or invalid intervals and cannot be billed.');
  }
  const breakdown = quoteBreakdown(
    session.minor_per_minute,
    summary.billableMs,
    session.cap_minor,
    session.credit_minor,
    session.currency,
  );
  const baseQuoteMinor = breakdown.cappedMinor + breakdown.creditMinor;
  const quoteHash = quoteHashFor({
    sessionId: session.id,
    termsHash: session.terms_hash,
    modelHash: session.model_hash,
    billableMs: summary.billableMs,
    baseQuoteMinor,
    creditMinor: breakdown.creditMinor,
    quoteMinor: breakdown.finalMinor,
    currency: session.currency,
    segments: summary.mergedBillable,
  });
  const root = evidenceRoot(session, intervals, { billableMs: summary.billableMs });
  const mismatchMs = intervals.reduce((total, interval) => {
    const flags = JSON.parse(interval.quality_flags_json) as string[];
    return flags.includes('SOUNDPRINT_MISMATCH') ? total + Math.max(0, interval.end_ms - interval.start_ms) : total;
  }, 0);
  const sensorReport: SensorReport = {
    schema: 'whirr.sensor-report.v1',
    sessionId: session.id,
    observedMs: summary.observedMs,
    billableMs: summary.billableMs,
    mismatchMs,
    mismatchRatio: summary.observedMs > 0 ? mismatchMs / summary.observedMs : 0,
    uncertainMs: summary.uncertainMs,
    uncertainRatio: summary.observedMs > 0 ? summary.uncertainMs / summary.observedMs : 0,
    createdAt: nowIso,
    note: 'Diagnostic summary of stored interval flags. This is not audio and is not billing evidence.',
  };
  ctx.store.transaction(() => {
    ctx.store.run(
      `UPDATE sessions SET state = 'STOPPED', stopped_at = ?, paused_at = NULL,
         paused_total_ms = paused_total_ms + ?, observed_ms = ?, billable_ms = ?, excluded_ms = ?,
         idle_ms = ?, disconnected_ms = ?, base_quote_minor = ?, quote_minor = ?, quote_hash = ?,
         evidence_hash = ?, reviewed_at = NULL, reviewed_quote_hash = NULL, operator_approved_at = NULL
       WHERE id = ?`,
      nowIso,
      pausedDelta,
      summary.observedMs,
      summary.billableMs,
      summary.uncertainMs + summary.disconnectedMs,
      summary.idleMs,
      summary.disconnectedMs,
      baseQuoteMinor,
      breakdown.finalMinor,
      quoteHash,
      root,
      session.id,
    );
    if (session.state === 'PAUSED') {
      ctx.store.run(
        'UPDATE session_pauses SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL',
        nowIso,
        session.id,
      );
    }
    ctx.store.run(
      `INSERT INTO session_sensor_reports (session_id, report_json, mismatch_ratio, uncertain_ratio, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET report_json = excluded.report_json,
         mismatch_ratio = excluded.mismatch_ratio, uncertain_ratio = excluded.uncertain_ratio, created_at = excluded.created_at`,
      session.id,
      JSON.stringify(sensorReport),
      sensorReport.mismatchRatio,
      sensorReport.uncertainRatio,
      nowIso,
    );
  });
  appendAudit(ctx.store, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'session.stopped',
    subjectType: 'session',
    subjectId: session.id,
    metadata: {
      billableMs: summary.billableMs,
      observedMs: summary.observedMs,
      quoteMinor: breakdown.finalMinor,
      quoteHash,
      intervalCount: intervals.length,
    },
  }, now);
  return buildSessionView(ctx, requireSession(ctx, session.id), actor);
}

export function appendIntervals(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: IntervalBatch,
): { accepted: true; duplicate: boolean; lastClientSeq: number; billableMs: number; meterClockMs: number } {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  const token = verifySessionToken(input.token, ctx.config.cookieSecret);
  if (!token.valid) throw errors.unauthorized(token.reason);
  if (
    token.payload.sid !== session.id ||
    token.payload.rid !== renter.id ||
    token.payload.th !== session.terms_hash ||
    token.payload.mh !== session.model_hash
  ) {
    throw errors.conflict('SESSION_FACTS_MISMATCH', 'Session token does not match the pinned terms or model.');
  }
  if (session.state === 'PAUSED') throw errors.conflict('SESSION_PAUSED', 'Sensing is paused; no interval is accepted.');
  if (session.state !== 'ACTIVE') throw errors.conflict('INVALID_STATE', 'Intervals are only accepted while active.');
  if (session.payment_state === 'AUTHORIZED' && authorizationExpired(session, ctx.now())) {
    throw errors.conflict('AUTHORIZATION_EXPIRED', 'The authorization expired; stop the session and reauthorize before further metering.');
  }
  if (input.clientSeq <= session.last_client_seq) {
    // Idempotent retry: a batch may have committed while its response was lost.
    // Accept it only when the exact same evidence is already stored; never
    // silently drop new evidence that happens to reuse an old sequence.
    const lastSeq = input.clientSeq + input.intervals.length - 1;
    const existing = ctx.store.all<IntervalRow>(
      'SELECT * FROM observed_intervals WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq ASC',
      session.id,
      input.clientSeq,
      lastSeq,
    );
    if (existing.length !== input.intervals.length) {
      throw errors.conflict('OUT_OF_ORDER', `Expected clientSeq ${session.last_client_seq + 1}`);
    }
    for (let index = 0; index < input.intervals.length; index += 1) {
      const interval = input.intervals[index]!;
      const row = existing[index]!;
      const expectedHash = intervalEvidenceHash(session.id, input.clientSeq + index, {
        startMs: interval.startMs,
        endMs: interval.endMs,
        state: interval.state,
        modelVersion: interval.modelVersion,
        confidence: interval.confidence ?? 0.5,
        qualityFlags: interval.qualityFlags ?? [],
        explanation: interval.explanation,
      });
      if (row.seq !== input.clientSeq + index || row.evidence_hash !== expectedHash) {
        throw errors.conflict(
          'EVIDENCE_CONFLICT',
          'This sequence range is already committed with different evidence; refusing to overwrite it.',
        );
      }
    }
    return {
      accepted: true,
      duplicate: true,
      lastClientSeq: lastSeq,
      billableMs: liveSummary(ctx, session).billableMs,
      meterClockMs: computeMeterClockMs(session, ctx.now()),
    };
  }
  if (input.clientSeq !== session.last_client_seq + 1) {
    throw errors.conflict('OUT_OF_ORDER', `Expected clientSeq ${session.last_client_seq + 1}`);
  }
  const totalCount = ctx.store.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM observed_intervals WHERE session_id = ?',
    session.id,
  );
  if ((totalCount?.count ?? 0) + input.intervals.length > 5_000) {
    throw errors.conflict('TOO_MANY_INTERVALS', 'This session has reached the evidence limit.');
  }
  const model = getModel(ctx, session.model_version_id);
  if (!model) throw errors.internal('Session model missing');
  const meterClock = computeMeterClockMs(session, ctx.now());
  const maxEnd = meterClock + CLOCK_SKEW_GRACE_MS;
  let lastEnd = session.last_interval_end_ms;
  const prepared: Array<{
    startMs: number;
    endMs: number;
    state: string;
    confidence: number;
    qualityFlags: string[];
    modelVersion: string;
    explanation?: IntervalExplanation;
    hash: string;
  }> = [];
  let seq = input.clientSeq;
  for (const interval of input.intervals) {
    if (interval.modelVersion !== model.version) {
      throw errors.conflict(
        'MODEL_MISMATCH',
        `Intervals must come from the pinned model ${model.version}. Recalibrate in a new session.`,
      );
    }
    if (interval.startMs < lastEnd) {
      throw errors.conflict('INTERVAL_OVERLAP', 'Interval overlaps previously accepted evidence.');
    }
    if (interval.endMs > maxEnd) {
      throw errors.conflict('INTERVAL_AHEAD', 'Interval ends beyond the authoritative session clock.');
    }
    if (interval.endMs <= interval.startMs) {
      throw errors.badRequest('Interval end must be after start.');
    }
    if (interval.endMs - interval.startMs > 10 * 60 * 1000) {
      throw errors.badRequest('Interval exceeds the maximum duration.');
    }
    const confidence = interval.confidence ?? 0.5;
    const qualityFlags = interval.qualityFlags ?? [];
    const evidenceHash = intervalEvidenceHash(session.id, seq, {
      startMs: interval.startMs,
      endMs: interval.endMs,
      state: interval.state,
      modelVersion: interval.modelVersion,
      confidence,
      qualityFlags,
      explanation: interval.explanation,
    });
    prepared.push({
      startMs: interval.startMs,
      endMs: interval.endMs,
      state: interval.state,
      confidence,
      qualityFlags,
      modelVersion: interval.modelVersion,
      explanation: interval.explanation,
      hash: evidenceHash,
    });
    lastEnd = interval.endMs;
    seq += 1;
  }

  const now = ctx.now();
  const nowIso = now.toISOString();
  ctx.store.transaction(() => {
    let runningSeq = input.clientSeq;
    for (const interval of prepared) {
      ctx.store.run(
        `INSERT INTO observed_intervals
          (id, session_id, seq, start_ms, end_ms, state, model_version, confidence, quality_flags_json,
           explanation_json, evidence_hash, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('ivl'),
        session.id,
        runningSeq,
        interval.startMs,
        interval.endMs,
        interval.state,
        interval.modelVersion,
        interval.confidence,
        JSON.stringify(interval.qualityFlags),
        interval.explanation ? JSON.stringify(interval.explanation) : null,
        interval.hash,
        nowIso,
      );
      runningSeq += 1;
    }
    ctx.store.run(
      'UPDATE sessions SET last_client_seq = ?, last_interval_end_ms = ? WHERE id = ?',
      runningSeq - 1,
      lastEnd,
      session.id,
    );
    const summary = liveSummary(ctx, requireSession(ctx, session.id));
    if (summary.billableMs > meterClock + MAX_ACTIVE_CLOCK_GRACE_MS) {
      throw errors.conflict('BILLABLE_EXCEEDS_CLOCK', 'Evidence claims more active time than the session clock allows.');
    }
    ctx.store.run(
      'UPDATE sessions SET observed_ms = ?, billable_ms = ?, excluded_ms = ?, idle_ms = ?, disconnected_ms = ? WHERE id = ?',
      summary.observedMs,
      summary.billableMs,
      summary.uncertainMs + summary.disconnectedMs,
      summary.idleMs,
      summary.disconnectedMs,
      session.id,
    );
  });
  return {
    accepted: true,
    duplicate: false,
    lastClientSeq: seq - 1,
    billableMs: liveSummary(ctx, requireSession(ctx, session.id)).billableMs,
    meterClockMs: computeMeterClockMs(requireSession(ctx, session.id), now),
  };
}

export function acceptReview(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: ReviewAccept,
): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (session.state !== 'STOPPED') throw errors.conflict('INVALID_STATE', 'Only a stopped session can be reviewed.');
  if (!session.quote_hash || input.quoteHash !== session.quote_hash) {
    throw errors.conflict('QUOTE_CHANGED', 'The quote changed. Review the current amount before accepting.');
  }
  if (openDisputes(ctx, session.id) > 0) {
    throw errors.conflict('DISPUTE_OPEN', 'Resolve the open dispute before accepting the bill.');
  }
  const now = ctx.now().toISOString();
  ctx.store.run(
    "UPDATE sessions SET state = 'REVIEWED', reviewed_at = ?, reviewed_quote_hash = ? WHERE id = ?",
    now,
    session.quote_hash,
    session.id,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.review_accepted',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { quoteMinor: session.quote_minor, quoteHash: session.quote_hash },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function openDispute(
  ctx: AppContext,
  renter: UserRow,
  sessionId: string,
  input: DisputeInput,
): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (session.state !== 'STOPPED') {
    throw errors.conflict('INVALID_STATE', 'Intervals can only be contested before the bill is accepted.');
  }
  if (openDisputes(ctx, session.id) > 0) {
    throw errors.conflict('DISPUTE_OPEN', 'An open dispute already exists for this session.');
  }
  const intervals = loadIntervals(ctx, session.id);
  const validIds = new Set(intervals.map((row) => row.id));
  const selected = [...new Set(input.intervalIds)];
  if (selected.length === 0 || selected.some((id) => !validIds.has(id))) {
    throw errors.badRequest('Every contested interval must belong to this session.');
  }
  const now = ctx.now().toISOString();
  const id = newId('dsp');
  ctx.store.run(
    `INSERT INTO disputes (id, session_id, renter_id, interval_ids_json, reason, reason_code, status, resolution, credit_minor, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN', NULL, 0, ?, NULL)`,
    id,
    session.id,
    renter.id,
    JSON.stringify(selected),
    input.reason,
    input.reasonCode,
    now,
  );
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'dispute.opened',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { disputeId: id, intervalIds: selected, reason: input.reason.slice(0, 200) },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function resolveDispute(
  ctx: AppContext,
  operator: UserRow,
  disputeId: string,
  input: { status: 'RESOLVED' | 'REJECTED'; creditMinor: number; resolution: string },
): SessionView {
  const dispute = ctx.store.get<DisputeRow>('SELECT * FROM disputes WHERE id = ?', disputeId);
  if (!dispute) throw errors.notFound('Dispute not found');
  if (dispute.status !== 'OPEN') throw errors.conflict('DISPUTE_RESOLVED', 'This dispute is already resolved.');
  const session = requireSession(ctx, dispute.session_id);
  if (session.state === 'SETTLED' || session.payment_state === 'CAPTURE_COMPLETED' || session.payment_state === 'REFUNDED') {
    throw errors.conflict('ALREADY_SETTLED', 'Cannot adjust a captured bill. Use a refund instead.');
  }
  const available = Math.max(0, session.base_quote_minor - session.credit_minor);
  if (input.creditMinor > available) {
    throw errors.badRequest(`Credit cannot exceed the remaining quote (${available} minor units).`);
  }
  const now = ctx.now().toISOString();
  const newCredit = session.credit_minor + input.creditMinor;
  const newQuote = Math.max(0, session.base_quote_minor - newCredit);
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const newHash = session.quote_hash
    ? quoteHashFor({
        sessionId: session.id,
        termsHash: session.terms_hash,
        modelHash: session.model_hash,
        billableMs: summary.billableMs,
        baseQuoteMinor: session.base_quote_minor,
        creditMinor: newCredit,
        quoteMinor: newQuote,
        currency: session.currency,
        segments: summary.mergedBillable,
      })
    : null;
  ctx.store.transaction(() => {
    ctx.store.run(
      'UPDATE disputes SET status = ?, resolution = ?, credit_minor = ?, resolved_at = ? WHERE id = ?',
      input.status,
      input.resolution,
      input.creditMinor,
      input.status === 'RESOLVED' ? now : null,
      dispute.id,
    );
    if (input.status === 'RESOLVED' && input.creditMinor > 0) {
      ctx.store.run(
        `UPDATE sessions SET credit_minor = ?, quote_minor = ?, quote_hash = ?,
           state = 'STOPPED', reviewed_at = NULL, reviewed_quote_hash = NULL, operator_approved_at = NULL
         WHERE id = ?`,
        newCredit,
        newQuote,
        newHash,
        session.id,
      );
    }
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'dispute.resolved',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { disputeId: dispute.id, status: input.status, creditMinor: input.creditMinor },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'operator', id: operator.id });
}

export function applyCredit(
  ctx: AppContext,
  operator: UserRow,
  sessionId: string,
  creditMinor: number,
  reason: string,
): SessionView {
  const session = requireSession(ctx, sessionId);
  if (session.state !== 'STOPPED' && session.state !== 'REVIEWED') {
    throw errors.conflict('INVALID_STATE', 'Credits can only be applied before capture.');
  }
  if (session.payment_state === 'CAPTURE_COMPLETED' || session.payment_state === 'REFUNDED') {
    throw errors.conflict('ALREADY_SETTLED', 'Use a refund for captured payments.');
  }
  const available = Math.max(0, session.base_quote_minor - session.credit_minor);
  if (creditMinor <= 0 || creditMinor > available) {
    throw errors.badRequest(`Credit must be between 1 and ${available} minor units.`);
  }
  const newCredit = session.credit_minor + creditMinor;
  const newQuote = Math.max(0, session.base_quote_minor - newCredit);
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const newHash = quoteHashFor({
    sessionId: session.id,
    termsHash: session.terms_hash,
    modelHash: session.model_hash,
    billableMs: summary.billableMs,
    baseQuoteMinor: session.base_quote_minor,
    creditMinor: newCredit,
    quoteMinor: newQuote,
    currency: session.currency,
    segments: summary.mergedBillable,
  });
  ctx.store.run(
    `UPDATE sessions SET credit_minor = ?, quote_minor = ?, quote_hash = ?,
       state = 'STOPPED', reviewed_at = NULL, reviewed_quote_hash = NULL, operator_approved_at = NULL
     WHERE id = ?`,
    newCredit,
    newQuote,
    newHash,
    session.id,
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'session.credit_applied',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { creditMinor, reason: reason.slice(0, 200), newQuote },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'operator', id: operator.id });
}

export function approveReview(ctx: AppContext, operator: UserRow, sessionId: string): SessionView {
  const session = requireSession(ctx, sessionId);
  if (session.state !== 'REVIEWED') {
    throw errors.conflict('INVALID_STATE', 'The renter must accept the reviewed quote first.');
  }
  if (session.review_mode !== 'OPERATOR_REQUIRED') {
    throw errors.conflict('REVIEW_NOT_REQUIRED', 'This model does not require operator review.');
  }
  if (session.reviewed_quote_hash !== session.quote_hash) {
    throw errors.conflict('QUOTE_CHANGED', 'The quote changed after the renter accepted it.');
  }
  if (openDisputes(ctx, session.id) > 0) throw errors.conflict('DISPUTE_OPEN', 'Resolve the dispute first.');
  const now = ctx.now().toISOString();
  ctx.store.run('UPDATE sessions SET operator_approved_at = ? WHERE id = ?', now, session.id);
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'session.operator_review_approved',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { quoteMinor: session.quote_minor, quoteHash: session.quote_hash },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'operator', id: operator.id });
}

export function useFairnessReserve(ctx: AppContext, renter: UserRow, sessionId: string): SessionView {
  const session = requireSessionForActor(ctx, sessionId, { type: 'renter', id: renter.id });
  if (session.state !== 'STOPPED') {
    throw errors.conflict('INVALID_STATE', 'The fairness reserve can only be applied to a stopped bill before review.');
  }
  if (session.payment_state === 'CAPTURE_COMPLETED' || session.payment_state === 'REFUNDED') {
    throw errors.conflict('ALREADY_SETTLED', 'The bill is already settled.');
  }
  const existing = ctx.store.get<{ id: string }>('SELECT id FROM fairness_credits WHERE session_id = ?', session.id);
  if (existing) throw errors.conflict('FAIRNESS_ALREADY_USED', 'The fairness reserve has already been applied to this bill.');
  const terms = parseTerms(sessionTermsRow(ctx, session));
  const reserve = terms.fairnessReserveMinor ?? 0;
  if (reserve <= 0) throw errors.conflict('NO_FAIRNESS_RESERVE', 'This rate card has no fairness reserve.');
  const available = Math.max(0, session.base_quote_minor - session.credit_minor);
  const amount = Math.min(reserve, available);
  if (amount <= 0) throw errors.conflict('NOTHING_TO_CREDIT', 'There is no remaining bill to apply the reserve to.');
  const newCredit = session.credit_minor + amount;
  const newQuote = Math.max(0, session.base_quote_minor - newCredit);
  const intervals = loadIntervals(ctx, session.id);
  const summary = summariseIntervals(intervalRowsToRaw(intervals));
  const newHash = quoteHashFor({
    sessionId: session.id,
    termsHash: session.terms_hash,
    modelHash: session.model_hash,
    billableMs: summary.billableMs,
    baseQuoteMinor: session.base_quote_minor,
    creditMinor: newCredit,
    quoteMinor: newQuote,
    currency: session.currency,
    segments: summary.mergedBillable,
  });
  ctx.store.transaction(() => {
    ctx.store.run(
      'INSERT INTO fairness_credits (id, session_id, amount_minor, applied_at) VALUES (?, ?, ?, ?)',
      newId('fcr'),
      session.id,
      amount,
      ctx.now().toISOString(),
    );
    ctx.store.run(
      `UPDATE sessions SET credit_minor = ?, quote_minor = ?, quote_hash = ?,
         reviewed_at = NULL, reviewed_quote_hash = NULL, operator_approved_at = NULL
       WHERE id = ?`,
      newCredit,
      newQuote,
      newHash,
      session.id,
    );
  });
  appendAudit(ctx.store, {
    actorType: 'renter',
    actorId: renter.id,
    action: 'session.fairness_reserve_applied',
    subjectType: 'session',
    subjectId: session.id,
    metadata: { amountMinor: amount, newQuote, reason: 'Pre-committed courtesy reserve' },
  }, ctx.now());
  return buildSessionView(ctx, requireSession(ctx, session.id), { type: 'renter', id: renter.id });
}

export function listAllSessions(ctx: AppContext, limit = 200): SessionListItem[] {
  const rows = ctx.store.all<
    SessionRow & { object_name: string; dispute_count: number }
  >(
    `SELECT s.*, o.name AS object_name,
       (SELECT COUNT(*) FROM disputes d WHERE d.session_id = s.id AND d.status = 'OPEN') AS dispute_count
     FROM sessions s JOIN objects o ON o.id = s.object_id
     ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    objectId: row.object_id,
    objectName: row.object_name,
    renterRef: renterRef(row.renter_id),
    state: row.state,
    paymentState: row.payment_state,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at,
    billableMs: row.billable_ms,
    quoteMinor: row.quote_minor,
    currency: row.currency,
    captureId: row.paypal_capture_id,
    reviewMode: row.review_mode,
    disputeCount: row.dispute_count,
  }));
}

export function sessionModelRow(ctx: AppContext, session: SessionRow): ModelRow {
  const row = getModel(ctx, session.model_version_id);
  if (!row) throw errors.internal('Session model missing');
  return row;
}

export function sessionTermsRow(ctx: AppContext, session: SessionRow): TermsRow {
  const row = getTerms(ctx, session.terms_id);
  if (!row) throw errors.internal('Session terms missing');
  return row;
}

export function sessionObjectRow(ctx: AppContext, session: SessionRow): ObjectRow {
  const row = getObject(ctx.store, session.object_id);
  if (!row) throw errors.internal('Session object missing');
  return row;
}

export function loadConsent(ctx: AppContext, sessionId: string): ConsentRow | null {
  return ctx.store.get<ConsentRow>('SELECT * FROM session_consents WHERE session_id = ?', sessionId) ?? null;
}
