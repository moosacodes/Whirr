import type { AppContext } from '../context.ts';
import type {
  DiscoveryEnrollmentRow,
  DiscoveryReportRow,
  DiscoveryTrialRow,
  ObjectRow,
  TermsRow,
  UserRow,
} from './rows.ts';
import { newId } from '../lib/ids.ts';
import { hashCanonical, sha256Hex } from '../lib/hash.ts';
import { errors } from '../lib/errors.ts';
import { appendAudit } from '../lib/audit.ts';
import { activeModel, activeTerms, requireObject, termsWithHash } from './objects.ts';
import { fieldValidationSummary } from './field-test.ts';
import {
  DISCOVERY_LIMITATIONS,
  DISCOVERY_PROTOCOL,
  buildDiscoveryProfile,
  evaluateDiscovery,
  fingerprintFrames,
  matchDiscoveryProfiles,
  qualityFromFrames,
  type DiscoveryEvaluation,
  type DiscoveryProfile,
} from '../../../../packages/audio/src/discovery.ts';
import type { z } from 'zod';
import type {
  discoveryEnrollmentSchema,
  discoveryMatchSchema,
  discoveryTrialSchema,
} from '../../../../packages/contracts/src/schemas.ts';
import type {
  DiscoveryEnrollmentSummary,
  DiscoveryLabView,
  DiscoveryMatchView,
  DiscoveryObjectView,
  DiscoveryProtocolView,
  DiscoveryPublicView,
  DiscoveryReportView,
  DiscoveryTermsView,
  DiscoveryTrialResponse,
  DiscoveryTrialView,
} from '../../../../packages/contracts/src/types.ts';

type EnrollmentInput = z.infer<typeof discoveryEnrollmentSchema>;
type MatchInput = z.infer<typeof discoveryMatchSchema>;
type TrialInput = z.infer<typeof discoveryTrialSchema>;

const PROTOCOL: DiscoveryProtocolView = {
  schema: DISCOVERY_PROTOCOL.schema,
  minEnrollments: DISCOVERY_PROTOCOL.minEnrollments,
  trainingTakesPerObject: DISCOVERY_PROTOCOL.trainingTakesPerObject,
  minTakeFrames: DISCOVERY_PROTOCOL.minTakeFrames,
  minMatchFrames: DISCOVERY_PROTOCOL.minMatchFrames,
  minScore: DISCOVERY_PROTOCOL.minScore,
  minMargin: DISCOVERY_PROTOCOL.minMargin,
  maxMedianLatencyMs: DISCOVERY_PROTOCOL.maxMedianLatencyMs,
  minTargetTrials: DISCOVERY_PROTOCOL.minTargetTrials,
  minTargetTrialsPerObject: DISCOVERY_PROTOCOL.minTargetTrialsPerObject,
  minUnknownTrials: DISCOVERY_PROTOCOL.minUnknownTrials,
  minReplayTrials: DISCOVERY_PROTOCOL.minReplayTrials,
  minDistanceTrials: DISCOVERY_PROTOCOL.minDistanceTrials,
  minNoiseTrials: DISCOVERY_PROTOCOL.minNoiseTrials,
  targetAccuracy: DISCOVERY_PROTOCOL.targetAccuracy,
  unknownRejection: DISCOVERY_PROTOCOL.unknownRejection,
  falseMatchRate: DISCOVERY_PROTOCOL.falseMatchRate,
  replayCrossMatchRate: DISCOVERY_PROTOCOL.replayCrossMatchRate,
  distanceAccuracy: DISCOVERY_PROTOCOL.distanceAccuracy,
  noiseAccuracy: DISCOVERY_PROTOCOL.noiseAccuracy,
  minUsableRatio: DISCOVERY_PROTOCOL.minUsableRatio,
};

const TRIAL_NOTE =
  'Features were extracted from a microphone in the operator’s browser. Raw audio was not uploaded or stored. The server evaluated the frozen discovery profile.';

function parseProfile(row: DiscoveryEnrollmentRow): DiscoveryProfile {
  return JSON.parse(row.profile_json) as DiscoveryProfile;
}

