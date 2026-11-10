import { canonicalJson, sha256Hex } from '../../protocol/src/index.ts';
import {
  AMBIENT_EVALUATION_SCHEMA,
  AMBIENT_EVALUATOR_VERSION,
  type AmbientAgreementTerms,
  type AmbientCheck,
  type AmbientEvaluation,
  type AmbientEvaluationInput,
  type AmbientEvent,
  type AmbientOutcome,
  type AmbientObservation,
  type SourceState,
} from './types.ts';

const BLOCKING_FLAGS = new Set([
  'MICROPHONE_DENIED',
  'SENSOR_DISCONNECTED',
  'CLIPPED',
  'FLATLINE',
  'TAB_HIDDEN',
  'LOW_CONFIDENCE',
  'MODEL_UNAVAILABLE',
  'STALE_FRAME',
  'INTERFERENCE',
  'GAIN_UNSTABLE',
  'DEVICE_MOVED',
]);

const SENSOR_LOSS_FLAGS = new Set(['MICROPHONE_DENIED', 'SENSOR_DISCONNECTED', 'DEVICE_LOST']);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSourceState(value: unknown): value is SourceState {
  return value === 'ACTIVE' || value === 'INACTIVE' || value === 'UNKNOWN' || value === 'DISCONNECTED';
}

function validateObservations(observations: AmbientObservation[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(observations) || observations.length === 0) {
    return ['No observation intervals were supplied.'];
  }
  if (observations.length > 20_000) errors.push('The observation batch is too large to evaluate.');
  let previous: AmbientObservation | null = null;
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]!;
    if (!observation || typeof observation !== 'object') {
      errors.push(`Observation ${index} is not an object.`);
      continue;
    }
    if (!Number.isSafeInteger(observation.seq) || observation.seq < 1) {
      errors.push(`Observation ${index} has an invalid sequence number.`);
    }
    if (!Number.isSafeInteger(observation.startMs) || observation.startMs < 0) {
      errors.push(`Observation ${index} has an invalid start time.`);
    }
    if (!Number.isSafeInteger(observation.endMs) || observation.endMs <= observation.startMs) {
      errors.push(`Observation ${index} has an invalid end time.`);
    }
    if (!isSourceState(observation.sourceState)) errors.push(`Observation ${index} has an unsupported source state.`);
    if (!isFiniteNonNegative(observation.confidence) || observation.confidence > 1) {
      errors.push(`Observation ${index} has an invalid confidence.`);
    }
    if (!Array.isArray(observation.qualityFlags) || observation.qualityFlags.some((flag) => typeof flag !== 'string')) {
      errors.push(`Observation ${index} has invalid quality flags.`);
    }
    if (
      observation.eventMatch !== undefined &&
      (!isFiniteNonNegative(observation.eventMatch) || observation.eventMatch > 1)
    ) {
      errors.push(`Observation ${index} has an invalid event match score.`);
    }
    if (previous) {
      if (observation.seq <= previous.seq) errors.push(`Observation ${index} is out of sequence.`);
      if (observation.startMs < previous.endMs) errors.push(`Observation ${index} overlaps the previous interval.`);
      if (observation.startMs < previous.startMs) errors.push(`Observation ${index} moves backwards in time.`);
    }
    previous = observation;
  }
  return errors;
}

function check(
  id: string,
  label: string,
  status: AmbientCheck['status'],
  detail: string,
): AmbientCheck {
  return { id, label, status, detail };
}

function reasonFor(outcome: AmbientOutcome): string {
  switch (outcome) {
    case 'QUALIFIED':
      return 'The enrolled source was observed active, then remained undetected for the full approved window while sensing stayed observable. Buyer acceptance is still required.';
    case 'NO_BASELINE':
      return 'Whirr did not observe the enrolled source active before the quiet window, so it cannot treat a missing signal as evidence of the requested change. No capture is eligible.';
    case 'INTERRUPTED':
      return 'The enrolled source was detected active during the quiet window. The qualifying interval reset and did not complete. No capture is eligible.';
    case 'SENSOR_LOSS':
      return 'The microphone, sensing stream, or observability checks failed during the attempt. The absence of detections cannot be treated as a valid quiet window. No capture is eligible.';
    case 'INSUFFICIENT_EVIDENCE':
      return 'The observation ended before the required continuous quiet window was established, or uncertain evidence interrupted it. No capture is eligible.';
    case 'EXPIRED':
      return 'The agreement or its authorization window expired before the required evidence was complete. No capture is eligible.';
    case 'REJECTED':
    default:
      return 'The evidence did not satisfy the structural or model-binding rules of the agreement. No capture is eligible.';
  }
}

