import type { AppContext } from '../context.ts';
import type { FieldReportRow, FieldTrialRow, ModelRow, ObjectRow, TakeRow, UserRow } from './rows.ts';
import { parseArtifact } from './rows.ts';
import { newId } from '../lib/ids.ts';
import { hashCanonical, sha256Hex } from '../lib/hash.ts';
import { errors } from '../lib/errors.ts';
import { appendAudit } from '../lib/audit.ts';
import {
  FIELD_GATE_THRESHOLDS,
  FIELD_PROTOCOL,
  FIELD_TRIAL_KINDS,
  evaluateFieldTrial,
  recordingQualityPasses,
  trialMeetsThresholds,
  validateFieldFrames,
  validateFieldTimeline,
  type FieldTimelineSegment,
  type FieldTrialKind,
} from '../../../../packages/audio/src/field-eval.ts';
import type {
  FieldGateView,
  FieldTestReport,
  FieldTestStateView,
  FieldTrialView,
  FieldTrainingSummary,
  FieldValidationSummary,
} from '../../../../packages/contracts/src/field-types.ts';
import type { z } from 'zod';
import type { fieldTrialUploadSchema } from '../../../../packages/contracts/src/schemas.ts';

type FieldTrialUpload = z.infer<typeof fieldTrialUploadSchema>;

const TRIAL_LABELS: Record<FieldTrialKind, string> = {
  THREE_CYCLE: 'Guided three-cycle ON/OFF',
  NOISE: 'Background-noise only',
  DISTANCE: 'Object running at distance',
  REPLAY: 'Replay of a recording',
};

function activeModelFor(ctx: AppContext, object: ObjectRow): ModelRow | null {
  return object.active_model_id
    ? ctx.store.get<ModelRow>('SELECT * FROM model_versions WHERE id = ?', object.active_model_id) ?? null
    : null;
}

function parseTimeline(value: string): FieldTimelineSegment[] {
  return JSON.parse(value) as FieldTimelineSegment[];
}