function enrollmentRows(ctx: AppContext): DiscoveryEnrollmentRow[] {
  return ctx.store.all<DiscoveryEnrollmentRow>(
    'SELECT * FROM discovery_enrollments ORDER BY created_at ASC',
  );
}

function enrollmentSummary(ctx: AppContext, row: DiscoveryEnrollmentRow): DiscoveryEnrollmentSummary {
  const profile = parseProfile(row);
  const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', row.object_id);
  return {
    objectId: row.object_id,
    objectName: object?.name ?? row.object_id,
    category: object?.category ?? 'other',
    glyph: object?.glyph ?? 'other',
    profileHash: row.profile_hash,
    status: row.status,
    trainingTakeCount: profile.trainingTakeCount,
    trainingFrameCount: profile.trainingFrameCount,
    usableFrameCount: profile.usableFrameCount,
    createdAt: row.created_at,
  };
}

function trialView(ctx: AppContext, row: DiscoveryTrialRow): DiscoveryTrialView {
  const truth = row.truth_object_id
    ? ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', row.truth_object_id)
    : null;
  const predicted = row.predicted_object_id
    ? ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', row.predicted_object_id)
    : null;
  return {
    id: row.id,
    truthObjectId: row.truth_object_id,
    truthObjectName: truth?.name ?? null,
    condition: row.condition,
    result: row.result,
    predictedObjectId: row.predicted_object_id,
    predictedObjectName: predicted?.name ?? null,
    score: row.score,
    margin: row.margin,
    latencyMs: row.latency_ms,
    quality: JSON.parse(row.quality_json) as DiscoveryTrialView['quality'],
    capturedAt: row.created_at,
  };
}

function trialRows(ctx: AppContext): DiscoveryTrialRow[] {
  return ctx.store.all<DiscoveryTrialRow>('SELECT * FROM discovery_trials ORDER BY created_at ASC');
}

function termsView(row: TermsRow): DiscoveryTermsView {
  const terms = termsWithHash(row);
  return {
    id: row.id,
    version: row.version,
    objectId: row.object_id,
    currency: row.currency,
    minorPerMinute: row.minor_per_minute,
    capMinor: row.cap_minor,
    rounding: terms.rounding,
    uncertainPolicy: terms.uncertainPolicy,
    billingPolicy: terms.billingPolicy,
    feesPolicy: terms.feesPolicy,
    modelStatus: row.model_status,
    createdAt: row.created_at,
    hash: row.terms_hash,
  };
}

function checkoutAvailability(ctx: AppContext, object: ObjectRow): { ready: boolean; reason: string } {
  if (object.status !== 'ACTIVE') {
    return { ready: false, reason: 'This object is revoked and cannot enter checkout.' };
  }
  const model = activeModel(ctx, object);
  if (!model) {
    return {
      ready: false,
      reason: 'No active 4.x operational-state model exists for this object, so the existing checkout guard would refuse a session.',
    };
  }
  const terms = activeTerms(ctx, object);
  if (!terms) {
    return {
      ready: false,
      reason: 'No active price terms exist for this object. Discovery can show a hypothesis, but not a checkout.',
    };
  }
  if (model.status !== 'READY' || terms.model_status !== 'READY') {
    return {
      ready: false,
      reason: `The existing checkout guard requires a READY model and READY terms (model ${model.status}, terms ${terms.model_status}).`,
    };
  }
  const field = fieldValidationSummary(ctx, model);
  if (field.required && field.status !== 'FIELD_PASS') {
    return {
      ready: false,
      reason: `This live-trained model has not passed the unchanged 4.x physical field gates (${field.status}).`,
    };
  }
  return {
    ready: true,
    reason:
      'The existing checkout route, field-validation guard, consent screen and PayPal Sandbox authorization still apply. Discovery does not start a session.',
  };
}