function canonicalObservation(observation: AmbientObservation): Record<string, unknown> {
  return {
    seq: observation.seq,
    startMs: observation.startMs,
    endMs: observation.endMs,
    sourceState: observation.sourceState,
    confidence: observation.confidence,
    qualityFlags: [...observation.qualityFlags].sort(),
    ...(observation.eventMatch === undefined ? {} : { eventMatch: observation.eventMatch }),
  };
}

export async function evaluateAmbientAgreement(input: AmbientEvaluationInput): Promise<AmbientEvaluation> {
  const { terms, agreementHash } = input;
  const ordered = [...input.observations].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  const validationErrors = validateObservations(ordered);
  const observationsHash = await sha256Hex(
    canonicalJson({
      schema: 'whirr.ambient-observations.v1',
      observations: ordered.map(canonicalObservation),
    }),
  );

  const requiredInactiveMs = terms.condition.requiredInactiveMs;
  const requiredBaselineActiveMs = terms.condition.requiredBaselineActiveMs;
  const confidenceFloor = terms.condition.confidenceFloor;
  const maxAllowedGapMs = terms.condition.maxObservationGapMs;

  let baselineActiveMs = 0;
  let activeMs = 0;
  let inactiveMs = 0;
  let unknownMs = 0;
  let sensorLossMs = 0;
  let maxGapMs = 0;
  let longestInactiveMs = 0;
  let currentRunMs = 0;
  let qualifyingStartMs: number | null = null;
  let qualifyingEndMs: number | null = null;
  let interruptions = 0;
  let sensorLoss = false;
  let qualified = false;
  let sawBaselineActive = false;
  let baselineMet = false;
  const uncertainties: string[] = [];
  const events: AmbientEvent[] = [];

  let previousEnd: number | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const observation = ordered[index]!;
    const duration = Math.max(0, observation.endMs - observation.startMs);
    const gap = previousEnd === null ? 0 : Math.max(0, observation.startMs - previousEnd);
    maxGapMs = Math.max(maxGapMs, gap);
    previousEnd = Math.max(previousEnd ?? 0, observation.endMs);

    if (gap > maxAllowedGapMs && !qualified) {
      uncertainties.push(`A ${gap}ms gap at ${observation.startMs}ms exceeded the approved ${maxAllowedGapMs}ms evidence gap.`);
      currentRunMs = 0;
      qualifyingStartMs = null;
    } else if (gap > 0 && !qualified) {
      uncertainties.push(`A ${gap}ms gap at ${observation.startMs}ms is recorded as uncertainty; the run cannot bridge it.`);
      currentRunMs = 0;
      qualifyingStartMs = null;
    }

    const sensorLossFlag =
      observation.sourceState === 'DISCONNECTED' ||
      observation.qualityFlags.some((flag) => SENSOR_LOSS_FLAGS.has(flag));
    const blocked = observation.qualityFlags.some((flag) => BLOCKING_FLAGS.has(flag));
    const confident = observation.confidence >= confidenceFloor && !blocked;
    let state: SourceState = observation.sourceState;
    if (state === 'ACTIVE' && !confident) state = 'UNKNOWN';
    if (state === 'INACTIVE' && !confident) state = 'UNKNOWN';
    if (sensorLossFlag) state = 'DISCONNECTED';

    if (state === 'DISCONNECTED') {
      sensorLossMs += duration;
      sensorLoss = true;
      if (!qualified) {
        currentRunMs = 0;
        qualifyingStartMs = null;
      }
      if (sensorLossMs === duration) {
        events.push({
          type: 'SENSOR_LOSS',
          atMs: observation.startMs,
          evidence: 'OBSERVED',
          confidence: observation.confidence,
          detail: 'The sensing stream reported loss or a disqualifying observability failure.',
        });
      }
      continue;
    }

    if (state === 'UNKNOWN') {
      unknownMs += duration;
      if (!qualified) {
        currentRunMs = 0;
        qualifyingStartMs = null;
      }
      if (observation.confidence < confidenceFloor) {
        uncertainties.push(
          `Evidence at ${observation.startMs}ms was below the ${confidenceFloor.toFixed(2)} confidence floor.`,
        );
      } else if (observation.qualityFlags.length > 0) {
        uncertainties.push(
          `Evidence at ${observation.startMs}ms carried blocking quality flags: ${observation.qualityFlags.join(', ')}.`,
        );
      }
      continue;
    }

    if (state === 'ACTIVE') {
      activeMs += duration;
      if (!sawBaselineActive) {
        sawBaselineActive = true;
        events.push({
          type: 'BASELINE_ACTIVE',
          atMs: observation.startMs,
          evidence: 'OBSERVED',
          confidence: observation.confidence,
          detail: 'The enrolled source was confidently detected before the quiet window.',
        });
      }
      baselineActiveMs += duration;
      if (!baselineMet && baselineActiveMs >= requiredBaselineActiveMs) {
        baselineMet = true;
        events.push({
          type: 'BASELINE_MET',
          atMs: observation.startMs,
          evidence: 'OBSERVED',
          confidence: observation.confidence,
          detail: `The required ${requiredBaselineActiveMs}ms active baseline was observed.`,
        });
      }
      if (qualifyingStartMs !== null && !qualified) {
        interruptions += 1;
        events.push({
          type: 'INTERRUPTION',
          atMs: observation.startMs,
          evidence: 'OBSERVED',
          confidence: observation.confidence,
          detail: 'The source resumed during the quiet window. The qualifying interval reset.',
        });
        currentRunMs = 0;
        qualifyingStartMs = null;
      }
      longestInactiveMs = Math.max(longestInactiveMs, currentRunMs);
      currentRunMs = 0;
      continue;
    }

    // INACTIVE
    inactiveMs += duration;
    if (!baselineMet) {
      // A missing signal without an active baseline is not evidence of a pause.
      continue;
    }
    if (qualifyingStartMs === null) {
      qualifyingStartMs = observation.startMs;
      events.push({
        type: 'INACTIVE_STARTED',
        atMs: observation.startMs,
        evidence: 'INFERRED',
        confidence: observation.confidence,
        detail: 'Confident non-detection began after the active baseline.',
      });
    }
    if (!qualified) {
      currentRunMs += duration;
      longestInactiveMs = Math.max(longestInactiveMs, currentRunMs);
      if (currentRunMs >= requiredInactiveMs) {
        qualified = true;
        qualifyingEndMs = qualifyingStartMs + requiredInactiveMs;
        events.push({
          type: 'WINDOW_QUALIFIED',
          atMs: qualifyingEndMs,
          evidence: 'INFERRED',
          confidence: observation.confidence,
          detail: `The required ${requiredInactiveMs}ms continuous non-detection window completed.`,
        });
      }
    }
  }

  if (previousEnd !== null) {
    events.push({
      type: 'SESSION_ENDED',
      atMs: previousEnd,
      evidence: 'OBSERVED',
      confidence: ordered[ordered.length - 1]?.confidence ?? 0,
      detail: 'The supplied observation ledger ended.',
    });
  }

  const nowMs = input.now === undefined ? Number.NaN : Date.parse(input.now);
  const expired = Number.isFinite(nowMs) && nowMs > Date.parse(terms.expiresAt);
  const modelMatches =
    input.currentModelHash === undefined || input.currentModelHash === terms.eventModel.hash;
  const observationShapeValid = validationErrors.length === 0;
  const evidenceShapeValid = observationShapeValid && maxGapMs <= maxAllowedGapMs;

  let outcome: AmbientOutcome;
  if (!observationShapeValid) outcome = 'REJECTED';
  else if (!modelMatches) outcome = 'REJECTED';
  else if (expired) outcome = 'EXPIRED';
  else if (qualified) outcome = 'QUALIFIED';
  else if (sensorLoss) outcome = 'SENSOR_LOSS';
  else if (baselineActiveMs < requiredBaselineActiveMs) outcome = 'NO_BASELINE';
  else if (interruptions > 0) outcome = 'INTERRUPTED';
  else outcome = 'INSUFFICIENT_EVIDENCE';

  if (!evidenceShapeValid && outcome === 'QUALIFIED') outcome = 'REJECTED';

  const eligibleForCapture = outcome === 'QUALIFIED' && !expired && modelMatches && evidenceShapeValid;

  const checks: AmbientCheck[] = [
    check(
      'observation_shape',
      'Observation ledger is well formed',
      observationShapeValid ? 'PASS' : 'FAIL',
      validationErrors[0] ?? `${ordered.length} ordered intervals supplied.`,
    ),
    check(
      'evidence_continuity',
      'Evidence gaps stay within the approved limit',
      evidenceShapeValid ? 'PASS' : 'FAIL',
      maxGapMs <= maxAllowedGapMs
        ? `Largest gap ${maxGapMs}ms; approved maximum ${maxAllowedGapMs}ms.`
        : `A ${maxGapMs}ms gap exceeds the approved ${maxAllowedGapMs}ms maximum.`,
    ),
    check(
      'model_binding',
      'Approved model is still the bound model',
      modelMatches ? 'PASS' : 'FAIL',
      modelMatches
        ? `Model ${terms.eventModel.hash.slice(0, 16)}... matches the agreement.`
        : 'The current model digest differs from the approved agreement.',
    ),
    check(
      'baseline',
      'Active baseline preceded the quiet window',
      baselineActiveMs >= requiredBaselineActiveMs ? 'PASS' : 'FAIL',
      `${baselineActiveMs}ms of confident active evidence; ${requiredBaselineActiveMs}ms required.`,
    ),
    check(
      'sensor_continuity',
      'Sensing remained observable',
      sensorLoss ? 'FAIL' : 'PASS',
      sensorLoss ? `${sensorLossMs}ms of sensor loss or disqualifying failure was recorded.` : 'No sensor-loss interval was recorded.',
    ),
    check(
      'qualifying_window',
      'Continuous non-detection window completed',
      qualified ? 'PASS' : 'FAIL',
      qualified
        ? `${requiredInactiveMs}ms completed at ${qualifyingEndMs}ms.`
        : `${Math.min(longestInactiveMs, requiredInactiveMs)}ms of the required ${requiredInactiveMs}ms was observed.`,
    ),
    check(
      'interruption_policy',
      'Interruptions reset the window',
      interruptions === 0 ? 'PASS' : 'FAIL',
      interruptions === 0 ? 'No active interruption was observed during the window.' : `${interruptions} active interruption(s) reset the window.`,
    ),
    check(
      'agreement_expiry',
      'Agreement had not expired',
      expired ? 'FAIL' : 'PASS',
      expired ? `The agreement expired at ${terms.expiresAt}.` : `The agreement was valid at ${input.now ?? 'the evaluation time'}.`,
    ),
    check(
      'fixed_price',
      'Fixed price is within the accepted ceiling',
      terms.financial.fixedPriceMinor > 0 &&
        terms.financial.fixedPriceMinor <= terms.financial.maximumChargeMinor
        ? 'PASS'
        : 'FAIL',
      `${terms.financial.fixedPriceMinor} minor units against a ${terms.financial.maximumChargeMinor} ceiling.`,
    ),
  ];

  const evidenceRoot = await sha256Hex(
    canonicalJson({
      schema: 'whirr.ambient-evidence.v1',
      agreementHash,
      observationsHash,
      outcome,
      requiredInactiveMs,
      requiredBaselineActiveMs,
      baselineActiveMs,
      activeMs,
      inactiveMs,
      unknownMs,
      sensorLossMs,
      longestInactiveMs,
      qualifyingStartMs,
      qualifyingEndMs,
      interruptions,
      maxGapMs,
    }),
  );

  return {
    schema: AMBIENT_EVALUATION_SCHEMA,
    evaluatorVersion: AMBIENT_EVALUATOR_VERSION,
    agreementHash,
    modelHash: terms.eventModel.hash,
    outcome,
    eligibleForCapture,
    priceMinor: terms.financial.fixedPriceMinor,
    currency: terms.financial.currency,
    requiredInactiveMs,
    requiredBaselineActiveMs,
    baselineActiveMs,
    activeMs,
    inactiveMs,
    unknownMs,
    sensorLossMs,
    longestInactiveMs,
    qualifyingStartMs,
    qualifyingEndMs,
    interruptions,
    maxGapMs,
    observationsHash,
    evidenceRoot,
    events,
    checks,
    uncertainties: [...new Set(uncertainties)],
    reason: reasonFor(outcome),
    evaluatedAt: input.now ?? new Date(previousEnd ?? 0).toISOString(),
  };
}

/** Exposed for server-side ingress validation without trusting the evaluator. */
export function ambientObservationErrors(observations: AmbientObservation[]): string[] {
  return validateObservations(observations);
}