function trainingSummaryFor(ctx: AppContext, objectId: string, artifactDatasetHash: string): FieldTrainingSummary {
  const takes = ctx.store.all<TakeRow>(
    'SELECT * FROM calibration_takes WHERE object_id = ? ORDER BY created_at ASC',
    objectId,
  );
  const roles = new Map<string, string>(
    ctx.store
      .all<{ take_id: string; role: string }>('SELECT take_id, role FROM take_roles')
      .map((row) => [row.take_id, row.role]),
  );
  const training = takes.filter((take) => roles.get(take.id) !== 'VALIDATION');
  const summary: FieldTrainingSummary = {
    idle: 0,
    active: 0,
    negative: 0,
    other: 0,
    nonLive: 0,
    datasetHashMatches: false,
  };
  for (const take of training) {
    if (take.label === 'idle') summary.idle += 1;
    else if (take.label === 'active') summary.active += 1;
    else if (take.label === 'negative') summary.negative += 1;
    else summary.other += 1;
    if (take.source !== 'live') summary.nonLive += 1;
  }
  const datasetHash = hashCanonical({
    schema: 'whirr.dataset.v1',
    takes: training
      .map((take) => ({ id: take.id, hash: take.dataset_hash, label: take.label }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  summary.datasetHashMatches = datasetHash === artifactDatasetHash;
  return summary;
}

function trialViewsFor(
  ctx: AppContext,
  model: ModelRow,
  artifact: ReturnType<typeof parseArtifact>,
): FieldTrialView[] {
  const rows = ctx.store.all<FieldTrialRow>(
    'SELECT * FROM field_test_recordings WHERE model_id = ? ORDER BY created_at ASC',
    model.id,
  );
  const views: FieldTrialView[] = [];
  for (const row of rows) {
    const frames = JSON.parse(row.frames_json) as number[][];
    const frameFlags = JSON.parse(row.frame_flags_json) as string[][];
    const timeline = parseTimeline(row.timeline_json);
    const capture = JSON.parse(row.capture_json) as {
      deviceLabel?: string | null;
      deviceRef?: string | null;
      sampleRate?: number;
      capturedAt?: string;
      note?: string;
    };
    const evaluation = evaluateFieldTrial(artifact, {
      kind: row.trial_kind as FieldTrialKind,
      frames,
      frameFlags,
      timeline,
      durationMs: JSON.parse(row.capture_json).durationMs as number,
    });
    const qualityOk = recordingQualityPasses(evaluation.quality);
    const thresholdOk = trialMeetsThresholds(row.trial_kind as FieldTrialKind, evaluation.metrics);
    const notes: string[] = [];
    if (!qualityOk) notes.push('The recording quality gate failed (silence, clipping or missing frames).');
    if (!thresholdOk) notes.push(`${TRIAL_LABELS[row.trial_kind as FieldTrialKind]} did not meet its threshold.`);
    if (evaluation.metrics.soundprintMismatchRatio > 0) {
      notes.push(
        `${(evaluation.metrics.soundprintMismatchRatio * 100).toFixed(1)}% of frames were rejected by the acoustic passport.`,
      );
    }
    views.push({
      kind: row.trial_kind as FieldTrialKind,
      recordingId: row.id,
      attempt: row.attempt,
      status: qualityOk && thresholdOk ? 'PASS' : 'FAIL',
      capturedAt: capture.capturedAt ?? row.created_at,
      durationMs: JSON.parse(row.capture_json).durationMs as number,
      sampleRate: capture.sampleRate ?? 0,
      timeline,
      intervals: evaluation.intervals,
      recording: {
        provenance: 'CLIENT_CLAIMED_LIVE_MICROPHONE',
        deviceRef: capture.deviceRef ?? null,
        capturedAt: capture.capturedAt ?? row.created_at,
        durationMs: JSON.parse(row.capture_json).durationMs as number,
        frameCount: frames.length,
        sampleRate: capture.sampleRate ?? 0,
        quality: evaluation.quality,
        note:
          capture.note ??
          'Features were extracted from a live microphone in the browser. Raw audio was not uploaded.',
      },
      metrics: evaluation.metrics,
      notes,
    });
  }
  return views.sort(
    (a, b) => FIELD_TRIAL_KINDS.indexOf(a.kind) - FIELD_TRIAL_KINDS.indexOf(b.kind),
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function gate(
  id: string,
  label: string,
  threshold: string,
  observed: string,
  status: FieldGateView['status'],
  detail: string,
): FieldGateView {
  return { id, label, threshold, observed, status, detail };
}

function buildGates(
  model: ModelRow,
  training: FieldTrainingSummary,
  trials: FieldTrialView[],
): FieldGateView[] {
  const gates: FieldGateView[] = [];
  const cycle = trials.find((trial) => trial.kind === 'THREE_CYCLE');
  const noise = trials.find((trial) => trial.kind === 'NOISE');
  const distance = trials.find((trial) => trial.kind === 'DISTANCE');
  const replay = trials.find((trial) => trial.kind === 'REPLAY');

  gates.push(
    gate(
      'MODEL_READY',
      'Model is READY and locally calibrated',
      'READY · USER_CALIBRATION',
      `${model.status} · ${model.provenance}`,
      model.status === 'READY' && model.provenance === 'USER_CALIBRATION' ? 'PASS' : 'FAIL',
      model.provenance === 'USER_CALIBRATION'
        ? 'Field validation applies only to models trained from this object’s own recordings.'
        : 'This is the synthetic reference model; it remains a separate reproducible demo and cannot earn a real-object field report.',
    ),
  );

  const liveCountsOk =
    training.idle >= 2 && training.active >= 2 && training.negative >= 1 && training.nonLive === 0;
  const trainingStatus: FieldGateView['status'] = !training.datasetHashMatches
    ? 'FAIL'
    : training.nonLive > 0
      ? 'FAIL'
      : liveCountsOk
        ? 'PASS'
        : 'OPEN';
  gates.push(
    gate(
      'LIVE_CALIBRATION',
      'Calibration used live recordings only',
      '≥2 live idle · ≥2 live operating · ≥1 live background · no imported/synthetic training takes',
      `${training.idle} idle · ${training.active} operating · ${training.negative} background · ${training.nonLive} non-live`,
      trainingStatus,
      !training.datasetHashMatches
        ? 'Calibration takes changed after this model was trained. Retrain before running field trials.'
        : training.nonLive > 0
          ? 'Imported or synthetic takes are present in the training set. Remove them and retrain with live recordings before field validation.'
          : liveCountsOk
            ? 'Every training take is a live microphone capture and the dataset hash matches the active model.'
            : 'Record two live idle takes, two live operating takes and at least one live background take, then train.',
    ),
  );

  gates.push(
    gate(
      'THREE_CYCLES',
      'Three complete guided ON/OFF cycles',
      'exactly 3 ON phases, each ~5 s',
      cycle ? `${cycle.metrics.cycles} ON phases` : 'no cycle trial recorded',
      cycle ? (cycle.metrics.cycles === 3 ? 'PASS' : 'FAIL') : 'OPEN',
      cycle
        ? 'The server validated the saved protocol timeline before evaluating the frozen model.'
        : 'Record the guided three-cycle trial with the object switched on and off at the prompts.',
    ),
  );

  const cycleMetric = (
    id: string,
    label: string,
    threshold: string,
    value: number,
    limit: number,
    direction: 'min' | 'max',
    detail: string,
  ): FieldGateView => {
    if (!cycle) return gate(id, label, threshold, 'not measured', 'OPEN', 'The three-cycle trial has not been recorded.');
    const pass = direction === 'min' ? value >= limit : value <= limit;
    return gate(id, label, threshold, percent(value), pass ? 'PASS' : 'FAIL', detail);
  };

  gates.push(
    cycleMetric(
      'FIELD_PRECISION',
      'Held-out field precision',
      `≥${percent(FIELD_GATE_THRESHOLDS.precision)}`,
      cycle?.metrics.precision ?? 0,
      FIELD_GATE_THRESHOLDS.precision,
      'min',
      'Billed milliseconds that fell inside a protocol ON phase, divided by all billed milliseconds.',
    ),
  );
  gates.push(
    cycleMetric(
      'FIELD_RECALL',
      'Held-out field recall',
      `≥${percent(FIELD_GATE_THRESHOLDS.recall)}`,
      cycle?.metrics.recall ?? 0,
      FIELD_GATE_THRESHOLDS.recall,
      'min',
      'Protocol ON milliseconds that were billed, divided by all protocol ON milliseconds.',
    ),
  );
  gates.push(
    cycleMetric(
      'FALSE_BILLABLE',
      'False-billable time',
      `≤${percent(FIELD_GATE_THRESHOLDS.falseBillableRatio)} of protocol OFF time`,
      cycle?.metrics.falseBillableRatio ?? 0,
      FIELD_GATE_THRESHOLDS.falseBillableRatio,
      'max',
      'Billed milliseconds that fell inside a protocol OFF phase.',
    ),
  );
  gates.push(
    cycleMetric(
      'OVERBILLING',
      'Overbilling error',
      `≤${percent(FIELD_GATE_THRESHOLDS.overbillingRatio)} of expected running time`,
      cycle?.metrics.overbillingRatio ?? 0,
      FIELD_GATE_THRESHOLDS.overbillingRatio,
      'max',
      'Only excess billed time counts here; missed running time is measured separately by recall.',
    ),
  );
  gates.push(
    cycleMetric(
      'BILLING_ERROR',
      'Total billing duration error',
      `≤${percent(FIELD_GATE_THRESHOLDS.billingErrorRatio)} of observed time`,
      cycle?.metrics.billingErrorRatio ?? 0,
      FIELD_GATE_THRESHOLDS.billingErrorRatio,
      'max',
      'False-billed plus missed-running milliseconds, divided by the full duration of the three-cycle recording.',
    ),
  );

  const addTrialGate = (
    id: string,
    label: string,
    trial: FieldTrialView | undefined,
    threshold: string,
    value: number,
    limit: number,
    direction: 'min' | 'max',
    detail: string,
  ) => {
    if (!trial) {
      gates.push(gate(id, label, threshold, 'not measured', 'OPEN', `${label} has not been recorded.`));
      return;
    }
    const pass = direction === 'min' ? value >= limit : value <= limit;
    gates.push(gate(id, label, threshold, percent(value), pass ? 'PASS' : 'FAIL', detail));
  };

  addTrialGate(
    'NOISE_FALSE_BILLABLE',
    'Background-noise false billing',
    noise,
    '≤2.00%',
    noise?.metrics.falseBillableRatio ?? 0,
    FIELD_GATE_THRESHOLDS.noiseFalseBillableRatio,
    'max',
    'A 12-second room-noise-only trial must not be billed as the object running.',
  );
  addTrialGate(
    'DISTANCE_ACTIVE_RATIO',
    'Detection at distance',
    distance,
    '≥50.00%',
    distance?.metrics.activeRatio ?? 0,
    FIELD_GATE_THRESHOLDS.distanceActiveRatio,
    'min',
    'At least half of a 12-second recording with the object running at 2 m or more must remain billable.',
  );
  addTrialGate(
    'REPLAY_REJECTION',
    'Replay-attack rejection',
    replay,
    '≤5.00%',
    replay?.metrics.activeRatio ?? 0,
    FIELD_GATE_THRESHOLDS.replayActiveRatio,
    'max',
    'A speaker replay of a previously recorded object should not be billed. Audio-only rejection is a known limitation and is not claimed as anti-spoofing.',
  );

  const qualityTrials = [cycle, noise, distance, replay];
  const missingQuality = qualityTrials.some((trial) => !trial);
  const badQuality = qualityTrials.some((trial) => trial && !recordingQualityPasses(trial.recording.quality));
  gates.push(
    gate(
      'RECORDING_QUALITY',
      'All field recordings are usable',
      `frame coverage ≥${percent(FIELD_GATE_THRESHOLDS.minFrameCoverage)} · silence ≤${percent(FIELD_GATE_THRESHOLDS.maxSilentRatio)} · clipping ≤${percent(FIELD_GATE_THRESHOLDS.maxClippedRatio)}`,
      missingQuality ? 'not all trials recorded' : badQuality ? 'one or more recordings failed' : 'all usable',
      missingQuality ? 'OPEN' : badQuality ? 'FAIL' : 'PASS',
      'A silent, clipped or truncated capture cannot accidentally pass a trial by containing no evidence.',
    ),
  );

  return gates;
}

function latestReport(ctx: AppContext, modelId: string): FieldTestReport | null {
  const row = ctx.store.get<FieldReportRow>(
    'SELECT * FROM field_test_reports WHERE model_id = ? ORDER BY created_at DESC LIMIT 1',
    modelId,
  );
  return row ? (JSON.parse(row.report_json) as FieldTestReport) : null;
}

function protocolView() {
  return {
    schema: FIELD_PROTOCOL.schema,
    cycles: FIELD_PROTOCOL.cycles,
    cycleTotalMs: FIELD_PROTOCOL.cycleTotalMs,
    noiseMs: FIELD_PROTOCOL.noiseMs,
    distanceMs: FIELD_PROTOCOL.distanceMs,
    replayMs: FIELD_PROTOCOL.replayMs,
    gates: {
      precision: FIELD_GATE_THRESHOLDS.precision,
      recall: FIELD_GATE_THRESHOLDS.recall,
      falseBillableRatio: FIELD_GATE_THRESHOLDS.falseBillableRatio,
      overbillingRatio: FIELD_GATE_THRESHOLDS.overbillingRatio,
      billingErrorRatio: FIELD_GATE_THRESHOLDS.billingErrorRatio,
      noiseFalseBillableRatio: FIELD_GATE_THRESHOLDS.noiseFalseBillableRatio,
      distanceActiveRatio: FIELD_GATE_THRESHOLDS.distanceActiveRatio,
      replayActiveRatio: FIELD_GATE_THRESHOLDS.replayActiveRatio,
    },
  };
}

const STATE_LIMITATIONS = [
  'Field evidence is reported by the operator’s browser. The server recomputes every metric from uploaded acoustic features, but it cannot prove that a physical object was present.',
  'The report is an acoustic held-out measurement, not an anti-spoof or identity guarantee. A similar machine or a carefully shaped playback can sound like the enrolled object.',
  'One microphone in one room cannot distinguish two identical machines running together or secure an unattended venue.',
  'No raw audio is uploaded or stored. Only feature vectors, protocol labels and anonymised device references are kept.',
];

export function fieldTestState(ctx: AppContext, object: ObjectRow): FieldTestStateView {
  const model = activeModelFor(ctx, object);
  if (!model) {
    return {
      objectId: object.id,
      model: null,
      protocol: protocolView(),
      status: 'NOT_RUN',
      trials: [],
      gates: [],
      reportId: null,
      report: null,
      liveTraining: { idle: 0, active: 0, negative: 0, other: 0, nonLive: 0, datasetHashMatches: false },
      limitations: STATE_LIMITATIONS,
      nextStep: 'Record two live idle takes, two live operating takes and one live background take, then train the model.',
    };
  }
  const artifact = parseArtifact(model);
  const training = trainingSummaryFor(ctx, object.id, artifact.training.datasetHash);
  const trials = trialViewsFor(ctx, model, artifact);
  const gates = buildGates(model, training, trials);
  const report = latestReport(ctx, model.id);
  const complete = FIELD_TRIAL_KINDS.every((kind) => trials.some((trial) => trial.kind === kind));
  let status: FieldTestStateView['status'];
  if (model.provenance !== 'USER_CALIBRATION') status = 'NOT_ELIGIBLE';
  else if (complete) status = gates.every((entry) => entry.status === 'PASS') ? 'FIELD_PASS' : gates.some((entry) => entry.status === 'FAIL') ? 'FIELD_FAIL' : 'INCOMPLETE';
  else status = trials.length > 0 ? 'INCOMPLETE' : 'NOT_RUN';

  const nextTrial = FIELD_TRIAL_KINDS.find((kind) => !trials.some((trial) => trial.kind === kind));
  let nextStep: string;
  if (status === 'NOT_ELIGIBLE') {
    nextStep = 'This synthetic reference model is a separate reproducible demo. Create or calibrate an object from its own live recordings to run the real-world field protocol.';
  } else if (model.status !== 'READY') {
    nextStep = 'The active model is not READY. Improve the live calibration takes and retrain before field trials.';
  } else if (training.nonLive > 0) {
    nextStep = 'Remove imported or synthetic takes from the training set, then retrain with live recordings only.';
  } else if (!training.datasetHashMatches) {
    nextStep = 'Calibration data changed after training. Retrain so the field report names the exact model and dataset.';
  } else if (nextTrial) {
    nextStep = `Record the ${TRIAL_LABELS[nextTrial]} trial.`;
  } else if (status === 'FIELD_PASS') {
    nextStep = report
      ? 'The field test passed. Publish terms and open the Listening Room; the synthetic Judge Mode remains available separately.'
      : 'All gates pass. Generate the inspectable field-test report to unlock pricing and listening sessions.';
  } else {
    nextStep = 'One or more field gates failed. Review the measured values, retake only the failed trial, and never weaken the gate to force a pass.';
  }

  return {
    objectId: object.id,
    model: {
      id: model.id,
      version: model.version,
      hash: model.model_hash,
      status: model.status,
      provenance: model.provenance,
      datasetHash: model.dataset_hash,
      createdAt: model.created_at,
    },
    protocol: protocolView(),
    status,
    trials,
    gates,
    reportId: report?.id ?? null,
    report,
    liveTraining: training,
    limitations: STATE_LIMITATIONS,
    nextStep,
  };
}

export function submitFieldTrial(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  input: FieldTrialUpload,
): { trial: FieldTrialView; fieldTest: FieldTestStateView } {
  const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ? AND owner_id = ?', objectId, operator.id);
  if (!object) throw errors.notFound('Object not found');
  const model = activeModelFor(ctx, object);
  if (!model) throw errors.conflict('MODEL_NOT_READY', 'Train a model from live calibration takes before field trials.');
  if (model.provenance !== 'USER_CALIBRATION') {
    throw errors.conflict(
      'FIELD_TEST_NOT_APPLICABLE',
      'The synthetic reference model is a separate demo. Field validation applies only to a model trained from your own live recordings.',
    );
  }
  if (model.status !== 'READY') {
    throw errors.conflict('MODEL_NOT_READY', 'Only a READY model can enter field validation.');
  }
  const artifact = parseArtifact(model);
  const timelineProblems = validateFieldTimeline(input.kind as FieldTrialKind, input.timeline, input.durationMs);
  const frameProblems = validateFieldFrames(input.frames, input.frameFlags ?? [], input.durationMs);
  const problems = [...timelineProblems, ...frameProblems];
  if (problems.length > 0) throw errors.badRequest(problems.join(' '));

  const deviceLabel = input.deviceLabel?.trim() || null;
  const deviceRef = deviceLabel ? sha256Hex(deviceLabel).slice(0, 12) : null;
  const capturedAt = input.capturedAt;
  const capture = {
    deviceLabel,
    deviceRef,
    sampleRate: input.sampleRate,
    capturedAt,
    durationMs: Math.round(input.durationMs),
    note: 'Features were extracted from a live microphone in the operator’s browser. Raw audio was not uploaded or stored.',
  };
  const existing = ctx.store.get<FieldTrialRow>(
    'SELECT * FROM field_test_recordings WHERE model_id = ? AND trial_kind = ?',
    model.id,
    input.kind,
  );
  const now = ctx.now().toISOString();
  const id = existing?.id ?? newId('flt');
  const attempt = (existing?.attempt ?? 0) + 1;
  ctx.store.transaction(() => {
    if (existing) {
      ctx.store.run(
        `UPDATE field_test_recordings
         SET frames_json = ?, frame_flags_json = ?, timeline_json = ?, capture_json = ?, quality_json = ?,
             attempt = ?, created_at = ?
         WHERE id = ?`,
        JSON.stringify(input.frames),
        JSON.stringify(input.frameFlags ?? []),
        JSON.stringify(input.timeline),
        JSON.stringify(capture),
        JSON.stringify({}),
        attempt,
        now,
        id,
      );
    } else {
      ctx.store.run(
        `INSERT INTO field_test_recordings
           (id, object_id, model_id, trial_kind, frames_json, frame_flags_json, timeline_json, capture_json,
            quality_json, attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        object.id,
        model.id,
        input.kind,
        JSON.stringify(input.frames),
        JSON.stringify(input.frameFlags ?? []),
        JSON.stringify(input.timeline),
        JSON.stringify(capture),
        JSON.stringify({}),
        attempt,
        now,
      );
    }
    // Any stored report describes the previous evidence set and must be regenerated.
    ctx.store.run('DELETE FROM field_test_reports WHERE model_id = ?', model.id);
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'field_trial.recorded',
    subjectType: 'object',
    subjectId: object.id,
    metadata: {
      trialId: id,
      kind: input.kind,
      attempt,
      durationMs: capture.durationMs,
      frameCount: input.frames.length,
      deviceRef,
    },
  }, ctx.now());
  const state = fieldTestState(ctx, object);
  const trial = state.trials.find((entry) => entry.kind === input.kind);
  if (!trial) throw errors.internal('Field trial was stored but could not be evaluated');
  return { trial, fieldTest: state };
}

export function deleteFieldTrial(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
  trialId: string,
): FieldTestStateView {
  const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ? AND owner_id = ?', objectId, operator.id);
  if (!object) throw errors.notFound('Object not found');
  const row = ctx.store.get<FieldTrialRow>(
    'SELECT * FROM field_test_recordings WHERE id = ? AND object_id = ?',
    trialId,
    object.id,
  );
  if (!row) throw errors.notFound('Field trial not found');
  ctx.store.transaction(() => {
    ctx.store.run('DELETE FROM field_test_recordings WHERE id = ?', trialId);
    ctx.store.run('DELETE FROM field_test_reports WHERE model_id = ?', row.model_id);
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'field_trial.discarded',
    subjectType: 'object',
    subjectId: object.id,
    metadata: { trialId, kind: row.trial_kind, attempt: row.attempt },
  }, ctx.now());
  return fieldTestState(ctx, object);
}

function dynamicLimitations(gates: FieldGateView[], reportStatus: FieldTestReport['status']): string[] {
  const limitations = [...STATE_LIMITATIONS];
  const failed = gates.filter((entry) => entry.status === 'FAIL');
  if (reportStatus === 'FIELD_FAIL') {
    limitations.unshift(
      `This model failed ${failed.length} field gate${failed.length === 1 ? '' : 's'}${failed.length ? `: ${failed.map((entry) => entry.id).join(', ')}` : ''}. It is blocked from pricing and listening sessions; the gates were not relaxed.`,
    );
  }
  const replay = gates.find((entry) => entry.id === 'REPLAY_REJECTION');
  if (replay?.status === 'FAIL') {
    limitations.push(
      'The replay trial was billed. Audio-only sensing cannot reliably reject a speaker playback of the same machine; this model therefore failed the field gate rather than claiming replay resistance.',
    );
  }
  const distance = gates.find((entry) => entry.id === 'DISTANCE_ACTIVE_RATIO');
  if (distance?.status === 'FAIL') {
    limitations.push('The object was not detected often enough at 2 m or more; the operating range is narrower than the protocol requires.');
  }
  return limitations;
}

export function submitFieldReport(
  ctx: AppContext,
  operator: UserRow,
  objectId: string,
): { report: FieldTestReport; fieldTest: FieldTestStateView } {
  const object = ctx.store.get<ObjectRow>('SELECT * FROM objects WHERE id = ? AND owner_id = ?', objectId, operator.id);
  if (!object) throw errors.notFound('Object not found');
  const model = activeModelFor(ctx, object);
  if (!model) throw errors.conflict('MODEL_NOT_READY', 'Train a model before generating a field report.');
  if (model.provenance !== 'USER_CALIBRATION') {
    throw errors.conflict('FIELD_TEST_NOT_APPLICABLE', 'Synthetic reference models cannot receive a real-object field report.');
  }
  if (model.status !== 'READY') throw errors.conflict('MODEL_NOT_READY', 'Only a READY model can be field-validated.');
  const state = fieldTestState(ctx, object);
  const missing = FIELD_TRIAL_KINDS.filter((kind) => !state.trials.some((trial) => trial.kind === kind));
  if (missing.length > 0) {
    throw errors.conflict(
      'FIELD_TEST_INCOMPLETE',
      `Record all four field trials before generating the report. Missing: ${missing.map((kind) => TRIAL_LABELS[kind]).join(', ')}.`,
    );
  }
  const open = state.gates.filter((gateView) => gateView.status === 'OPEN');
  if (open.length > 0) {
    throw errors.conflict(
      'FIELD_TEST_INCOMPLETE',
      `Some gates cannot be evaluated yet: ${open.map((gateView) => gateView.id).join(', ')}. Fix the calibration gates and retry.`,
    );
  }
  const status: FieldTestReport['status'] = state.gates.every((gateView) => gateView.status === 'PASS')
    ? 'FIELD_PASS'
    : 'FIELD_FAIL';
  const cycle = state.trials.find((trial) => trial.kind === 'THREE_CYCLE')!;
  const noise = state.trials.find((trial) => trial.kind === 'NOISE')!;
  const distance = state.trials.find((trial) => trial.kind === 'DISTANCE')!;
  const replay = state.trials.find((trial) => trial.kind === 'REPLAY')!;
  const createdAt = ctx.now().toISOString();
  const id = newId('ftr');
  const limitations = dynamicLimitations(state.gates, status);
  const reportWithoutHash: Omit<FieldTestReport, 'evidenceHash'> = {
    schema: 'whirr.field-test.v1',
    id,
    object: { id: object.id, name: object.name, category: object.category, glyph: object.glyph },
    model: {
      id: model.id,
      version: model.version,
      hash: model.model_hash,
      status: model.status,
      provenance: 'USER_CALIBRATION',
      datasetHash: model.dataset_hash,
      createdAt: model.created_at,
    },
    status,
    outcomeDetail:
      status === 'FIELD_PASS'
        ? 'Every pre-declared safety gate passed on held-out field recordings. This model may be published and used in the Listening Room.'
        : 'One or more pre-declared safety gates failed. This model is blocked from pricing and listening sessions; no threshold was changed.',
    metrics: {
      trialCount: state.trials.length,
      cycles: cycle.metrics.cycles,
      precision: cycle.metrics.precision,
      recall: cycle.metrics.recall,
      falseBillableMs: cycle.metrics.falseBilledMs,
      falseBillableRatio: cycle.metrics.falseBillableRatio,
      overbillingRatio: cycle.metrics.overbillingRatio,
      billingErrorMs: cycle.metrics.billingErrorMs,
      billingErrorRatio: cycle.metrics.billingErrorRatio,
      noiseFalseBillableRatio: noise.metrics.falseBillableRatio,
      distanceActiveRatio: distance.metrics.activeRatio,
      replayActiveRatio: replay.metrics.activeRatio,
      totalRecordedMs: state.trials.reduce((total, trial) => total + trial.durationMs, 0),
      uncertainMs: cycle.metrics.uncertainMs,
    },
    gates: state.gates,
    trials: state.trials,
    recordingSet: {
      recordings: state.trials.length,
      totalDurationMs: state.trials.reduce((total, trial) => total + trial.durationMs, 0),
      liveMicrophoneClaims: state.trials.filter((trial) => trial.recording.provenance === 'CLIENT_CLAIMED_LIVE_MICROPHONE').length,
      rawAudioUploaded: false,
      anonymisedDeviceRefs: [...new Set(state.trials.map((trial) => trial.recording.deviceRef).filter((ref): ref is string => Boolean(ref)))],
    },
    methodology: [
      'The operator recorded four guided trials in the browser after the model was trained. The four trials were never used to fit the model.',
      'Raw audio stayed in the browser. The browser uploaded the frozen 21-feature frames and the protocol timeline; the local server re-ran the active model and precision-first hysteresis on them.',
      'The three-cycle trial compares billed ACTIVE_CONFIDENT milliseconds with the protocol ground truth: 4 s off, 5 s on, repeated three times, with a 4 s off tail.',
      'The noise trial is 12 s of background noise only and must not bill. The distance trial is 12 s with the object running at 2 m or more and must bill at least half. The replay trial is 12 s of a speaker playback and must bill at most 5%.',
      'Precision, recall, false-billable duration, overbilling and total billing error are computed from interval overlap, not from a self-reported summary.',
      'The model must be READY, every training take must be live, the dataset hash must match, and every capture must have adequate frame coverage and quality before gates are evaluated.',
    ],
    limitations,
    attestation:
      'Client-reported live-microphone evidence, validated structurally and recomputed by the local server. This report is not a proof of physical presence, identity, tamper resistance or immunity to playback.',
    createdAt,
  };
  const evidenceHash = hashCanonical(reportWithoutHash);
  const report: FieldTestReport = { ...reportWithoutHash, evidenceHash };
  ctx.store.transaction(() => {
    ctx.store.run(
      `INSERT INTO field_test_reports (id, object_id, model_id, status, report_json, evidence_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model_id) DO UPDATE SET
         id = excluded.id,
         object_id = excluded.object_id,
         status = excluded.status,
         report_json = excluded.report_json,
         evidence_hash = excluded.evidence_hash,
         created_at = excluded.created_at`,
      id,
      object.id,
      model.id,
      status,
      JSON.stringify(report),
      evidenceHash,
      createdAt,
    );
  });
  appendAudit(ctx.store, {
    actorType: 'operator',
    actorId: operator.id,
    action: 'field_report.generated',
    subjectType: 'object',
    subjectId: object.id,
    metadata: {
      reportId: id,
      modelId: model.id,
      status,
      evidenceHash,
      gates: state.gates.map((gateView) => ({ id: gateView.id, status: gateView.status })),
    },
  }, ctx.now());
  return { report, fieldTest: fieldTestState(ctx, object) };
}

export function fieldReportForModel(ctx: AppContext, modelId: string): { id: string; status: string } | null {
  return (
    ctx.store.get<{ id: string; status: string }>(
      'SELECT id, status FROM field_test_reports WHERE model_id = ? ORDER BY created_at DESC LIMIT 1',
      modelId,
    ) ?? null
  );
}

/**
 * A USER_CALIBRATION model is not publishable until its own frozen hash has a
 * passing field report. Synthetic reference models are unaffected: they are a
 * separate, clearly labelled demo.
 */
export function assertFieldValidationPassed(ctx: AppContext, model: ModelRow): void {
  if (model.provenance !== 'USER_CALIBRATION') return;
  const report = fieldReportForModel(ctx, model.id);
  if (!report || report.status !== 'FIELD_PASS') {
    throw errors.conflict(
      'FIELD_TEST_REQUIRED',
      'This model was trained from live recordings. Complete the Real-World Calibration Lab and pass every field gate before publishing terms or starting a Listening Room session.',
      { modelId: model.id, modelVersion: model.version, reportStatus: report?.status ?? 'NOT_RUN' },
    );
  }
}

export function fieldValidationSummary(
  ctx: AppContext,
  model: ModelRow,
): FieldValidationSummary {
  if (model.provenance !== 'USER_CALIBRATION') {
    return {
      required: false,
      status: 'NOT_REQUIRED',
      reportId: null,
      reportUrl: null,
      detail: 'Synthetic reference model. Metrics come from procedurally generated fixtures, not a physical object.',
    };
  }
  const report = fieldReportForModel(ctx, model.id);
  const status =
    report?.status === 'FIELD_PASS'
      ? 'FIELD_PASS'
      : report?.status === 'FIELD_FAIL'
        ? 'FIELD_FAIL'
        : 'NOT_RUN';
  return {
    required: true,
    status,
    reportId: report?.id ?? null,
    reportUrl: report ? `${ctx.config.primaryPublicOrigin}/field-report/${report.id}` : null,
    detail:
      status === 'FIELD_PASS'
        ? 'A real-object field test passed on held-out live recordings. The report is public and inspectable.'
        : status === 'FIELD_FAIL'
          ? 'The field test failed. This model is blocked from billing until a new test passes.'
          : 'This model has not completed real-object field validation.',
  };
}

export function publicFieldReport(ctx: AppContext, reportId: string): FieldTestReport {
  const row = ctx.store.get<FieldReportRow>('SELECT * FROM field_test_reports WHERE id = ?', reportId);
  if (!row) throw errors.notFound('Field-test report not found');
  return JSON.parse(row.report_json) as FieldTestReport;
}

export const FIELD_TRIAL_LABELS = TRIAL_LABELS;