function objectView(ctx: AppContext, object: ObjectRow, enrollment: DiscoveryEnrollmentRow | null): DiscoveryObjectView {
  const terms = activeTerms(ctx, object);
  const availability = checkoutAvailability(ctx, object);
  return {
    id: object.id,
    name: object.name,
    category: object.category,
    glyph: object.glyph,
    description: object.description,
    status: object.status,
    enrollment: enrollment ? enrollmentSummary(ctx, enrollment) : null,
    hasTerms: Boolean(terms),
    checkoutReady: availability.ready,
    checkoutReason: availability.reason,
  };
}

function latestReportRow(ctx: AppContext): DiscoveryReportRow | null {
  return (
    ctx.store.get<DiscoveryReportRow>(
      'SELECT * FROM discovery_reports ORDER BY created_at DESC LIMIT 1',
    ) ?? null
  );
}

export function discoveryReportStatus(ctx: AppContext): DiscoveryReportView['status'] {
  const report = latestReportRow(ctx);
  if (report) return report.status;
  return trialRows(ctx).length ? 'INCOMPLETE' : 'NOT_RUN';
}

export function discoveryLab(ctx: AppContext, operator: UserRow): DiscoveryLabView {
  const objects = ctx.store.all<ObjectRow>(
    'SELECT * FROM objects WHERE owner_id = ? ORDER BY created_at ASC',
    operator.id,
  );
  const enrollments = enrollmentRows(ctx);
  const byObject = new Map(enrollments.map((row) => [row.object_id, row]));
  const report = latestReportRow(ctx);
  return {
    objects: objects.map((object) => objectView(ctx, object, byObject.get(object.id) ?? null)),
    enrollments: enrollments.map((row) => enrollmentSummary(ctx, row)),
    trials: trialRows(ctx).map((row) => trialView(ctx, row)),
    report: report ? (JSON.parse(report.report_json) as DiscoveryReportView) : null,
    reportStatus: discoveryReportStatus(ctx),
    protocol: PROTOCOL,
    limitations: [...DISCOVERY_LIMITATIONS],
  };
}

function activeProfiles(ctx: AppContext): Array<{ row: DiscoveryEnrollmentRow; profile: DiscoveryProfile; object: ObjectRow }> {
  return enrollmentRows(ctx)
    .map((row) => {
      const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ?', row.object_id);
      return object ? { row, profile: parseProfile(row), object } : null;
    })
    .filter(
      (entry): entry is { row: DiscoveryEnrollmentRow; profile: DiscoveryProfile; object: ObjectRow } =>
        Boolean(entry && entry.object.status === 'ACTIVE'),
    );
}

function asMatchView(
  ctx: AppContext,
  input: MatchInput,
  evaluation: ReturnType<typeof matchDiscoveryProfiles>,
  latencyMs: number,
): DiscoveryMatchView {
  const profiles = activeProfiles(ctx);
  const topProfile = evaluation.top
    ? profiles.find((entry) => entry.profile.objectId === evaluation.top?.objectId) ?? null
    : null;
  const object = topProfile?.object ?? null;
  const terms = object ? activeTerms(ctx, object) : null;
  const availability = object ? checkoutAvailability(ctx, object) : null;
  const checkoutAvailable = evaluation.result === 'MATCH' && Boolean(availability?.ready);
  const candidates = evaluation.candidates.map((candidate) => {
    const match = profiles.find((entry) => entry.profile.objectId === candidate.objectId);
    return {
      objectId: candidate.objectId,
      name: match?.object.name ?? candidate.objectId,
      category: match?.object.category ?? 'other',
      glyph: match?.object.glyph ?? 'other',
      score: candidate.score,
    };
  });
  const evidenceHash = hashCanonical({
    schema: 'whirr.discovery-match-evidence.v1',
    result: evaluation.result,
    top: evaluation.top,
    quality: evaluation.quality,
    claimedAt: input.capture.claimedAt,
    profiles: profiles.map((entry) => ({ objectId: entry.profile.objectId, profileHash: entry.row.profile_hash })),
  });

  return {
    schema: 'whirr.discovery-match.v1',
    result: evaluation.result,
    top: evaluation.top,
    candidates,
    quality: evaluation.quality,
    latencyMs,
    reason: evaluation.reason,
    evidenceHash,
    terms: evaluation.result === 'MATCH' && terms ? termsView(terms) : null,
    checkoutUrl:
      evaluation.result === 'MATCH' && object && checkoutAvailable
        ? `${ctx.config.primaryPublicOrigin}/s/${object.id}`
        : null,
    checkoutAvailable,
    checkoutReason:
      evaluation.result !== 'MATCH'
        ? 'No checkout is offered unless the live signal is a confident, unambiguous match. A human must confirm the object.'
        : availability?.reason ?? 'No object was available for checkout.',
    limitations: [...DISCOVERY_LIMITATIONS],
  };
}

