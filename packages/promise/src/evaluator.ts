import { canonicalJson, sha256Hex } from '../../protocol/src/index.ts';
import {
  PROMISE_EVALUATION_SCHEMA,
  PROMISE_EVALUATOR_VERSION,
  type PromiseAgreementTerms,
  type PromiseCheck,
  type PromiseEvaluation,
  type PromiseEvent,
  type PromiseObservation,
  type PromiseOutcome,
  type ReportingState,
} from './types.ts';

export interface PromiseEvaluationInput {
  terms: PromiseAgreementTerms;
  agreementHash: string;
  observations: PromiseObservation[];
  /** The model currently attached to the object, when the caller can check it. */
  currentModelHash?: string;
  /** Evaluation time. Supplying it lets the caller prove the authorization had not expired. */
  now?: string;
}

const BLOCKING_FLAGS = new Set([
  'CLIPPED',
  'SILENT',
  'LOW_LEVEL',
  'GAP',
  'DEVICE_LOST',
  'TAB_HIDDEN',
  'SOUNDPRINT_MISMATCH',
  'UNKNOWN_OBJECT',
  'LOW_CONFIDENCE',
]);

const MIN_IDLE_BASELINE_MS = 1_000;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isReportingState(value: unknown): value is ReportingState {
  return value === 'IDLE' || value === 'ACTIVE_CONFIDENT' || value === 'UNCERTAIN' || value === 'DISCONNECTED';
}

interface Run {
  startMs: number;
  endMs: number;
  stop: 'IDLE' | 'UNCERTAIN' | 'DISCONNECTED' | 'OPEN';
  confidence: number;
}

function validateObservations(observations: PromiseObservation[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(observations) || observations.length === 0) {
    return ['No observation intervals were supplied.'];
  }
  if (observations.length > 20_000) errors.push('The observation batch is too large to evaluate.');
  let previous: PromiseObservation | null = null;
  for (let index = 0; index < observations.length; index += 1) {
    const obs = observations[index]!;
    if (!obs || typeof obs !== 'object') {
      errors.push(`Observation ${index} is not an object.`);
      continue;
    }
    if (!Number.isSafeInteger(obs.seq) || obs.seq < 1) errors.push(`Observation ${index} has an invalid sequence number.`);
    if (!Number.isSafeInteger(obs.startMs) || obs.startMs < 0) errors.push(`Observation ${index} has an invalid start time.`);
    if (!Number.isSafeInteger(obs.endMs) || obs.endMs <= obs.startMs) errors.push(`Observation ${index} has an invalid end time.`);
    if (!isReportingState(obs.state)) errors.push(`Observation ${index} has an unsupported state.`);
    if (!isFiniteNonNegative(obs.confidence) || obs.confidence > 1) errors.push(`Observation ${index} has an invalid confidence.`);
    if (!Array.isArray(obs.qualityFlags) || obs.qualityFlags.some((flag) => typeof flag !== 'string')) {
      errors.push(`Observation ${index} has invalid quality flags.`);
    }
    if (obs.eventMatch !== undefined && (!isFiniteNonNegative(obs.eventMatch) || obs.eventMatch > 1)) {
      errors.push(`Observation ${index} has an invalid event match score.`);
    }
    if (previous) {
      if (obs.startMs < previous.endMs) errors.push(`Observation ${index} overlaps the previous interval.`);
      if (obs.seq <= previous.seq) errors.push(`Observation ${index} is out of sequence.`);
      if (obs.startMs < previous.startMs) errors.push(`Observation ${index} moves backwards in time.`);
    }
    previous = obs;
  }
  return errors;
}

function blockedByEvidence(obs: PromiseObservation, confidenceFloor: number): boolean {
  if (obs.state !== 'ACTIVE_CONFIDENT') return false;
  if (obs.confidence < confidenceFloor) return true;
  if (obs.qualityFlags.some((flag) => BLOCKING_FLAGS.has(flag))) return true;
  if (obs.eventMatch !== undefined && obs.eventMatch < 0.5) return true;
  return false;
}

function makeCheck(id: string, label: string, status: PromiseCheck['status'], detail: string): PromiseCheck {
  return { id, label, status, detail };
}