export function matchDiscoveryInput(ctx: AppContext, input: MatchInput): DiscoveryMatchView {
  const profiles = activeProfiles(ctx);
  const started = performance.now();
  const evaluation = matchDiscoveryProfiles(
    input.frames,
    input.frameFlags ?? input.frames.map(() => []),
    profiles.map((entry) => entry.profile),
  );
  const latencyMs = Number((performance.now() - started).toFixed(2));
  return asMatchView(ctx, input, evaluation, latencyMs);
}

export function enrollDiscovery(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  input: EnrollmentInput,
): DiscoveryLabView {
  const object = requireObject(ctx, objectId, operator.id);
  if (input.takes.length < DISCOVERY_PROTOCOL.trainingTakesPerObject) {
    throw errors.badRequest(
      `Record at least ${DISCOVERY_PROTOCOL.trainingTakesPerObject} separate live takes for this object.`,
    );
  }
  const normalizedTakes = input.takes.map((take, index) => {
    const flags = take.frameFlags ?? take.frames.map(() => []);
    const quality = qualityFromFrames(take.frames, flags);
    if (quality.usableFrames < DISCOVERY_PROTOCOL.minTakeFrames) {
      throw errors.badRequest(
        `Take ${index + 1} has only ${quality.usableFrames} usable frames; record at least ${DISCOVERY_PROTOCOL.minTakeFrames}.`,
      );
    }
    if (quality.usableRatio < DISCOVERY_PROTOCOL.minUsableRatio) {
      throw errors.badRequest(
        `Take ${index + 1} is too noisy or clipped (${(quality.usableRatio * 100).toFixed(0)}% usable).`,
      );
    }
    return { frames: take.frames, frameFlags: flags };
  });
  const fingerprints = normalizedTakes.map((take) => fingerprintFrames(take.frames, take.frameFlags));
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw errors.badRequest('Each enrollment take must be a separate recording; duplicate takes are not independent evidence.');
  }

  const createdAt = ctx.now().toISOString();
  const profile = buildDiscoveryProfile(object.id, normalizedTakes, createdAt);
  if (profile.status !== 'READY') {
    throw errors.badRequest('The enrollment profile is too weak. Record longer, cleaner takes in a quieter room.');
  }
  const profileHash = hashCanonical(profile);
  const id = newId('den');
  ctx.store.transaction(() => {
    ctx.store.run('DELETE FROM discovery_enrollments WHERE object_id = ?', object.id);
    ctx.store.run(
      `INSERT INTO discovery_enrollments (id, object_id, profile_json, profile_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      object.id,
      JSON.stringify(profile),
      profileHash,
      profile.status,
      createdAt,
    );
    // Changing any enrollment invalidates the held-out evidence set and report.
    ctx.store.run('DELETE FROM discovery_trials');
    ctx.store.run('DELETE FROM discovery_reports');
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'discovery.enrolled',
    subjectType: 'object',
    subjectId: object.id,
    metadata: {
      enrollmentId: id,
      profileHash,
      takes: normalizedTakes.length,
      frames: profile.trainingFrameCount,
      usableFrames: profile.usableFrameCount,
    },
  }, ctx.now());
  return discoveryLab(ctx, operator);
}

export function recordDiscoveryTrial(
  ctx: AppContext,
  operator: UserRow,
  input: TrialInput,
): DiscoveryTrialResponse {
  const profiles = activeProfiles(ctx);
  if (profiles.length < DISCOVERY_PROTOCOL.minEnrollments) {
    throw errors.conflict(
      'DISCOVERY_NOT_ENROLLED',
      `Enroll at least ${DISCOVERY_PROTOCOL.minEnrollments} distinct active objects before recording held-out trials.`,
    );
  }
  if (input.condition === 'UNKNOWN_OBJECT' && input.truthObjectId !== null) {
    throw errors.badRequest('An UNKNOWN_OBJECT trial must not claim a truth object.');
  }
  if (input.condition !== 'UNKNOWN_OBJECT' && input.truthObjectId === null) {
    throw errors.badRequest('This condition requires the truth object that produced the recording.');
  }
  if (input.truthObjectId) {
    const truth = requireObject(ctx, input.truthObjectId, operator.id);
    if (!profiles.some((entry) => entry.profile.objectId === truth.id)) {
      throw errors.badRequest('The truth object must have a READY enrollment.');
    }
  }
  const flags = input.frameFlags ?? input.frames.map(() => []);
  const quality = qualityFromFrames(input.frames, flags);
  if (quality.usableFrames < DISCOVERY_PROTOCOL.minMatchFrames) {
    throw errors.badRequest(`The trial has only ${quality.usableFrames} usable frames.`);
  }
  const fingerprint = fingerprintFrames(input.frames, flags);
  const reused = profiles.find((entry) => entry.profile.trainingFingerprints.includes(fingerprint));
  if (reused) {
    throw errors.conflict(
      'TRAINING_DATA_REUSE',
      `This recording is identical to an enrollment take for ${reused.object.name}. Held-out evaluation must use new recordings.`,
    );
  }

  const started = performance.now();
  const evaluation = matchDiscoveryProfiles(input.frames, flags, profiles.map((entry) => entry.profile));
  const latencyMs = Number((performance.now() - started).toFixed(2));
  const id = newId('dtl');
  const createdAt = ctx.now().toISOString();
  const capture = {
    ...input.capture,
    deviceLabel: input.deviceLabel ?? input.capture.deviceLabel,
    sampleRate: input.sampleRate,
    durationMs: input.durationMs,
    capturedAt: input.capturedAt,
    deviceRef: input.deviceLabel ? sha256Hex(input.deviceLabel).slice(0, 12) : null,
    note: TRIAL_NOTE,
    evaluation: {
      result: evaluation.result,
      top: evaluation.top,
      candidates: evaluation.candidates,
      reason: evaluation.reason,
    },
  };
  const evidenceHash = hashCanonical({
    schema: 'whirr.discovery-trial-evidence.v1',
    objectId: input.truthObjectId,
    condition: input.condition,
    result: evaluation.result,
    predictedObjectId: evaluation.top?.objectId ?? null,
    score: evaluation.top?.score ?? null,
    margin: evaluation.top?.margin ?? null,
    quality,
    capture,
    profiles: profiles.map((entry) => entry.row.profile_hash).sort(),
  });
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO discovery_trials
        (id, object_id, truth_object_id, condition, result, predicted_object_id, score, margin, latency_ms,
         quality_json, capture_json, evidence_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.truthObjectId,
      input.truthObjectId,
      input.condition,
      evaluation.result,
      evaluation.top?.objectId ?? null,
      evaluation.top?.score ?? null,
      evaluation.top?.margin ?? null,
      latencyMs,
      JSON.stringify(quality),
      JSON.stringify(capture),
      evidenceHash,
      createdAt,
    );
    // A new trial changes the evidence set; a report generated from older
    // evidence must never remain visible as if it described the new set.
    ctx.store.run('DELETE FROM discovery_reports');
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'discovery.trial_recorded',
    subjectType: 'object',
    subjectId: input.truthObjectId ?? 'unknown',
    metadata: {
      trialId: id,
      condition: input.condition,
      result: evaluation.result,
      predictedObjectId: evaluation.top?.objectId ?? null,
      latencyMs,
    },
  }, ctx.now());
  const row = ctx.store.get<DiscoveryTrialRow>('SELECT * FROM discovery_trials WHERE id = ?', id)!;
  return {
    trial: trialView(ctx, row),
    match: asMatchView(ctx, input, evaluation, latencyMs),
    lab: discoveryLab(ctx, operator),
  };
}

export function discardDiscoveryTrial(ctx: AppContext, operator: UserRow, trialId: string): DiscoveryLabView {
  const row = ctx.store.get<DiscoveryTrialRow>('SELECT * FROM discovery_trials WHERE id = ?', trialId);
  if (!row) throw errors.notFound('Discovery trial not found');
  if (row.object_id) requireObject(ctx, row.object_id, operator.id);
  ctx.store.transaction(() => {
    ctx.store.run('DELETE FROM discovery_trials WHERE id = ?', trialId);
    ctx.store.run('DELETE FROM discovery_reports');
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'discovery.trial_discarded',
    subjectType: 'object',
    subjectId: row.object_id ?? 'unknown',
    metadata: { trialId, condition: row.condition },
  }, ctx.now());
  return discoveryLab(ctx, operator);
}

function reportFromEvaluation(
  ctx: AppContext,
  evaluation: DiscoveryEvaluation,
  enrollments: DiscoveryEnrollmentSummary[],
  trials: DiscoveryTrialView[],
  createdAt: string,
): DiscoveryReportView {
  const evidenceHash = hashCanonical({
    schema: 'whirr.discovery-report-evidence.v1',
    enrollments: enrollments.map((entry) => entry.profileHash).sort(),
    trials: trials.map((entry) => entry.id).sort(),
    protocol: PROTOCOL,
    status: evaluation.status,
  });
  return {
    schema: 'whirr.discovery-report.v1',
    id: newId('drp'),
    status: evaluation.status,
    metrics: evaluation.metrics,
    confusion: evaluation.confusion,
    conditions: evaluation.conditions,
    gates: evaluation.gates,
    enrollments,
    trials,
    protocol: PROTOCOL,
    limitations: [...DISCOVERY_LIMITATIONS],
    provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
    evidenceHash,
    createdAt,
  };
}

export function generateDiscoveryReport(
  ctx: AppContext,
  operator: UserRow,
): { report: DiscoveryReportView; lab: DiscoveryLabView } {
  const profiles = activeProfiles(ctx);
  const evaluations = evaluateDiscovery(
    trialRows(ctx).map((row) => ({
      truthObjectId: row.truth_object_id,
      condition: row.condition,
      result: row.result,
      predictedObjectId: row.predicted_object_id,
      latencyMs: row.latency_ms,
      quality: JSON.parse(row.quality_json) as DiscoveryTrialView['quality'],
    })),
    profiles.map((entry) => entry.profile),
  );
  const createdAt = ctx.now().toISOString();
  const enrollments = enrollmentRows(ctx).map((row) => enrollmentSummary(ctx, row));
  const trials = trialRows(ctx).map((row) => trialView(ctx, row));
  const report = reportFromEvaluation(ctx, evaluations, enrollments, trials, createdAt);
  ctx.store.run(
    `INSERT INTO discovery_reports (id, status, report_json, evidence_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    report.id,
    report.status,
    JSON.stringify(report),
    report.evidenceHash,
    createdAt,
  );
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'discovery.report_generated',
    subjectType: 'discovery',
    subjectId: report.id,
    metadata: { status: report.status, trials: trials.length, evidenceHash: report.evidenceHash },
  }, ctx.now());
  return { report, lab: discoveryLab(ctx, operator) };
}

export function publicDiscovery(ctx: AppContext): DiscoveryPublicView {
  const profiles = activeProfiles(ctx);
  return {
    enrollmentCount: profiles.filter((entry) => entry.profile.status === 'READY').length,
    objects: profiles.map((entry) => ({
      id: entry.object.id,
      name: entry.object.name,
      category: entry.object.category,
      glyph: entry.object.glyph,
    })),
    report: latestReportRow(ctx)
      ? (JSON.parse(latestReportRow(ctx)!.report_json) as DiscoveryReportView)
      : null,
    reportStatus: discoveryReportStatus(ctx),
    protocol: PROTOCOL,
    limitations: [...DISCOVERY_LIMITATIONS],
  };
}