function outcomeReason(outcome: PromiseOutcome): string {
  switch (outcome) {
    case 'QUALIFIED':
      return 'The approved sequence, duration, confidence, and continuity conditions were satisfied.';
    case 'INTERRUPTED':
      return 'The machine started but stopped before the approved minimum operating duration. No capture is eligible.';
    case 'UNCERTAIN':
      return 'An uncertain or low-confidence interval interrupted the required sequence. No capture is eligible.';
    case 'SENSOR_LOST':
      return 'The microphone or sensing stream disconnected during the attempt. No capture is eligible.';
    case 'EXPIRED':
      return 'The agreement or its PayPal authorization expired before this evidence could be captured. No capture is eligible.';
    case 'REJECTED':
      return 'The observations failed a structural contract rule, such as extra cycles, excessive gaps, or an overlong run. No capture is eligible.';
    case 'INCOMPLETE':
    default:
      return 'The required start, sustained run, or completion evidence was not established. No capture is eligible.';
  }
}

export async function evaluatePromise(input: PromiseEvaluationInput): Promise<PromiseEvaluation> {
  const { terms, agreementHash, observations } = input;
  const confidenceFloor = terms.constraints.confidenceFloor;
  const validationErrors = validateObservations(observations);
  const ordered = [...observations].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  const observationsHash = await sha256Hex(canonicalJson({ schema: 'whirr.promise-observations.v1', observations: ordered }));
  const checks: PromiseCheck[] = [];
  const events: PromiseEvent[] = [];
  const uncertainties: string[] = [];

  const observedMs = ordered.reduce((sum, obs) => sum + Math.max(0, obs.endMs - obs.startMs), 0);
  const idleMs = ordered.filter((obs) => obs.state === 'IDLE').reduce((sum, obs) => sum + Math.max(0, obs.endMs - obs.startMs), 0);
  const rawUncertainMs = ordered
    .filter((obs) => obs.state === 'UNCERTAIN')
    .reduce((sum, obs) => sum + Math.max(0, obs.endMs - obs.startMs), 0);
  const sensorLossMs = ordered
    .filter((obs) => obs.state === 'DISCONNECTED')
    .reduce((sum, obs) => sum + Math.max(0, obs.endMs - obs.startMs), 0);
  const minConfidence = ordered.length === 0 ? 0 : Math.min(...ordered.map((obs) => obs.confidence));
  let maxGapMs = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    maxGapMs = Math.max(maxGapMs, ordered[index]!.startMs - ordered[index - 1]!.endMs);
  }

  const runs: Run[] = [];
  let activeStart: number | null = null;
  let activeConfidence = 0;
  let firstActiveStart: number | null = null;
  let firstExpectedStop: number | null = null;
  let blockedActiveSeen = false;
  let disconnectedBeforeStop = false;
  let uncertainBeforeStop = false;
  let incompleteRun: Run | null = null;
  let overlongRun = false;
  let extraCycle = false;

  for (const obs of ordered) {
    if (obs.state === 'ACTIVE_CONFIDENT' && !blockedByEvidence(obs, confidenceFloor)) {
      if (activeStart === null) {
        activeStart = obs.startMs;
        activeConfidence = obs.confidence;
        if (firstActiveStart === null) firstActiveStart = obs.startMs;
        else if (firstExpectedStop !== null) extraCycle = true;
      } else {
        activeConfidence = Math.min(activeConfidence, obs.confidence);
      }
      continue;
    }

    if (activeStart !== null) {
      const stop = obs.state === 'IDLE' ? 'IDLE' : obs.state === 'DISCONNECTED' ? 'DISCONNECTED' : 'UNCERTAIN';
      const run: Run = { startMs: activeStart, endMs: obs.startMs, stop, confidence: activeConfidence };
      runs.push(run);
      if (firstExpectedStop === null && stop === 'IDLE') firstExpectedStop = obs.startMs;
      if (run.endMs - run.startMs > terms.constraints.maxRunMs) overlongRun = true;
      if (stop === 'DISCONNECTED') disconnectedBeforeStop = true;
      if (stop === 'UNCERTAIN') uncertainBeforeStop = true;
      if (run.endMs - run.startMs < terms.constraints.minRunMs) incompleteRun = run;
      activeStart = null;
    }

    if (obs.state === 'DISCONNECTED') disconnectedBeforeStop = true;
    if (obs.state === 'UNCERTAIN') uncertainBeforeStop = true;
    if (obs.state === 'ACTIVE_CONFIDENT' && blockedByEvidence(obs, confidenceFloor)) {
      blockedActiveSeen = true;
      uncertainBeforeStop = true;
      uncertainties.push(
        obs.confidence < confidenceFloor
          ? `Active interval at ${obs.startMs}ms fell below the ${confidenceFloor.toFixed(2)} confidence floor.`
          : `Active interval at ${obs.startMs}ms carried a disqualifying quality flag.`,
      );
    }
  }

  if (activeStart !== null) {
    const endMs = ordered[ordered.length - 1]?.endMs ?? activeStart;
    const run: Run = { startMs: activeStart, endMs, stop: 'OPEN', confidence: activeConfidence };
    runs.push(run);
    if (run.endMs - run.startMs < terms.constraints.minRunMs) incompleteRun = run;
    if (run.endMs - run.startMs > terms.constraints.maxRunMs) overlongRun = true;
  }

  const runMs = runs.reduce((sum, run) => sum + Math.max(0, run.endMs - run.startMs), 0);
  const firstRun = runs[0];
  const idleBeforeActive =
    firstActiveStart === null
      ? idleMs
      : ordered
          .filter((obs) => obs.endMs <= firstActiveStart! && obs.state === 'IDLE')
          .reduce((sum, obs) => sum + (obs.endMs - obs.startMs), 0);

  const agreementParsed = Date.parse(terms.createdAt);
  const agreementExpires = Date.parse(terms.expiresAt);
  const now = input.now === undefined ? Number.NaN : Date.parse(input.now);
  const timeKnown = Number.isFinite(now);
  const notExpired = timeKnown ? agreementExpires > now : true;

  checks.push(
    makeCheck(
      'observation_shape',
      'Observation record is well formed',
      validationErrors.length === 0 ? 'PASS' : 'FAIL',
      validationErrors[0] ?? `${ordered.length} ordered intervals supplied.`,
    ),
  );
  checks.push(
    makeCheck(
      'agreement_hash',
      'Agreement matches its approved digest',
      /^[a-f0-9]{64}$/.test(agreementHash) ? 'PASS' : 'FAIL',
      /^[a-f0-9]{64}$/.test(agreementHash) ? `Agreement ${agreementHash.slice(0, 16)}…` : 'Missing or malformed agreement digest.',
    ),
  );
  checks.push(
    makeCheck(
      'model_binding',
      'Event model binding matches',
      input.currentModelHash === undefined || input.currentModelHash === terms.eventModel.hash ? 'PASS' : 'FAIL',
      input.currentModelHash === undefined
        ? 'No independent current-model check was requested.'
        : input.currentModelHash === terms.eventModel.hash
          ? 'The approved model is still attached to this object.'
          : 'The object now points at a different model. The approved agreement cannot use it.',
    ),
  );
  checks.push(
    makeCheck(
      'agreement_time',
      'Agreement is within its approval window',
      timeKnown ? (notExpired && Number.isFinite(agreementParsed) ? 'PASS' : 'FAIL') : 'UNKNOWN',
      timeKnown ? (notExpired ? `Valid until ${terms.expiresAt}.` : `Expired at ${terms.expiresAt}.`) : 'Evaluation time was not supplied.',
    ),
  );
  checks.push(
    makeCheck(
      'idle_baseline',
      'Idle baseline was observed',
      idleBeforeActive >= MIN_IDLE_BASELINE_MS ? 'PASS' : 'FAIL',
      `${(idleBeforeActive / 1000).toFixed(2)}s of confident idle before the first run; ${(MIN_IDLE_BASELINE_MS / 1000).toFixed(1)}s required.`,
    ),
  );
  checks.push(
    makeCheck(
      'start_observed',
      'Start was observed',
      firstActiveStart !== null ? 'PASS' : 'FAIL',
      firstActiveStart !== null ? `Sustained active state began at ${firstActiveStart}ms.` : 'No confident active interval was observed.',
    ),
  );
  checks.push(
    makeCheck(
      'single_cycle',
      'Exactly one operating cycle',
      !extraCycle && runs.length <= 1 ? 'PASS' : 'FAIL',
      extraCycle || runs.length > 1
        ? 'A restart or second run appeared after an earlier stop. Interrupted work must start a new execution.'
        : 'One run recorded.',
    ),
  );
  checks.push(
    makeCheck(
      'sensor_continuity',
      'Sensor continuity held',
      !disconnectedBeforeStop && sensorLossMs === 0 ? 'PASS' : 'FAIL',
      sensorLossMs === 0 ? 'No disconnected interval.' : `${(sensorLossMs / 1000).toFixed(2)}s of sensor loss.`,
    ),
  );
  checks.push(
    makeCheck(
      'observation_gaps',
      'Observation gaps stayed within bounds',
      maxGapMs <= terms.constraints.maxObservationGapMs ? 'PASS' : 'FAIL',
      `Largest gap ${maxGapMs}ms; limit ${terms.constraints.maxObservationGapMs}ms.`,
    ),
  );
  checks.push(
    makeCheck(
      'minimum_duration',
      'Minimum operating duration was met',
      runMs >= terms.constraints.minRunMs ? 'PASS' : 'FAIL',
      `${(runMs / 1000).toFixed(2)}s run; ${(terms.constraints.minRunMs / 1000).toFixed(2)}s required.`,
    ),
  );
  checks.push(
    makeCheck(
      'maximum_duration',
      'Maximum operating duration was respected',
      !overlongRun && runMs <= terms.constraints.maxRunMs ? 'PASS' : 'FAIL',
      `${(runMs / 1000).toFixed(2)}s run; limit ${(terms.constraints.maxRunMs / 1000).toFixed(2)}s.`,
    ),
  );
  checks.push(
    makeCheck(
      'expected_stop',
      'Expected stop completed the cycle',
      firstExpectedStop !== null ? 'PASS' : 'FAIL',
      firstExpectedStop !== null
        ? `Confident idle returned at ${firstExpectedStop}ms after the run.`
        : 'The run never returned to confident idle, so completion was not established.',
    ),
  );
  checks.push(
    makeCheck(
      'uncertainty',
      'No uncertain interval contaminated the cycle',
      !uncertainBeforeStop && rawUncertainMs === 0 && !blockedActiveSeen ? 'PASS' : 'FAIL',
      rawUncertainMs === 0 && !blockedActiveSeen
        ? 'All observations met the confidence and quality requirements.'
        : `${(rawUncertainMs / 1000).toFixed(2)}s uncertain; the agreement requires none.`,
    ),
  );
  checks.push(
    makeCheck(
      'confidence_floor',
      'Confidence floor was respected',
      minConfidence >= confidenceFloor ? 'PASS' : 'FAIL',
      `Lowest observed confidence ${minConfidence.toFixed(3)}; floor ${confidenceFloor.toFixed(3)}.`,
    ),
  );
  checks.push(
    makeCheck(
      'charge_ceiling',
      'Price is within the approved ceiling',
      terms.financial.fixedPriceMinor > 0 && terms.financial.fixedPriceMinor <= terms.financial.maximumChargeMinor ? 'PASS' : 'FAIL',
      `Fixed price ${terms.financial.fixedPriceMinor}; maximum ${terms.financial.maximumChargeMinor} ${terms.financial.currency}.`,
    ),
  );

  if (ordered.length > 0) {
    events.push({
      label: 'IDLE',
      atMs: ordered[0]!.startMs,
      evidence: 'OBSERVED',
      confidence: ordered[0]!.confidence,
      detail: 'An idle baseline was captured before the operating attempt.',
    });
  }
  if (firstActiveStart !== null) {
    events.push({
      label: 'START',
      atMs: firstActiveStart,
      evidence: 'OBSERVED',
      confidence: firstRun?.confidence ?? 0,
      detail: 'Confident active state began after idle.',
    });
    events.push({
      label: 'RUNNING',
      atMs: firstActiveStart + Math.min(1_000, Math.max(0, (firstRun?.endMs ?? firstActiveStart) - firstActiveStart)),
      evidence: 'INFERRED',
      confidence: firstRun?.confidence ?? 0,
      detail: 'Sustained operation was inferred from consecutive confident active intervals.',
    });
  }
  if (firstExpectedStop !== null) {
    events.push({
      label: 'EXPECTED_STOP',
      atMs: firstExpectedStop,
      evidence: 'INFERRED',
      confidence: 1,
      detail: 'Confident idle returned after the minimum run. This is a temporal stop inference, not a separately classified completion sound.',
    });
  } else if (runs.some((run) => run.stop === 'OPEN')) {
    events.push({
      label: 'INTERRUPTED',
      atMs: ordered[ordered.length - 1]?.endMs ?? 0,
      evidence: 'REJECTED',
      confidence: 0,
      detail: 'The recording ended while the machine was still active; no stop evidence exists.',
    });
  } else if (incompleteRun) {
    events.push({
      label: 'INTERRUPTED',
      atMs: incompleteRun.endMs,
      evidence: 'REJECTED',
      confidence: incompleteRun.confidence,
      detail: `The run stopped after ${((incompleteRun.endMs - incompleteRun.startMs) / 1000).toFixed(2)}s, below the approved minimum.`,
    });
  }
  if (disconnectedBeforeStop) {
    events.push({
      label: 'SENSOR_LOST',
      atMs: ordered.find((obs) => obs.state === 'DISCONNECTED')?.startMs ?? 0,
      evidence: 'REJECTED',
      confidence: 0,
      detail: 'The sensing stream disconnected before the cycle completed.',
    });
  }
  if (uncertainBeforeStop) {
    events.push({
      label: 'UNCERTAIN',
      atMs: ordered.find((obs) => obs.state === 'UNCERTAIN')?.startMs ?? firstActiveStart ?? 0,
      evidence: 'REJECTED',
      confidence: 0,
      detail: 'Uncertain or low-confidence evidence appeared during the attempt.',
    });
  }

  const structuralFailure = validationErrors.length > 0;
  const failedChecks = new Set(checks.filter((check) => check.status === 'FAIL').map((check) => check.id));
  let outcome: PromiseOutcome = 'QUALIFIED';
  if (structuralFailure) outcome = 'REJECTED';
  else if (disconnectedBeforeStop || failedChecks.has('sensor_continuity')) outcome = 'SENSOR_LOST';
  else if (uncertainBeforeStop || failedChecks.has('uncertainty') || failedChecks.has('confidence_floor')) outcome = 'UNCERTAIN';
  else if (extraCycle || overlongRun || failedChecks.has('single_cycle') || failedChecks.has('maximum_duration') || failedChecks.has('observation_gaps')) {
    outcome = 'REJECTED';
  } else if (incompleteRun || (failedChecks.has('minimum_duration') && firstExpectedStop !== null)) outcome = 'INTERRUPTED';
  else if (firstActiveStart === null || firstExpectedStop === null || failedChecks.has('start_observed') || failedChecks.has('expected_stop') || failedChecks.has('idle_baseline')) {
    outcome = 'INCOMPLETE';
  } else if (failedChecks.has('model_binding') || failedChecks.has('agreement_hash') || failedChecks.has('charge_ceiling')) {
    outcome = 'REJECTED';
  }

  const eligibleForCapture = outcome === 'QUALIFIED';
  if (eligibleForCapture && timeKnown && !notExpired) outcome = 'EXPIRED';

  const finalEligible = outcome === 'QUALIFIED';
  for (const check of checks) {
    if (check.status === 'FAIL' && !uncertainties.includes(check.detail)) uncertainties.push(check.detail);
  }
  const reason =
    outcome === 'QUALIFIED'
      ? outcomeReason('QUALIFIED')
      : failedChecks.size > 0
        ? `${outcomeReason(outcome)} First failed condition: ${checks.find((check) => check.status === 'FAIL')?.detail ?? 'unknown'}`
        : outcomeReason(outcome);

  const evidenceRoot = await sha256Hex(
    canonicalJson({
      schema: 'whirr.promise-evidence.v1',
      agreementHash,
      modelHash: terms.eventModel.hash,
      observationsHash,
      events,
      checks,
      outcome,
      evaluatorVersion: PROMISE_EVALUATOR_VERSION,
    }),
  );

  return {
    schema: PROMISE_EVALUATION_SCHEMA,
    evaluatorVersion: PROMISE_EVALUATOR_VERSION,
    agreementHash,
    modelHash: terms.eventModel.hash,
    outcome,
    eligibleForCapture: finalEligible,
    priceMinor: terms.financial.fixedPriceMinor,
    currency: terms.financial.currency,
    events,
    checks,
    observedMs,
    runMs,
    idleMs,
    uncertainMs: rawUncertainMs,
    sensorLossMs,
    maxObservationGapMs: maxGapMs,
    minConfidence: ordered.length === 0 ? 0 : minConfidence,
    uncertainties: [...new Set(uncertainties)],
    evidenceRoot,
    observationsHash,
    reason,
  };
}
